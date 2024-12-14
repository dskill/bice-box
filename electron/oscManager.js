const OSC = require('osc');

class OSCManager
{
    constructor(mainWindow)
    {
        this.mainWindow = mainWindow;
        this.oscServer = null;
        this.isClosing = false;
        this.oscMessageCount = 0;
        this.lastLogTime = Date.now();
        this.shouldLogMessageRate = false;
        this.messageRateInterval = null;
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