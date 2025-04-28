import React, { useRef, useEffect, useCallback, useState } from 'react';
import p5 from 'p5';
import WebGLDetector from './utils/webGLDetector';

function VisualizationCanvas({ currentEffect, currentVisualContent, paramValuesRef, onEffectLoaded }) {
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
  const [webGLCapabilities, setWebGLCapabilities] = useState(null);
  const [isPlatformRaspberryPi, setIsPlatformRaspberryPi] = useState(false);

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
    // This handler might need revisiting if file-watching updates are needed 
    // alongside direct content injection. For now, the main useEffect handles
    // content changes via the currentVisualContent prop.
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

  // Detect WebGL capabilities on mount
  useEffect(() => {
    // Check WebGL capabilities
    const capabilities = WebGLDetector.testWebGLCapabilities();
    setWebGLCapabilities(capabilities);
    
    // Check if we're on a Raspberry Pi
    const isPi = WebGLDetector.isPlatformRaspberryPi();
    setIsPlatformRaspberryPi(isPi);
    
    console.log('WebGL capabilities:', capabilities);
    console.log('Platform detection:', { 
      isRaspberryPi: isPi,
      userAgent: navigator.userAgent,
      platform: navigator.platform 
    });
    
    // Log to main process for debugging
    if (window.electron) {
      window.electron.ipcRenderer.send('log-webgl-capabilities', {
        capabilities,
        isPlatformRaspberryPi: isPi
      });
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

  // Update useEffect to depend on currentVisualContent
  useEffect(() => {
    async function loadAndCreateSketch() {
      // Check if we have valid visual content to load
      if (currentVisualContent) {
        console.log('Visual content changed, creating/updating sketch...');

        cleanupP5Instance(); // Clean up previous instance first

        try {
          // Use the currentVisualContent prop directly
          console.log('Evaluating sketch content...');
          const sketchFunctionWrapper = new Function('module', 'exports', currentVisualContent);
          const exports = {};
          const module = { exports };
          sketchFunctionWrapper(module, exports);
          const sketchDefinition = module.exports;

          if (typeof sketchDefinition !== 'function') {
            throw new Error('Sketch content did not export a function.');
          }

          console.log('Creating new p5 instance...');
          const newP5Instance = new p5(sketchDefinition, canvasRef.current);
          p5InstanceCountRef.current += 1;
          console.log(`P5 instance created. Current count: ${p5InstanceCountRef.current}`);

          // Attach data refs and params to the new instance
          newP5Instance.waveform0 = waveform0DataRef.current;
          newP5Instance.waveform1 = waveform1DataRef.current;
          newP5Instance.fft0 = fft0DataRef.current;
          newP5Instance.fft1 = fft1DataRef.current;
          newP5Instance.rmsInput = rmsInputRef.current;
          newP5Instance.rmsOutput = rmsOutputRef.current;
          newP5Instance.tunerData = tunerDataRef.current;
          newP5Instance.customMessage = oscMessageRef.current;
          newP5Instance.params = paramValuesRef.current; // Pass current params
          // Expose WebGL capabilities and platform info to sketch
          newP5Instance.webGLCapabilities = webGLCapabilities;
          newP5Instance.isPlatformRaspberryPi = isPlatformRaspberryPi;


          p5InstanceRef.current = newP5Instance; // Store the new instance
          errorRef.current = null; // Clear any previous error
          console.log('New p5 instance setup complete.');
          onEffectLoaded(); // Notify parent component

        } catch (error) {
          console.error('Error creating p5 sketch from content:', error);
          errorRef.current = 'Failed to load visualization.';
          // Ensure cleanup happens even on error
          cleanupP5Instance(); 
        }
      } else {
        // If no visual content, ensure cleanup
        console.log('No visual content, ensuring canvas is clean.');
        cleanupP5Instance();
      }
    }

    loadAndCreateSketch();

    // Dependency array now includes currentVisualContent
  }, [currentVisualContent, cleanupP5Instance, paramValuesRef, onEffectLoaded, webGLCapabilities, isPlatformRaspberryPi]);

  if (errorRef.current) {
    return <div>Error: {errorRef.current}</div>;
  }

  return <div ref={canvasRef} style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%' }} />;
}

export default React.memo(VisualizationCanvas);
