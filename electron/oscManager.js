const OSC = require('osc');

class OSCManager {
    constructor(mainWindow) {
        this.mainWindow = mainWindow;
        this.oscServer = null;
        this.oscMessageCount = 0;
        this.oscDataBytes = 0;
        this.lastOscCountResetTime = Date.now();
    }

    initialize() {
        this.oscServer = new OSC.UDPPort({
            localAddress: '127.0.0.1',
            localPort: 57121,
            metadata: true
        });

        this.oscServer.on('ready', () => {
            console.log('OSC Server is ready');
        });

        this.oscServer.on('message', (oscMsg) => this.handleOSCMessage(oscMsg));

        this.oscServer.open();
        return this.oscServer;
    }

    handleOSCMessage(oscMsg) {
        this.oscMessageCount++;

        switch (oscMsg.address) {
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
                // Handle tuner data if needed
                break;

            default:
                console.log('Unhandled OSC message:', oscMsg.address);
                break;
        }
    }

    close() {
        if (this.oscServer) {
            this.oscServer.close();
        }
    }
}

module.exports = OSCManager; 