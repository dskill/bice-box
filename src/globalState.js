export const NONE = 'none';
export const IDLE = 'idle';
export const RECORDING = 'recording';
export const PROCESSING_STT = 'processing_stt';
export const PROCESSING_GPT_RESPONSE = 'PROCESSING_GPT_RESPONSE';
export const PROCESSING_TTS = 'processing_tts';
export const SPEAKING = 'speaking';

export let globalState = {
    fft: [],
    waveform: [],
    avgWaveformIntensity: 0,
    avgWaveformIntensitySmooth: 0,
    allowTTS: true,
    sampleRate: 48000,
  };
  
  export function setGlobalFFT(data) {
    globalState.fft = data;
  }
  
  export function setGlobalWaveform(data) {
    globalState.waveform = data;
  }
  
  export function setAvgWaveformIntensity(value) {
    globalState.avgWaveformIntensity = value;
    globalState.avgWaveformIntensitySmooth = globalState.avgWaveformIntensitySmooth * 0.6 + value * 0.4;
  }
  
  