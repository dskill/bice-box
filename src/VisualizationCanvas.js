import React, { useRef, useEffect, useCallback } from 'react';
import p5 from 'p5';

function VisualizationCanvas({ currentEffect, paramValuesRef, onEffectLoaded }) {
  const canvasRef = useRef(null);
  const p5InstanceRef = useRef(null);
  const waveform0DataRef = useRef([]);
  const waveform1DataRef = useRef([]);
  const errorRef = useRef(null);
  const rmsInputRef = useRef(0);
  const rmsOutputRef = useRef(0);
  const tunerDataRef = useRef(0);
  // Add new refs for FFT data
  const fft0DataRef = useRef([]);
  const fft1DataRef = useRef([]);
  const oscMessageRef = useRef([]);

  const numUpdates = useRef(0);

  const p5InstanceCountRef = useRef(0);

  const updateWaveform0Data = (data) => {
    if (Array.isArray(data)) {
      numUpdates.current++;
      waveform0DataRef.current = data;
      if (p5InstanceRef.current) {
        p5InstanceRef.current.waveform0 = data;
      }
    } else {
      console.warn('Received invalid waveform0 data:', data);
    }
  };

  const updateWaveform1Data = (data) => {
    if (Array.isArray(data)) {
      numUpdates.current++;
      waveform1DataRef.current = data;
      if (p5InstanceRef.current) {
        p5InstanceRef.current.waveform1 = data;
      }
    } else {
      console.warn('Received invalid waveform1 data:', data);
    }
  };

  // Add new update functions for FFT data
  const updateFFT0Data = (data) => {
    if (Array.isArray(data)) {
      numUpdates.current++;
      fft0DataRef.current = data;
      if (p5InstanceRef.current) {
        p5InstanceRef.current.fft0 = data;
      }
    } else {
      console.warn('Received invalid FFT0 data:', data);
    }
  };

  const updateFFT1Data = (data) => {
    if (Array.isArray(data)) {
      numUpdates.current++;
      fft1DataRef.current = data;
      if (p5InstanceRef.current) {
        p5InstanceRef.current.fft1 = data;
      }
    } else {
      console.warn('Received invalid FFT1 data:', data);
    }
  };

  const updateAudioAnalysis = useCallback((data) => {
    numUpdates.current++;
    rmsInputRef.current = data.rmsInput;
    rmsOutputRef.current = data.rmsOutput;
    if (p5InstanceRef.current) {
      p5InstanceRef.current.rmsInput = data.rmsInput;
      p5InstanceRef.current.rmsOutput = data.rmsOutput;
    }
  }, []);

  const updateTunerData = useCallback((data) => {
   // console.log("tunderdata:", data.freq);
    numUpdates.current++;
    tunerDataRef.current = data;
    if (p5InstanceRef.current) {
      p5InstanceRef.current.tunerData = data;
    }
  }, []);

  const handleVisualEffectUpdate = useCallback((updatedEffect) => {
    if (!updatedEffect || typeof updatedEffect !== 'object') {
      console.warn('Received invalid updatedEffect, skipping update');
      return;
    }

    console.log('Visual effect update received:', updatedEffect);
    
    // Check if currentEffect exists before accessing its properties
    if (currentEffect && updatedEffect.name === currentEffect.name) {
      console.log('Updating visual effect:', updatedEffect.name);
      
      // Remove existing p5 instance if any
      if (p5InstanceRef.current) {
        console.log('Removing existing p5 instance');
        p5InstanceRef.current.remove();
      }

      try {
        const sketchFunction = new Function('module', 'exports', updatedEffect.p5SketchContent);
        const exports = {};
        const module = { exports };
        sketchFunction(module, exports);
        const newSketchFunction = module.exports;

        console.log('Creating new p5 instance');
        p5InstanceRef.current = new p5(newSketchFunction, canvasRef.current);
        p5InstanceRef.current.waveform0 = waveform0DataRef.current;
        p5InstanceRef.current.waveform1 = waveform1DataRef.current;
        p5InstanceRef.current.rmsInput = rmsInputRef.current;
        p5InstanceRef.current.rmsOutput = rmsOutputRef.current;
        p5InstanceRef.current.tunerData = tunerDataRef.current;
        // Add FFT data to p5 instance
        p5InstanceRef.current.fft0 = fft0DataRef.current;
        p5InstanceRef.current.fft1 = fft1DataRef.current;
        p5InstanceRef.current.params = paramValuesRef.current;

        console.log('New p5 instance created');
      } catch (error) {
        console.error('Error updating p5 sketch:', error);
        errorRef.current = 'Failed to update visualization';
      }
    } else {
      console.log('Received update for a different effect or no current effect set:', updatedEffect.name);
    }
  }, [currentEffect]);

  const cleanupP5Instance = useCallback(() => {
    if (p5InstanceRef.current) {
      console.log('Cleaning up p5 instance');
      
      // If using WebGL, lose the WebGL context
      if (p5InstanceRef.current.webglContext) {
        const gl = p5InstanceRef.current.webglContext;
        gl.getExtension('WEBGL_lose_context').loseContext();
      }
      p5InstanceRef.current.remove();
      p5InstanceRef.current = null;
      p5InstanceCountRef.current -= 1;
      console.log(`P5 instance removed. Current count: ${p5InstanceCountRef.current}`);
    }
    // Reset all data refs
    waveform0DataRef.current = [];
    waveform1DataRef.current = [];
    fft0DataRef.current = [];
    fft1DataRef.current = [];
    rmsInputRef.current = 0;
    rmsOutputRef.current = 0;
    tunerDataRef.current = 0;
    
  }, []);

  const updateCustomMessage = useCallback((data) => {
    numUpdates.current++;
    oscMessageRef.current = data;
    if (p5InstanceRef.current) {
        p5InstanceRef.current.customMessage = data;
    }
  }, []);

  useEffect(() => {
    console.log('Setting up all event listeners');
    window.electron.ipcRenderer.on('waveform0-data', updateWaveform0Data);
    window.electron.ipcRenderer.on('waveform1-data', updateWaveform1Data);
    window.electron.ipcRenderer.on('audio-analysis', updateAudioAnalysis);
    window.electron.ipcRenderer.on('tuner-data', updateTunerData);
    window.electron.ipcRenderer.on('fft0-data', updateFFT0Data);
    window.electron.ipcRenderer.on('fft1-data', updateFFT1Data);
    window.electron.ipcRenderer.on('visual-effect-updated', handleVisualEffectUpdate);
    window.electron.ipcRenderer.on('custom-message', updateCustomMessage);

    return () => {
      console.log('Removing all event listeners');
      window.electron.ipcRenderer.removeAllListeners('waveform0-data');
      window.electron.ipcRenderer.removeAllListeners('waveform1-data');
      window.electron.ipcRenderer.removeAllListeners('audio-analysis');
      window.electron.ipcRenderer.removeAllListeners('tuner-data');
      window.electron.ipcRenderer.removeAllListeners('fft0-data');
      window.electron.ipcRenderer.removeAllListeners('fft1-data');
      window.electron.ipcRenderer.removeAllListeners('visual-effect-updated');
      window.electron.ipcRenderer.removeAllListeners('custom-message');
            cleanupP5Instance();
    };
  }, [handleVisualEffectUpdate, cleanupP5Instance]);

  /*
  useEffect(() => {
    const interval = setInterval(() => {
      console.log('Number of updates:', numUpdates.current);
      console.log('p5InstanceCountRef.current:', p5InstanceCountRef.current);
      numUpdates.current = 0;
    }, 1000);
    return () => clearInterval(interval);
  }, []);
  */

  useEffect(() => {
    async function loadAndCreateSketch() {
      if (currentEffect && currentEffect.p5SketchPath) {
        console.log('Loading sketch:', currentEffect.p5SketchPath);

        cleanupP5Instance();

        // Remove existing p5 instance if any
        if (p5InstanceRef.current) {
          console.log('Removing existing p5 instance');
          p5InstanceRef.current.remove();
        }

        try {
          const sketchContent = await window.electron.ipcRenderer.invoke('load-p5-sketch', currentEffect.p5SketchPath);
          if (sketchContent) {
            const sketchModule = new Function('module', 'exports', sketchContent);
            const exports = {};
            const module = { exports };
            sketchModule(module, exports);
            const sketchFunction = module.exports;

            console.log('Creating new p5 instance');
            p5InstanceRef.current = new p5(sketchFunction, canvasRef.current);
            p5InstanceRef.current.waveform0 = waveform0DataRef.current;
            p5InstanceRef.current.waveform1 = waveform1DataRef.current;
            p5InstanceRef.current.rmsInput = rmsInputRef.current;
            p5InstanceRef.current.rmsOutput = rmsOutputRef.current;
            p5InstanceRef.current.tunerData = tunerDataRef.current;
            p5InstanceRef.current.fft0 = fft0DataRef.current;
            p5InstanceRef.current.fft1 = fft1DataRef.current;

            // Define params as a getter to always access the current values
            Object.defineProperty(p5InstanceRef.current, 'params', {
              get: () => paramValuesRef.current
            });

            p5InstanceCountRef.current += 1;
            console.log(`Current p5 instance count: ${p5InstanceCountRef.current}`);

            // Call onEffectLoaded when sketch is ready
            if (onEffectLoaded) {
              onEffectLoaded();
            }

            console.log('p5 instance created');
          } else {
            console.error('Failed to load sketch content');
            errorRef.current = 'Failed to load visualization';
          }
        } catch (error) {
          console.error('Error loading sketch:', error);
          errorRef.current = 'Failed to load visualization';
        }
      } else {
        console.log('No current effect or p5SketchPath provided');
      }
    }

    loadAndCreateSketch();

    return cleanupP5Instance;
  }, [currentEffect, cleanupP5Instance]);

  if (errorRef.current) {
    return <div>Error: {errorRef.current}</div>;
  }

  return <div ref={canvasRef} style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%' }} />;
}

export default React.memo(VisualizationCanvas);
