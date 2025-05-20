import React, { useRef, useEffect, useCallback, useState } from 'react';
import p5 from 'p5';
import WebGLDetector from './utils/webGLDetector';

// ShaderToyLite will be available globally via script tag in index.html
// const ShaderToyLite = window.ShaderToyLite;

function VisualizationCanvas({ 
  currentVisualContent, 
  currentShaderPath,    // New prop
  currentShaderContent, // New prop
  paramValuesRef, 
  onEffectLoaded 
}) {
  const canvasRef = useRef(null);
  const p5InstanceRef = useRef(null);
  const shaderToyInstanceRef = useRef(null); // New ref for ShaderToyLite

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

  const cleanupP5Instance = useCallback(() => {
    if (p5InstanceRef.current) {
      console.log('Cleaning up p5 instance');
      
      if (p5InstanceRef.current.webglContext) {
        const gl = p5InstanceRef.current.webglContext;
        if (gl && gl.getExtension('WEBGL_lose_context')) { // Check if context and extension exist
          gl.getExtension('WEBGL_lose_context').loseContext();
        }
      }
      p5InstanceRef.current.remove();
      p5InstanceRef.current = null;
      p5InstanceCountRef.current -= 1;
      console.log(`P5 instance removed. Current count: ${p5InstanceCountRef.current}`);
    }
    // Reset relevant data refs if needed, or manage them based on active renderer
  }, []);

  const cleanupShaderToyInstance = useCallback(() => {
    if (shaderToyInstanceRef.current) {
      console.log('Cleaning up ShaderToyLite instance');
      shaderToyInstanceRef.current.pause(); // Stop rendering loop
      // ShaderToyLite.js doesn't have an explicit destroy method in its README.
      // We rely on losing WebGL context and nullifying refs for cleanup.
      // If it creates its own canvas internally and appends it, that would also need cleanup.
      // However, it takes a canvas ID, so it should use the one we provide.
      const toy = shaderToyInstanceRef.current;
      if (toy.gl) {
          const loseContextExt = toy.gl.getExtension('WEBGL_lose_context');
          // Temporarily comment this out to test if it's causing issues for p5.js
          // if (loseContextExt) {
          //     loseContextExt.loseContext();
          // }
      }
      shaderToyInstanceRef.current = null;
    }
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
    window.electron.ipcRenderer.on('custom-message', updateCustomMessage);

    return () => {
      console.log('Removing all event listeners');
      window.electron.ipcRenderer.removeAllListeners('waveform0-data');
      window.electron.ipcRenderer.removeAllListeners('waveform1-data');
      window.electron.ipcRenderer.removeAllListeners('audio-analysis');
      window.electron.ipcRenderer.removeAllListeners('tuner-data');
      window.electron.ipcRenderer.removeAllListeners('fft0-data');
      window.electron.ipcRenderer.removeAllListeners('fft1-data');
      window.electron.ipcRenderer.removeAllListeners('custom-message');
    };
  }, [updateWaveform0Data, updateWaveform1Data, updateAudioAnalysis, updateTunerData, updateFFT0Data, updateFFT1Data, updateCustomMessage]);

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
      cleanupP5Instance();
      cleanupShaderToyInstance(); // This will also handle removing the shader canvas if it exists
      errorRef.current = null;

      if (!canvasRef.current) {
        console.error("Canvas container ref (div) not available for rendering.");
        errorRef.current = 'Canvas container not ready.';
        onEffectLoaded();
        return;
      }

      const containerElement = canvasRef.current; // This is our main div

      // Clear previous canvas elements from the container
      while (containerElement.firstChild) {
        containerElement.removeChild(containerElement.firstChild);
      }

      if (currentShaderContent && window.ShaderToyLite) {
        console.log('Shader content found, creating canvas and loading ShaderToyLite sketch...');

        if (!webGLCapabilities || !webGLCapabilities.webGL2) {
          console.error("WebGL2 not supported, cannot run ShaderToyLite effect.");
          errorRef.current = 'WebGL2 is required for this shader effect.';
          onEffectLoaded();
          return;
        }

        try {
          const shaderCanvas = document.createElement('canvas');
          shaderCanvas.id = 'bice-box-shader-canvas'; // Fixed ID for the shader canvas
          
          const rect = containerElement.getBoundingClientRect();
          shaderCanvas.width = Math.floor(rect.width);
          shaderCanvas.height = Math.floor(rect.height);
          shaderCanvas.style.position = 'absolute'; // Ensure it fills the div correctly
          shaderCanvas.style.top = '0';
          shaderCanvas.style.left = '0';
          shaderCanvas.style.width = '100%';
          shaderCanvas.style.height = '100%';

          containerElement.appendChild(shaderCanvas);
          console.log('Dynamically created canvas for ShaderToyLite and appended to div.');
          console.log('Shader canvas dimensions before ShaderToyLite init:', shaderCanvas.width, shaderCanvas.height);
          
          const toy = new window.ShaderToyLite(shaderCanvas.id); // Use ID of the new canvas
          toy.setImage({ source: currentShaderContent });
          toy.play();
          shaderToyInstanceRef.current = toy;
          // Store the canvas element itself if needed for cleanup, though ShaderToyLite uses ID.
          // We'll rely on the general container clear for now.
          console.log('New ShaderToyLite instance setup complete.');
          onEffectLoaded();
        } catch (err) {
          console.error('Error creating ShaderToyLite sketch:', err);
          errorRef.current = 'Failed to load ShaderToyLite visualization.';
          cleanupShaderToyInstance(); 
          onEffectLoaded();
        }

      } else if (currentVisualContent) {
        console.log('P5 visual content found, p5 will create its canvas in the div...');
        
        // p5.js will append its own canvas to containerElement (the div)
        // We don't need to set targetWidth/Height on the div for p5 if it creates its own canvas
        // and correctly uses parent dimensions or window dimensions.
        // However, the old logic for canvasElement.targetWidth might not apply directly to the div.
        // p5.js, when given a div, typically sizes its canvas to the div's clientWidth/Height or uses p.windowWidth/Height.

        try {
          const rect = containerElement.getBoundingClientRect();
          console.log('Container (div) dimensions before p5 init:', rect.width, rect.height);

          const sketchFunctionWrapper = new Function('module', 'exports', currentVisualContent);
          const exports = {};
          const module = { exports };
          sketchFunctionWrapper(module, exports);
          const sketchDefinition = module.exports;

          if (typeof sketchDefinition !== 'function') {
            throw new Error('P5 sketch content did not export a function.');
          }

          console.log('Creating new p5 instance (will append to div)...');
          // Pass the div (containerElement) to p5. It will create & append a canvas inside it.
          const newP5Instance = new p5(sketchDefinition, containerElement); 
          p5InstanceCountRef.current += 1;
          console.log(`P5 instance created. Current count: ${p5InstanceCountRef.current}`);
          
          // The p5 canvas is now newP5Instance.canvas
          // If p5 sketch uses createCanvas without args, it might default to small size.
          // We need to ensure p5 sketch's createCanvas uses container dimensions.
          // One way is to make them available on the containerElement for the sketch.
          containerElement.targetWidth = Math.floor(rect.width);
          containerElement.targetHeight = Math.floor(rect.height);
          // And the sketch's setup would do: p.createCanvas(p.canvas.parentElement.targetWidth, p.canvas.parentElement.targetHeight);

          newP5Instance.waveform0 = waveform0DataRef.current;
          newP5Instance.waveform1 = waveform1DataRef.current;
          newP5Instance.fft0 = fft0DataRef.current;
          newP5Instance.fft1 = fft1DataRef.current;
          newP5Instance.rmsInput = rmsInputRef.current;
          newP5Instance.rmsOutput = rmsOutputRef.current;
          newP5Instance.tunerData = tunerDataRef.current;
          newP5Instance.customMessage = oscMessageRef.current;
          newP5Instance.params = paramValuesRef.current;
          newP5Instance.webGLCapabilities = webGLCapabilities;
          newP5Instance.isPlatformRaspberryPi = isPlatformRaspberryPi;

          newP5Instance.sendOscToSc = (address, ...args) => {
            if (window.electron && window.electron.ipcRenderer) {
              window.electron.ipcRenderer.send('send-osc-to-sc', { address, args });
            } else {
              console.warn('Electron IPC not available for sending OSC.');
            }
          };

          p5InstanceRef.current = newP5Instance;
          console.log('New p5 instance setup complete.');
          onEffectLoaded();

        } catch (error) {
          console.error('Error creating p5 sketch from content:', error);
          errorRef.current = 'Failed to load p5.js visualization.';
          cleanupP5Instance();
          onEffectLoaded();
        }
      } else {
        console.log('No visual content (p5 or shader), ensuring container div is clean.');
        onEffectLoaded(); 
      }
    }

    loadAndCreateSketch();

  }, [currentVisualContent, currentShaderContent, cleanupP5Instance, cleanupShaderToyInstance, paramValuesRef, onEffectLoaded, webGLCapabilities, isPlatformRaspberryPi]);

  // The main canvas element. Ensure it has an ID for ShaderToyLite if needed, 
  // or ShaderToyLite might need to be modified to accept the element directly.
  // Assigning an ID directly here if it doesn't have one.
  useEffect(() => {
    if (canvasRef.current && !canvasRef.current.id) {
        // canvasRef.current.id = 'bice-box-shader-canvas'; // Moved id assignment into loadAndCreateSketch
    }
  }, []);

  if (errorRef.current) {
    return <div className="error-display">Error: {errorRef.current}</div>; // Use a class for styling errors
  }

  // Revert to using a div as the main ref container
  return (
    <div 
        ref={canvasRef} 
        style={{ 
            position: 'fixed', 
            top: 0, 
            left: 0, 
            width: '100%', 
            height: '100%', 
            backgroundColor: 'black' // Ensure background is black for visual consistency
        }} 
        // The id will be set on this div, ShaderToyLite/p5 might need adjustment
        // if they expect the ID on the canvas element itself.
        id="visualization-container" 
    />
  );
}

export default React.memo(VisualizationCanvas);
