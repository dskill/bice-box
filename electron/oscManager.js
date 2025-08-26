const OSC = require('osc');

class OSCManager
{
    constructor(mainWindow, onEffectSpecsReceived = null, broadcastFunction = null)
    {
        this.mainWindow = mainWindow;
        this.onEffectSpecsReceived = onEffectSpecsReceived; // Callback for effect specs
        this.broadcastFunction = broadcastFunction; // Callback for WebSocket broadcasting
        this.oscServer = null;
        this.isClosing = false;
        this.oscMessageCount = 0;
        this.lastLogTime = Date.now();
        this.shouldLogMessageRate = false;
        this.messageRateInterval = null;
        
        // WebSocket broadcast throttling
        this.lastBroadcastTime = 0;
        this.broadcastThrottleMs = 16; // ~60 FPS (1000ms / 60fps = 16ms)
        this.lastAudioData = null;
        
        if (this.shouldLogMessageRate) {
            this.startMessageRateLogging();
        }
    }

    initialize()
    {
        this.oscServer = new OSC.UDPPort({
            localAddress: '127.0.0.1',
            localPort: 57121,
            metadata: true
        });

        this.oscServer.on('ready', () =>
        {
            console.log('OSC Server is ready');
        });

        this.oscServer.on('message', (oscMsg) => this.handleOSCMessage(oscMsg));
        
        this.oscServer.open();
        return this.oscServer;
    }

    handleOSCMessage(oscMsg)
    {
        if (this.isClosing) return;

        try
        {
            this.oscMessageCount++;

            switch (oscMsg.address)
            {
                case '/audio_analysis':
                    const rmsInput = oscMsg.args[0].value;
                    const rmsOutput = oscMsg.args[1].value;
                    this.mainWindow.webContents.send('audio-analysis', { rmsInput, rmsOutput });
                    break;

                case '/waveform0':
                case '/waveform1':
                    const waveformData = oscMsg.args.map(arg => arg.value);
                    const waveformEventName = oscMsg.address === '/waveform0' ? 'waveform0-data' : 'waveform1-data';
                    this.mainWindow.webContents.send(waveformEventName, waveformData);
                    break;

                case '/fft_data0':
                case '/fft_data1':
                    const fftData = oscMsg.args.map(arg => arg.value);
                    const fftEventName = oscMsg.address === '/fft_data0' ? 'fft0-data' : 'fft1-data';
                    this.mainWindow.webContents.send(fftEventName, fftData);
                    break;

                case '/combined_data':
                    const combinedData = oscMsg.args.map(arg => arg.value);
                    // Combined data now contains 1026 samples: first 512 are waveform, next 512 are FFT, then RMS input, then RMS output.
                    this.mainWindow.webContents.send('combined-data', combinedData);
                    
                    // Only store data if we don't already have recent data (avoid accumulation)
                    if (!this.lastAudioData) {
                        this.lastAudioData = combinedData;
                    }
                    
                    // Throttled broadcast to remote visualizer clients via WebSocket
                    this.throttledBroadcast();
                    break;

                case '/tuner_data':
                    const freq = oscMsg.args[0].value;
                    const hasFreq = oscMsg.args[1].value;
                    const differences = oscMsg.args.slice(2, 8).map(arg => arg.value); // Differences for six strings
                    const amplitudes = oscMsg.args.slice(8, 14).map(arg => arg.value); // Amplitudes for six strings

                    // Send the tuner data to the renderer process
                    this.mainWindow.webContents.send('tuner-data', {
                        freq: freq,
                        hasFreq: hasFreq,
                        differences: differences,
                        amplitudes: amplitudes
                    });
                    break;

                case '/effect/specs_reply':
                    if (oscMsg.args.length >= 2) {
                        const effectName = oscMsg.args[0].value;
                        const specsJSON = oscMsg.args[1].value;
                        console.log(`OSCManager: Received specs for ${effectName}, raw JSON: ${specsJSON}`);
                        try {
                            const params = JSON.parse(specsJSON);
                            console.log(`OSCManager: Parsed specs for ${effectName}:`, params);
                            // Call the callback directly instead of sending IPC
                            if (this.onEffectSpecsReceived) {
                                this.onEffectSpecsReceived({ name: effectName, params: params });
                            }
                        } catch (e) {
                            console.error(`OSCManager: Error parsing specs JSON for ${effectName}: ${specsJSON}`, e);
                            if (this.onEffectSpecsReceived) {
                                this.onEffectSpecsReceived({ name: effectName, params: null, error: 'Error parsing specs JSON' });
                            }
                        }
                    } else {
                        console.warn("OSCManager: Received malformed /effect/specs_reply", oscMsg.args);
                    }
                    break;

                case '/sc/config':
                    // SuperCollider is sending us its port configuration
                    if (oscMsg.args.length >= 6) {
                        const serverPort = oscMsg.args[1].value;
                        const langPort = oscMsg.args[3].value;
                        const electronPort = oscMsg.args[5].value;
                        console.log(`OSCManager: Received SC port config - Server: ${serverPort}, Lang: ${langPort}, Electron: ${electronPort}`);
                        
                        // Store the configuration globally for use in main.js
                        global.scPortConfig = {
                            server: serverPort,
                            lang: langPort,
                            electron: electronPort
                        };
                        
                        // Notify main process that port config is available
                        this.mainWindow.webContents.send('sc-port-config', global.scPortConfig);
                    }
                    break;

                case '/effect/param/update':
                    // SuperCollider is notifying us of a parameter change (from MIDI CC)
                    if (oscMsg.args.length >= 3) {
                        const effectName = oscMsg.args[0].value;
                        const paramName = oscMsg.args[1].value;
                        const paramValue = oscMsg.args[2].value;
                        
                        // MIDI debug logging
                        console.log(`[MIDI DEBUG] OSCManager received /effect/param/update:`, {
                            effectName,
                            paramName,
                            paramValue,
                            valueType: typeof paramValue
                        });
                        
                        // Update the effectsStore via the action (with fromMidi flag to prevent feedback)
                        if (global.setEffectParametersAction) {
                            const result = global.setEffectParametersAction({
                                name: effectName,
                                params: { [paramName]: paramValue },
                                fromMidi: true  // Important: prevents OSC feedback loop
                            });
                            
                            console.log(`[MIDI DEBUG] setEffectParametersAction result:`, result);
                            
                            if (result.error) {
                                console.error(`[MIDI DEBUG] OSCManager: Error updating param from MIDI CC: ${result.error}`);
                            }
                        } else {
                            console.error('[MIDI DEBUG] OSCManager: setEffectParametersAction not available globally');
                        }
                    }
                    break;

                default:
                    // Forward any unhandled OSC messages to the renderer
                    //console.log('Non Standard OSC message:', oscMsg.address);
                    const values = oscMsg.args.map(arg => arg.value);
                    this.mainWindow.webContents.send('custom-message', {
                        address: oscMsg.address,
                        values: values
                    });
                    break;
            }
        } catch (error)
        {
            console.error('Error handling OSC message:', error);
        }
    }

    throttledBroadcast() {
        const now = Date.now();
        
        // Only broadcast if enough time has passed since the last broadcast
        if (now - this.lastBroadcastTime >= this.broadcastThrottleMs) {
            if (this.broadcastFunction && this.lastAudioData) {
                // Create a copy of the data to avoid holding references
                const dataCopy = this.lastAudioData.slice();
                this.broadcastFunction({
                    type: 'audioData',
                    payload: {
                        combinedData: dataCopy
                    }
                });
                this.lastBroadcastTime = now;
                
                // Clear the reference to help GC
                this.lastAudioData = null;
            }
        }
    }

    logMessageRate() {
        const now = Date.now();
        const elapsed = (now - this.lastLogTime) / 1000; // Convert to seconds
        const rate = this.oscMessageCount / elapsed;
        console.log(`OSC Messages per second: ${rate.toFixed(2)}`);
        
        // Reset counter and timer
        this.oscMessageCount = 0;
        this.lastLogTime = now;
    }

    startMessageRateLogging() {
        if (!this.messageRateInterval) {
            this.messageRateInterval = setInterval(() => this.logMessageRate(), 1000);
        }
    }

    stopMessageRateLogging() {
        if (this.messageRateInterval) {
            clearInterval(this.messageRateInterval);
            this.messageRateInterval = null;
        }
    }

    close()
    {
        this.isClosing = true;
        if (this.oscServer)
        {
            try
            {
                this.oscServer.close();
            } catch (error)
            {
                console.error('Error closing OSC server:', error);
            }
            this.oscServer = null;
        }
        this.stopMessageRateLogging();
    }
}

module.exports = OSCManager; 