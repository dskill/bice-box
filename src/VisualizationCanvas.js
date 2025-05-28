import React, { useRef, useEffect, useCallback, useState } from 'react';
import p5 from 'p5';
import WebGLDetector from './utils/webGLDetector';

// ShaderToyLite will be available globally via script tag in index.html
// const ShaderToyLite = window.ShaderToyLite;

// TODO: we decided to only visualize output FFT and output waveform, 
// so we need to clean up FFT1 and waveform1.  the problem is these are not used
// consisnently in the p5.js visualizers, so we'll have to clean those up when we remove these.

function VisualizationCanvas({ 
  currentVisualContent, 
  currentShaderPath,    // New prop
  currentShaderContent, // New prop
  paramValuesRef, 
  onEffectLoaded,
  devMode // <-- New prop for dev mode
}) {
  const canvasRef = useRef(null);
  const p5InstanceRef = useRef(null);
  const shaderToyInstanceRef = useRef(null); // New ref for ShaderToyLite
  const waveformTextureRef = useRef(null); // <-- New Ref for waveform texture

  const [waveform0Data, setWaveform0Data] = useState([]);
  const waveform1DataRef = useRef([]);
  const errorRef = useRef(null);
  const rmsInputRef = useRef(0);
  const rmsOutputRef = useRef(0);
  const tunerDataRef = useRef(0);
  // Add new refs for FFT data
  const fft0DataRef = useRef([]);
  const fft1DataRef = useRef([]);
  const oscMessageRef = useRef([]);
  // Add new ref for combined data (waveform + FFT)
  const combinedDataRef = useRef([]);
  const [webGLCapabilities, setWebGLCapabilities] = useState(null);
  const [isPlatformRaspberryPi, setIsPlatformRaspberryPi] = useState(false);

  const numUpdates = useRef(0);

  const p5InstanceCountRef = useRef(0);

  // FPS Counter state and refs
  const [fps, setFps] = useState(0);
  const fpsUpdateIntervalRef = useRef(null);
  const animationFrameIdRef = useRef(null);

  const updateWaveform0Data = useCallback((event, data) => {
    if (Array.isArray(data)) {
      numUpdates.current++;
      setWaveform0Data(data);
      if (p5InstanceRef.current) {
        p5InstanceRef.current.waveform0 = data;
      }
    } else {
      console.warn('Received invalid waveform0 data:', data);
    }
  }, [setWaveform0Data]);

  const updateWaveform1Data = useCallback((event, data) => {
    if (Array.isArray(data)) {
      numUpdates.current++;
      waveform1DataRef.current = data;
      if (p5InstanceRef.current) {
        p5InstanceRef.current.waveform1 = data;
      }
    } else {
      console.warn('Received invalid waveform1 data:', data);
    }
  }, []);

  // Add new update functions for FFT data
  const updateFFT0Data = useCallback((event, data) => {
    if (Array.isArray(data)) {
      numUpdates.current++;
      fft0DataRef.current = data;
      if (p5InstanceRef.current) {
        p5InstanceRef.current.fft0 = data;
      }
    } else {
      console.warn('Received invalid FFT0 data:', data);
    }
  }, []);

  const updateFFT1Data = useCallback((event, data) => {
    if (Array.isArray(data)) {
      numUpdates.current++;
      fft1DataRef.current = data;
      if (p5InstanceRef.current) {
        p5InstanceRef.current.fft1 = data;
      }
    } else {
      console.warn('Received invalid FFT1 data:', data);
    }
  }, []);

  const updateAudioAnalysis = useCallback((event, data) => {
    numUpdates.current++;
    rmsInputRef.current = data.rmsInput;
    rmsOutputRef.current = data.rmsOutput;
    if (p5InstanceRef.current) {
      p5InstanceRef.current.rmsInput = data.rmsInput;
      p5InstanceRef.current.rmsOutput = data.rmsOutput;
    }
  }, []);

  const updateTunerData = useCallback((event, data) => {
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
      shaderToyInstanceRef.current.pause(); 

      // Clean up waveform texture - NO LONGER NEEDED HERE, ShaderToyLite manages its iAudioTexture
      /*
      if (waveformTextureRef.current && shaderToyInstanceRef.current.gl) {
        try {
          const gl = shaderToyInstanceRef.current.gl;
          gl.deleteTexture(waveformTextureRef.current);
          console.log('Waveform texture deleted.');
        } catch (e) {
          console.error('Error deleting waveform texture:', e);
        }
        waveformTextureRef.current = null;
      }
      */
      
      // ShaderToyLite.js doesn't have an explicit destroy method in its README.
      // We rely on losing WebGL context and nullifying refs for cleanup.
      const toy = shaderToyInstanceRef.current;
      if (toy.gl) {
          const loseContextExt = toy.gl.getExtension('WEBGL_lose_context');
          if (loseContextExt) { // Decided against this earlier as it caused issues
              loseContextExt.loseContext();
          }
      }
      shaderToyInstanceRef.current = null;
    }
  }, []);

  const updateCustomMessage = useCallback((event, data) => {
    numUpdates.current++;
    oscMessageRef.current = data;
    if (p5InstanceRef.current) {
        p5InstanceRef.current.customMessage = data;
    }
  }, []);

  // Add new update function for combined data
  const updateCombinedData = useCallback((event, data) => {
    const rmsMultiplier = 1.0;
    // Ensure data is an array and has the expected new length
    if (Array.isArray(data) && data.length === 2050) { // Adjusted length: 1024 (waveform) + 1024 (FFT) + 2 (RMS)
      numUpdates.current++;
      combinedDataRef.current = data; // Store the full 2050 array

      // Extract waveform, FFT, and new RMS values
      const waveformData = data.slice(0, 1024); // 1024 samples
      const fftData = data.slice(1024, 2048);    // 1024 samples
      const rmsInput = data[2048] * rmsMultiplier;
      const rmsOutput = data[2049] * rmsMultiplier;

      rmsInputRef.current = rmsInput;
      rmsOutputRef.current = rmsOutput;

      // Update individual data refs for backward compatibility or other uses
      setWaveform0Data(waveformData); // This updates state, causing re-renders if used in JSX
      fft0DataRef.current = fftData;

      if (p5InstanceRef.current) {
        p5InstanceRef.current.combinedData = data; // Full data
        p5InstanceRef.current.waveform0 = waveformData;
        p5InstanceRef.current.waveform1 = waveformData;
        p5InstanceRef.current.fft0 = fftData;
        p5InstanceRef.current.fft1 = fftData; 
        p5InstanceRef.current.rmsInput = rmsInput; // Pass new RMS values
        p5InstanceRef.current.rmsOutput = rmsOutput; // Pass new RMS values
      }

      if (shaderToyInstanceRef.current) {
        // Call the new methods to set RMS uniforms for ShaderToy
        shaderToyInstanceRef.current.setRMSInput(rmsInput);
        shaderToyInstanceRef.current.setRMSOutput(rmsOutput);
      }
    } else {
      // Update warning for incorrect data length
      console.warn('Received invalid combined data (expected 2050 floats):', data);
    }
  }, [setWaveform0Data]); // setWaveform0Data is a dependency

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
    window.electron.ipcRenderer.on('combined-data', updateCombinedData);

    return () => {
      console.log('Removing all event listeners');
      window.electron.ipcRenderer.removeAllListeners('waveform0-data');
      window.electron.ipcRenderer.removeAllListeners('waveform1-data');
      window.electron.ipcRenderer.removeAllListeners('audio-analysis');
      window.electron.ipcRenderer.removeAllListeners('tuner-data');
      window.electron.ipcRenderer.removeAllListeners('fft0-data');
      window.electron.ipcRenderer.removeAllListeners('fft1-data');
      window.electron.ipcRenderer.removeAllListeners('custom-message');
      window.electron.ipcRenderer.removeAllListeners('combined-data');
    };
  }, [updateWaveform0Data, updateWaveform1Data, updateAudioAnalysis, updateTunerData, updateFFT0Data, updateFFT1Data, updateCustomMessage, updateCombinedData]);

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
          const resolutionScale = 0.7; // Hardcoded here
          shaderCanvas.width = Math.floor(rect.width * resolutionScale);
          shaderCanvas.height = Math.floor(rect.height * resolutionScale);
          shaderCanvas.style.position = 'absolute'; // Ensure it fills the div correctly
          shaderCanvas.style.top = '0';
          shaderCanvas.style.left = '0';
          shaderCanvas.style.width = '100%';
          shaderCanvas.style.height = '100%';

          containerElement.appendChild(shaderCanvas);
          console.log('Dynamically created canvas for ShaderToyLite and appended to div.');
          console.log('Shader canvas dimensions before ShaderToyLite init:', shaderCanvas.width, shaderCanvas.height);
          
          const toy = new window.ShaderToyLite(shaderCanvas.id); // Use ID of the new canvas
          
          if (toy.gl) {
            // const gl = toy.gl; // gl is available on toy.gl directly
            // The iAudioTexture is now created and managed internally by ShaderToyLite.js
            // No need to create or add it here.

            // Set the main image shader (single pass) or the image pass of a multi-pass shader.
            // iAudioTexture is globally available to all shaders within ShaderToyLite.
            if (typeof currentShaderContent === 'string') { // Single GLSL file
                toy.setImage({
                    source: currentShaderContent
                    // No iChannel0 mapping for audio needed here, iAudioTexture is global
                });
                console.log(`setImage called for single pass shader.`);
            } else if (typeof currentShaderContent === 'object' && currentShaderContent !== null) { // Multi-pass config
                // Set common functions if available
                if (currentShaderContent.common) {
                    toy.setCommon(currentShaderContent.common);
                    console.log('Set common shader functions');
                }
                
                // Set buffer passes with self-referencing
                if (currentShaderContent.bufferA) {
                    console.log('BufferA source code:', currentShaderContent.bufferA.substring(0, 100) + '...');
                    const bufferAConfig = { 
                        source: currentShaderContent.bufferA,
                        iChannel0: "A" // BufferA references its own previous frame for feedback effects
                    };
                    console.log('Calling toy.setBufferA with config:', bufferAConfig);
                    toy.setBufferA(bufferAConfig);
                    console.log('Set BufferA pass with self-referencing - completed');
                } else {
                    console.log('No BufferA content found in currentShaderContent');
                }
                if (currentShaderContent.bufferB) {
                    toy.setBufferB({ 
                        source: currentShaderContent.bufferB, 
                        iChannel0: "self" // BufferB references its own previous frame
                    });
                    console.log('Set BufferB pass');
                }
                if (currentShaderContent.bufferC) {
                    toy.setBufferC({ 
                        source: currentShaderContent.bufferC, 
                        iChannel0: "self" // BufferC references its own previous frame
                    });
                    console.log('Set BufferC pass');
                }
                if (currentShaderContent.bufferD) {
                    toy.setBufferD({ 
                        source: currentShaderContent.bufferD, 
                        iChannel0: "self" // BufferD references its own previous frame
                    });
                    console.log('Set BufferD pass');
                }
                
                // Set image pass with automatic channel mapping to available buffers
                if (currentShaderContent.image) {
                    const imageConfig = { source: currentShaderContent.image };
                    
                    // Auto-map channels to available buffers (ShaderToy convention)
                    // Use single letters as expected by ShaderToyLite.js
                    if (currentShaderContent.bufferA) imageConfig.iChannel0 = "A";
                    if (currentShaderContent.bufferB) imageConfig.iChannel1 = "B";
                    if (currentShaderContent.bufferC) imageConfig.iChannel2 = "C";
                    if (currentShaderContent.bufferD) imageConfig.iChannel3 = "D";
                    
                    toy.setImage(imageConfig);
                    console.log('Set Image pass with channels:', Object.keys(imageConfig).filter(k => k.startsWith('iChannel')));
                }
                
                console.log(`ShaderToyLite configured for multi-pass shader with passes: ${Object.keys(currentShaderContent).join(', ')}`);
            }
          } else {
            console.error("ShaderToyLite GL context not available after instantiation.");
          }
          
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

          newP5Instance.waveform0 = waveform0Data;
          newP5Instance.waveform1 = waveform1DataRef.current;
          newP5Instance.fft0 = fft0DataRef.current;
          newP5Instance.fft1 = fft1DataRef.current;
          newP5Instance.rmsInput = rmsInputRef.current;
          newP5Instance.rmsOutput = rmsOutputRef.current;
          newP5Instance.tunerData = tunerDataRef.current;
          newP5Instance.customMessage = oscMessageRef.current;
          newP5Instance.combinedData = combinedDataRef.current;
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

  // Effect to update audio texture when combined data or waveform data changes
  useEffect(() => {
    if (shaderToyInstanceRef.current && shaderToyInstanceRef.current.gl) {
      // const gl = shaderToyInstanceRef.current.gl; // Not needed directly
      // const texture = waveformTextureRef.current; // REMOVED
      const textureWidth = 1024; 
      const textureHeight = 2; // 2 rows: FFT (row 0) and waveform (row 1)

      // Prepare Uint8Array for RGBA texture (1024x2x4 = 8192 bytes)
      let uint8AudioData = new Uint8Array(textureWidth * textureHeight * 4);
      
      // Use combined data if available, otherwise fall back to individual arrays
      let fftData = [];
      let waveformData = [];
      
      // Use the full combinedDataRef which might be 2050 long
      if (combinedDataRef.current.length >= 2048) { // Check for at least 1024 waveform + 1024 FFT
        // Waveform and FFT data are always in the first 2048 elements
        waveformData = combinedDataRef.current.slice(0, 1024);
        fftData = combinedDataRef.current.slice(1024, 2048);
      } else {
        // Fall back to individual data arrays if combinedData isn't populated yet or is too short
        fftData = fft0DataRef.current.length > 0 ? fft0DataRef.current : [];
        waveformData = waveform0Data.length > 0 ? waveform0Data : [];
      }

      // Debug logging (only log occasionally to avoid spam)
      if (Math.random() < 0.01) { // Log ~1% of the time
        console.log('Audio texture update:', {
          fftDataLength: fftData.length,
          waveformDataLength: waveformData.length,
          fftDataType: 'pre-computed magnitudes',
          firstFewFFTValues: fftData.slice(0, 8),
          firstFewWaveformValues: waveformData.slice(0, 8),
          rmsInput: rmsInputRef.current,
          rmsOutput: rmsOutputRef.current
        });
      }

      // Fill row 0 with FFT data (frequency spectrum)
      // FFT data now contains pre-computed magnitudes from SuperCollider (no longer complex pairs)
      for (let i = 0; i < textureWidth; i++) {
        let fftMagnitude = 0;
        
        if (i < fftData.length && fftData.length > 0) {
          // FFT data now contains pre-computed magnitudes with logarithmic scaling applied
          fftMagnitude = fftData[i] || 0;
        }
        
        // Normalize to 0-255 range for 8-bit texture
        // The data is already logarithmically scaled, so we just need to normalize
        // the FFT Data ranges above 1 a bit, so we have are just 100 as a magic number
        // to try and get the data into the 0:255 range
        const normalizedFFT = Math.max(0, Math.min(255, Math.round(fftMagnitude * 100)));
        
        const row0Index = i * 4; // Row 0, pixel i
        uint8AudioData[row0Index + 0] = normalizedFFT; // R
        uint8AudioData[row0Index + 1] = normalizedFFT; // G
        uint8AudioData[row0Index + 2] = normalizedFFT; // B
        uint8AudioData[row0Index + 3] = 255; // A (opaque)
      }

      // Fill row 1 with waveform data (time domain)
      for (let i = 0; i < textureWidth; i++) {
        const waveformValue = waveformData[i] !== undefined ? waveformData[i] : 0;
        // Normalize waveform data (assuming it's -1 to 1) to 0-255 for 8-bit texture
        const normalizedWaveform = Math.max(0, Math.min(255, Math.round((waveformValue * 0.5 + 0.5) * 255)));
        
        const row1Index = (textureWidth + i) * 4; // Row 1, pixel i
        uint8AudioData[row1Index + 0] = normalizedWaveform; // R
        uint8AudioData[row1Index + 1] = normalizedWaveform; // G
        uint8AudioData[row1Index + 2] = normalizedWaveform; // B
        uint8AudioData[row1Index + 3] = 255; // A (opaque)
      }
      
      try {
        // Call the new updateAudioTexture method on ShaderToyLite instance
        if (shaderToyInstanceRef.current.updateAudioTexture) {
            shaderToyInstanceRef.current.updateAudioTexture(uint8AudioData, textureWidth, textureHeight);
        } else {
            console.warn("shaderToyInstanceRef.current.updateAudioTexture is not defined");
        }
        // gl.bindTexture(gl.TEXTURE_2D, texture); // REMOVED
        // gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, textureWidth, textureHeight, gl.RGBA, gl.UNSIGNED_BYTE, uint8AudioData); // REMOVED
        // gl.bindTexture(gl.TEXTURE_2D, null); // REMOVED
      } catch (error) {
        console.error('Error updating audio texture:', error);
      }
    }
  }, [waveform0Data, combinedDataRef.current]);

  // Effect for FPS calculation
  useEffect(() => {
    const cleanupFPS = () => {
      if (fpsUpdateIntervalRef.current) {
        clearInterval(fpsUpdateIntervalRef.current);
        fpsUpdateIntervalRef.current = null;
      }
      if (animationFrameIdRef.current) {
        cancelAnimationFrame(animationFrameIdRef.current);
        animationFrameIdRef.current = null;
      }
      setFps(0);
    };

    if (!devMode) {
      cleanupFPS();
      return;
    }

    // Check which renderer is active after a brief delay to allow instance refs to be set
    // This is a bit of a workaround for refs not being direct dependencies.
    // The main effect for sketch creation already depends on currentVisualContent/currentShaderContent.
    const timerId = setTimeout(() => {
        if (p5InstanceRef.current) {
            console.log("FPS counter: p5 mode enabled");
            fpsUpdateIntervalRef.current = setInterval(() => {
              if (p5InstanceRef.current) {
                setFps(p5InstanceRef.current.frameRate());
              }
            }, 500); // Update FPS display twice a second
        } else if (shaderToyInstanceRef.current) {
            console.log("FPS counter: ShaderToy mode enabled");
            let lastFpsCalcTime = performance.now();
            let frameCountSinceLastCalc = 0;
    
            const tick = (currentTime) => {
              frameCountSinceLastCalc++;
              const elapsed = currentTime - lastFpsCalcTime;
    
              if (elapsed >= 1000) { // Calculate FPS every second
                const currentFps = (frameCountSinceLastCalc * 1000) / elapsed;
                setFps(currentFps);
                frameCountSinceLastCalc = 0;
                lastFpsCalcTime = currentTime;
              }
              
              // Continue the loop ONLY if shaderToy is still the active one and devMode is on
              if (shaderToyInstanceRef.current && devMode) {
                 animationFrameIdRef.current = requestAnimationFrame(tick);
              } else {
                if (animationFrameIdRef.current) {
                    cancelAnimationFrame(animationFrameIdRef.current);
                    animationFrameIdRef.current = null;
                }
                setFps(0); 
              }
            };
            animationFrameIdRef.current = requestAnimationFrame(tick);
        } else {
            cleanupFPS(); // No active renderer
        }
    }, 100); // Small delay

    return () => {
        clearTimeout(timerId); // Clear the timeout on cleanup
        cleanupFPS();
    };
  }, [devMode, currentVisualContent, currentShaderContent]);

  // The main canvas element. Ensure it has an ID for ShaderToyLite if needed, 
  // or ShaderToyLite might need to be modified to accept the element directly.
  // Assigning an ID directly here if it doesn't have one.
  useEffect(() => {
    // if (canvasRef.current && !canvasRef.current.id) { // canvasRef is the container for p5/shader
        // canvasRef.current.id = 'bice-box-shader-canvas'; // Moved id assignment into loadAndCreateSketch
    // }
  }, []);

  if (errorRef.current) {
    return <div className="error-display">Error: {errorRef.current}</div>; // Use a class for styling errors
  }

  // Revert to using a div as the main ref container
  return (
    <div style={{ // New outer wrapper
      position: 'fixed', 
      top: 0, 
      left: 0, 
      width: '100%', 
      height: '100%', 
      backgroundColor: 'black' 
    }}>
      <div 
          ref={canvasRef} // This ref points to the container for p5/ShaderToy sketches
          style={{ 
              width: '100%', 
              height: '100%', 
              // backgroundColor: 'black' // Moved to outer container
          }} 
          id="visualization-container" // This ID might be used by p5/ShaderToy logic or styles
      />
      {devMode && (
        <div style={{
          position: 'absolute',
          bottom: '10px', // User preference from attached diff
          left: '10px',
          color: 'white',
          backgroundColor: 'rgba(0,0,0,0.7)',
          padding: '5px 10px',
          zIndex: 10000, 
          fontSize: '12px', // User preference from attached diff
          fontFamily: 'monospace',
          borderRadius: '3px',
          pointerEvents: 'none'
        }}>
          FPS: {fps.toFixed(1)}
        </div>
      )}
    </div>
  );
}

export default React.memo(VisualizationCanvas);
