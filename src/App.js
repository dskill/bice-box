import React, { useState, useEffect, useMemo, useCallback } from 'react';
import VisualizationMode from './VisualizationMode';
import EffectSelectScreen from './EffectSelectScreen';
import './App.css';

// Add this style to your existing CSS or create a new style block
const styles = {
  app: {
    cursor: 'none', // Hide cursor at the React level
    userSelect: 'none', // Prevent text selection
    WebkitUserSelect: 'none', // For Safari
    MozUserSelect: 'none', // For Firefox
    msUserSelect: 'none', // For IE/Edge
  }
};

const electron = window.electron;

function App() {
  const [synths, setSynths] = useState([]);
  const [currentSynth, setCurrentSynth] = useState(null); // Represents the loaded preset
  const [currentAudioSource, setCurrentAudioSource] = useState(null); // Stores scFilePath
  const [currentVisualSource, setCurrentVisualSource] = useState(null); // Stores p5SketchPath
  const [currentVisualContent, setCurrentVisualContent] = useState(''); // Stores loaded p5 sketch content
  const [currentShaderPath, setCurrentShaderPath] = useState(null); // New state for shader path
  const [currentShaderContent, setCurrentShaderContent] = useState(''); // New state for shader content
  const [error, setError] = useState(null);
  const [currentScreen, setCurrentScreen] = useState('visualization'); // 'visualization' or 'select' - Will be replaced
  const [showAudioSelector, setShowAudioSelector] = useState(false);
  const [showVisualSelector, setShowVisualSelector] = useState(false);
  const [showPresetSelector, setShowPresetSelector] = useState(false); // State for preset selector
  const [visualizerList, setVisualizerList] = useState([]); // State for direct visualizers
  const [currentAudioParams, setCurrentAudioParams] = useState([]); // State for active audio params
  const [effectsRepoStatus, setEffectsRepoStatus] = useState({
    hasUpdates: false,
    lastChecked: null,
    isChecking: false,
    error: null
  });
  const [scError, setScError] = useState(null);
  const [devMode, setDevMode] = useState(false);

  // --- Derived State for Selectors ---
  const audioSources = useMemo(() => {
    const sources = new Map();
    synths.forEach(synth => {
      if (synth.scFilePath && !sources.has(synth.scFilePath)) {
        sources.set(synth.scFilePath, {
          // Use effect name primarily, but maybe just path? Or find a common name?
          // For now, using the path as a key and storing the first associated name.
          name: synth.name, // Or potentially just the filename? 
          scFilePath: synth.scFilePath
        });
      }
    });
    // Sort by name for consistent display
    return Array.from(sources.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [synths]);

  // Derived list for curated presets selector
  const curatedPresets = useMemo(() => {
    console.log('Filtering curated presets from:', synths);
    const filtered = synths.filter(synth => synth.curated === true);
    console.log('Curated presets:', filtered.map(s => s.name));
    return filtered;
  }, [synths]);

  const handleScReady = useCallback((event) => {
    console.log('SuperCollider is ready');
    // When SC is ready, ensure the current audio source is loaded
    if (currentAudioSource) {
      console.log(`SC ready, activating current audio source: ${currentAudioSource}`);
      electron.ipcRenderer.send('load-sc-file', currentAudioSource);
      // Also apply params from the original preset if it exists
       if (currentSynth && currentSynth.scFilePath === currentAudioSource && Array.isArray(currentSynth.params)) {
          currentSynth.params.forEach(param => {
              if (param && typeof param.name === 'string' && param.value !== undefined) {
                  const scCode = `~effect.set(\${param.name}, ${param.value});`;
                  electron.ipcRenderer.send('send-to-supercollider', scCode);
              }
          });
       }
    } else if (currentSynth && currentSynth.scFilePath) {
        // Fallback to loading the preset's audio if no override is set
         console.log(`SC ready, activating preset audio source: ${currentSynth.scFilePath}`);
         electron.ipcRenderer.send('load-sc-file', currentSynth.scFilePath);
    } else {
      console.log('SC ready, but no current audio source to activate');
    }
  }, [currentAudioSource, currentSynth, electron]); // Added electron to dependencies

  useEffect(() => {
    // Initial effects load and repo check
    Promise.all([
      reloadEffectList(),
      checkEffectsRepoStatus()
    ]).catch(err => {
      console.error("Failed to initialize:", err);
      setError("Failed to initialize. Check the console for more details.");
    });

    // Set up periodic check (every 30 minutes)
    const checkInterval = setInterval(() => {
      checkEffectsRepoStatus();
    }, 30 * 60 * 1000);

    return () => clearInterval(checkInterval);
  }, []);

  useEffect(() => {
    const handleEffectUpdate = (event, updatedEffect) => {
      console.log('Effect update received:', updatedEffect);
      
      if (!updatedEffect) {
        console.warn('Received undefined updatedEffect, skipping update');
        return;
      }

      if (typeof updatedEffect !== 'object' || updatedEffect === null || typeof updatedEffect.name !== 'string') {
        console.error('Invalid effect update received:', updatedEffect);
        return;
      }

      setSynths(prevSynths => {
        const updatedSynths = prevSynths.map(synth => 
          synth.name === updatedEffect.name ? updatedEffect : synth
        );
        console.log('Updated synths:', updatedSynths);
        return updatedSynths;
      });

      // If the updated effect is the currently loaded preset, update sources and content
      setCurrentSynth(prevSynth => {
        if (prevSynth && prevSynth.name === updatedEffect.name) {
          console.log('Updating current synth preset and sources due to effect-updated IPC:', updatedEffect);
          setCurrentAudioSource(updatedEffect.scFilePath);
          // Prioritize shader, then p5, then nothing
          if (updatedEffect.shaderPath && updatedEffect.shaderContent) {
            setCurrentShaderPath(updatedEffect.shaderPath);
            setCurrentShaderContent(updatedEffect.shaderContent);
            setCurrentVisualSource(null);
            setCurrentVisualContent('');
          } else if (updatedEffect.p5SketchPath) {
            setCurrentVisualSource(updatedEffect.p5SketchPath);
            setCurrentVisualContent(updatedEffect.p5SketchContent || '');
            setCurrentShaderPath(null);
            setCurrentShaderContent('');
          } else {
            setCurrentVisualSource(null);
            setCurrentVisualContent('');
            setCurrentShaderPath(null);
            setCurrentShaderContent('');
          }
          // Also update params if they are part of updatedEffect and it's the current one
          if (updatedEffect.params) {
            setCurrentAudioParams(updatedEffect.params);
          }
          return updatedEffect;
        }
        return prevSynth;
      });
    };

    if (electron) {
      console.log('Adding effect-updated listener for App.js');
      electron.ipcRenderer.on('effect-updated', handleEffectUpdate);
      return () => {
        console.log('Removing effect-updated listener from App.js');
        electron.ipcRenderer.removeListener('effect-updated', handleEffectUpdate);
      };
    }
  }, []);

  const handleVisualEffectUpdate = useCallback((event, payload) => {
    if (!payload) {
        console.warn('App.js: visual-effect-updated received no payload.');
        return;
    }
    const { p5SketchPath: updatedPath, p5SketchContent } = payload; 

    if (updatedPath && currentVisualSource && updatedPath.toLowerCase() === currentVisualSource.toLowerCase()) {
      console.log(`Visual content updated for active visual source: ${currentVisualSource} (path from event: ${updatedPath})`);
      setCurrentVisualContent(p5SketchContent);
    } else {
      // This condition might be hit if the fallback in main.js sent an update for a preset's visual
      // that isn't the currently *active* visual source but is part of the current preset.
      // Or if the paths simply don't match for other reasons.
      console.log(`Ignoring visual update. Active visual source: ${currentVisualSource}, Updated sketch path: ${updatedPath}`);
    }
  }, [currentVisualSource, setCurrentVisualContent]);

  const handleScErrorCallback = useCallback((event, errorData) => {
    console.log("SC error received:", errorData);
    setScError(errorData);
  }, [setScError]);

  const handleDevModeChange = useCallback((event, newMode) => {
    console.log('Dev mode changed:', newMode);
    setDevMode(newMode);
  }, [setDevMode]);

  // This useEffect might need adjustment based on how visual updates are handled
  useEffect(() => {
    if (electron) {
      electron.ipcRenderer.on('visual-effect-updated', handleVisualEffectUpdate);

      return () => {
        electron.ipcRenderer.removeListener('visual-effect-updated', handleVisualEffectUpdate);
      };
    }
  }, [currentVisualSource, synths, handleVisualEffectUpdate, electron]); // Depend on currentVisualSource, synths, and the new handler + electron

  useEffect(() => {
    // Add this new effect for sc-ready
    if (electron) {
      electron.ipcRenderer.on('sc-ready', handleScReady);

      return () => {
        electron.ipcRenderer.removeListener('sc-ready', handleScReady);
      };
    }
  }, [currentAudioSource, currentSynth, handleScReady, electron]); // Added handleScReady and electron to dependencies

  useEffect(() => {
    if (electron) {
        electron.ipcRenderer.on('sc-compilation-error', handleScErrorCallback);

        return () => {
            electron.ipcRenderer.removeListener('sc-compilation-error', handleScErrorCallback);
        };
    }
  }, [handleScErrorCallback, electron]); // Added handleScErrorCallback and electron

  useEffect(() => {
    if (electron && electron.ipcRenderer) {
      // Get initial dev mode state
      electron.ipcRenderer.invoke('get-dev-mode').then(setDevMode);

      // Listen for changes to dev mode
      electron.ipcRenderer.on('dev-mode-changed', handleDevModeChange);

      return () => {
        electron.ipcRenderer.removeListener('dev-mode-changed', handleDevModeChange);
      };
    }
  }, [handleDevModeChange, electron, setDevMode]); // Added handleDevModeChange, electron, and setDevMode (as invoke uses it)

  const reloadEffectList = () => {
    return new Promise((resolve, reject) => {
      console.log("loadEffects function called");
      if (electron) {
        electron.ipcRenderer.send('reload-all-effects'); 
        electron.ipcRenderer.once('effects-data', (event, data) => {
          console.log("Received effects data:", data);
          if (Array.isArray(data) && data.length > 0) {
            setSynths(data);
            const firstSynth = data[0];
            setCurrentSynth(firstSynth);
            setCurrentAudioSource(firstSynth.scFilePath);
            // Prioritize shader if available, otherwise use p5 visual
            if (firstSynth.shaderPath && firstSynth.shaderContent) {
              setCurrentShaderPath(firstSynth.shaderPath);
              setCurrentShaderContent(firstSynth.shaderContent);
              setCurrentVisualSource(null); // Ensure p5 visual is cleared if shader is active
              setCurrentVisualContent('');
              console.log("Initial state set with shader: ", firstSynth.shaderPath);
            } else if (firstSynth.p5SketchPath) {
              setCurrentVisualSource(firstSynth.p5SketchPath);
              setCurrentVisualContent(firstSynth.p5SketchContent || '');
              setCurrentShaderPath(null); // Ensure shader is cleared if p5 is active
              setCurrentShaderContent('');
              console.log("Initial state set with p5 visual: ", firstSynth.p5SketchPath);
            } else {
              // No visual or shader initially
              setCurrentVisualSource(null);
              setCurrentVisualContent('');
              setCurrentShaderPath(null);
              setCurrentShaderContent('');
              console.log("Initial state set with no visual/shader.");
            }
            setCurrentAudioParams(firstSynth.params || []);
            
            // Inform main process of initial active sources
            electron.ipcRenderer.send('set-current-effect', firstSynth.name); // This already updates them in main
            // electron.ipcRenderer.send('set-current-audio-source', firstSynth.scFilePath);
            // electron.ipcRenderer.send('set-current-visual-source', firstSynth.p5SketchPath);

            console.log("Initial state set:", { 
              currentSynth: firstSynth.name, 
              audio: firstSynth.scFilePath, 
              visual: firstSynth.p5SketchPath 
            });
            
            resolve(data);
          } else {
            const errorMessage = "Received empty or invalid effects data";
            console.warn(errorMessage, data);
            reject(new Error(errorMessage));
          }
        });

        electron.ipcRenderer.once('effects-error', (event, error) => {
          console.error('Error loading effects:', error);
          reject(new Error(error));
        });

        // Add a timeout in case the IPC call doesn't respond
        setTimeout(() => {
          reject(new Error("Timeout while waiting for effects data"));
        }, 5000);
      } else {
        console.warn('Electron is not available');
        reject(new Error("Electron not available"));
      }
    });
  };

  // Renamed and updated: Selects a *preset*
  const switchPreset = async (presetName) => {
    if (typeof presetName !== 'string') {
      console.error('Invalid preset name:', presetName);
      return;
    }

    const selectedPreset = synths.find(synth => synth.name === presetName);
    if (!selectedPreset) {
      console.error('Preset not found:', presetName);
      return;
    }

    console.log(`Switching to preset: ${presetName}`);
    setCurrentSynth(selectedPreset);
    setCurrentAudioParams(selectedPreset.params || []);
    
    if (electron) {
      electron.ipcRenderer.send('set-current-effect', selectedPreset.name);
    }
    
    // Update audio source and load it
    if (selectedPreset.scFilePath) {
      setCurrentAudioSource(selectedPreset.scFilePath);
      if (electron) {
        electron.ipcRenderer.send('load-sc-file', selectedPreset.scFilePath);
        electron.ipcRenderer.send('set-current-audio-source', selectedPreset.scFilePath);
        if (Array.isArray(selectedPreset.params)) {
          selectedPreset.params.forEach(param => {
            if (param && typeof param.name === 'string' && param.value !== undefined) {
              // Use preset name for synthdef target
              const scCode = `~effect.set(\\${param.name}, ${param.value});`; 
              electron.ipcRenderer.send('send-to-supercollider', scCode);
            }
          });
        }
      }
    } else {
      setCurrentAudioSource(null); 
    }

    // Update visual/shader source and load its content
    // Prioritize shader if available
    if (selectedPreset.shaderPath && selectedPreset.shaderContent) {
      console.log(`Preset ${presetName} uses shader: ${selectedPreset.shaderPath}`);
      setCurrentShaderPath(selectedPreset.shaderPath);
      setCurrentShaderContent(selectedPreset.shaderContent);
      setCurrentVisualSource(null); // Clear p5 visual path
      setCurrentVisualContent('');    // Clear p5 visual content
      // Inform main process that p5 is not the active visual for hot-reloading purposes
      if (electron) electron.ipcRenderer.send('set-current-visual-source', selectedPreset.shaderPath); 
    } else if (selectedPreset.p5SketchPath) {
      console.log(`Preset ${presetName} uses p5 sketch: ${selectedPreset.p5SketchPath}`);
      setCurrentVisualSource(selectedPreset.p5SketchPath);
      setCurrentVisualContent(selectedPreset.p5SketchContent || ''); // Use preloaded if available
      setCurrentShaderPath(null);   // Clear shader path
      setCurrentShaderContent('');  // Clear shader content
      if (electron) electron.ipcRenderer.send('set-current-visual-source', selectedPreset.p5SketchPath);
      // No need to invoke load-p5-sketch here if p5SketchContent is already populated by main process
      // If p5SketchContent can be missing for a valid p5SketchPath, then loading logic here would be needed.
    } else {
      // No visual or shader specified for the preset
      console.log(`Preset ${presetName} has no visual or shader specified.`);
      setCurrentVisualSource(null);
      setCurrentVisualContent('');
      setCurrentShaderPath(null);
      setCurrentShaderContent('');
      if (electron) electron.ipcRenderer.send('set-current-visual-source', null);
    }
  };

  // --- New Handlers for Audio/Visual/Preset Selection ---

  const handleAudioSelect = (scFilePath) => {
    if (!scFilePath) {
      console.log('Audio selection cancelled or invalid path');
      setShowAudioSelector(false);
      return;
    }
    console.log(`Selecting audio source: ${scFilePath}`);
    setCurrentAudioSource(scFilePath);
    if (electron) {
      electron.ipcRenderer.send('load-sc-file', scFilePath);
      electron.ipcRenderer.send('set-current-audio-source', scFilePath); // Inform main process
      // Note: Params are NOT automatically applied when selecting audio only.
      // Find the preset associated with this audio file to load its params
      const associatedPreset = synths.find(synth => synth.scFilePath === scFilePath);
      if (associatedPreset) {
        console.log(`Found preset ${associatedPreset.name} for audio source ${scFilePath}, loading params.`);
        setCurrentAudioParams(associatedPreset.params || []);
      } else {
        console.warn(`Could not find preset associated with audio source ${scFilePath}. Clearing params.`);
        setCurrentAudioParams([]);
      }
    }
    setShowAudioSelector(false);
  };

  const handleVisualSelect = async (selectedVisual) => { // Expects the full visual object
    if (!selectedVisual || !selectedVisual.path || !selectedVisual.type) {
      console.log('Visual selection cancelled or invalid item');
      setShowVisualSelector(false);
      return;
    }

    const { path: visualPath, type: visualType } = selectedVisual;
    console.log(`Selecting visual source: ${visualPath} (type: ${visualType})`);

    if (electron) {
      try {
        if (visualType === 'p5') {
          console.log(`Loading p5 sketch content for: ${visualPath}`);
          const sketchContent = await electron.ipcRenderer.invoke('load-p5-sketch', visualPath);
          setCurrentVisualSource(visualPath);
          setCurrentVisualContent(sketchContent);
          setCurrentShaderPath(null); // Clear shader if p5 is selected
          setCurrentShaderContent('');
          electron.ipcRenderer.send('set-current-visual-source', visualPath); // For hot-reloading p5
          console.log(`P5 sketch content loaded successfully.`);
        } else if (visualType === 'shader') {
          console.log(`Loading shader content for: ${visualPath}`);
          const shaderContent = await electron.ipcRenderer.invoke('load-shader-content', visualPath);
          setCurrentShaderPath(visualPath);
          setCurrentShaderContent(shaderContent);
          setCurrentVisualSource(null); // Clear p5 if shader is selected
          setCurrentVisualContent('');
          electron.ipcRenderer.send('set-current-visual-source', visualPath); // For hot-reloading shader
          console.log(`Shader content loaded successfully.`);
        } else {
          console.warn(`Unknown visual type: ${visualType}`);
          setError(`Unknown visual type: ${visualType}`);
        }
      } catch (error) {
        console.error(`Error loading selected ${visualType} visual:`, error);
        // Clear relevant visual state on error
        if (visualType === 'p5') {
          setCurrentVisualSource(null);
          setCurrentVisualContent('');
        } else if (visualType === 'shader') {
          setCurrentShaderPath(null);
          setCurrentShaderContent('');
        }
        setError(`Failed to load visual: ${error.message}`);
      }
    }
    setShowVisualSelector(false);
  };

  const pullEffectsRepo = () => {
    return new Promise((resolve, reject) => {
      if (electron) {
        electron.ipcRenderer.send('pull-effects-repo');
        electron.ipcRenderer.once('pull-effects-repo-success', (event, message) => {
          console.log('Effects repo pulled successfully:', message);
          // After successful pull, reload the effects list
          reloadEffectList()
            .then(resolve)
            .catch(reject);
        });
        electron.ipcRenderer.once('pull-effects-repo-error', (event, error) => {
          console.error('Error pulling effects repo:', error);
          setError(`Failed to pull effects repo: ${error}`); 
          reject(new Error(error));
        });
      } else {
        console.warn('Electron is not available for pullEffectsRepo');
        reject(new Error("Electron not available"));
      }
    });
  };

  const hardReloadCurrentEffect = () => {
    if (!currentSynth || !currentSynth.name) {
      console.warn('No current synth selected to hard reload.');
      return Promise.reject(new Error('No current synth to reload'));
    }
    const effectName = currentSynth.name;
    console.log(`Hard reloading current effect: ${effectName}`);
    return new Promise((resolve, reject) => {
      if (electron) {
        electron.ipcRenderer.send('get-specific-effect', effectName);
        electron.ipcRenderer.once('specific-effect-data', (event, updatedEffect) => {
          if (updatedEffect && updatedEffect.error) {
            console.error(`Error reloading specific effect ${effectName}:`, updatedEffect.error);
            setError(`Failed to reload ${effectName}: ${updatedEffect.error}`);
            reject(new Error(updatedEffect.error));
            return;
          }
          if (updatedEffect && updatedEffect.name) {
            console.log('Received updated specific effect data:', updatedEffect);
            // Update the main synths list
            setSynths(prevSynths => 
              prevSynths.map(s => s.name === updatedEffect.name ? updatedEffect : s)
            );
            // Update the current synth and its associated states
            setCurrentSynth(updatedEffect);
            setCurrentAudioSource(updatedEffect.scFilePath);
            if (updatedEffect.shaderPath && updatedEffect.shaderContent) {
              setCurrentShaderPath(updatedEffect.shaderPath);
              setCurrentShaderContent(updatedEffect.shaderContent);
              setCurrentVisualSource(null);
              setCurrentVisualContent('');
            } else if (updatedEffect.p5SketchPath) {
              setCurrentVisualSource(updatedEffect.p5SketchPath);
              setCurrentVisualContent(updatedEffect.p5SketchContent || '');
              setCurrentShaderPath(null);
              setCurrentShaderContent('');
            } else {
              setCurrentVisualSource(null);
              setCurrentVisualContent('');
              setCurrentShaderPath(null);
              setCurrentShaderContent('');
            }
            setCurrentAudioParams(updatedEffect.params || []);
            
            // Inform main process of the reloaded current effect (if necessary, already handled by get-specific-effect handler)
            // electron.ipcRenderer.send('set-current-effect', updatedEffect.name); 
            // SC file is reloaded by main process if it's the active one

            console.log("Hard reload complete for:", updatedEffect.name);
            resolve(updatedEffect);
          } else {
            const errorMessage = "Received invalid or empty data for specific effect reload";
            console.warn(errorMessage, updatedEffect);
            setError(errorMessage);
            reject(new Error(errorMessage));
          }
        });
        // Add a timeout
        const timeoutId = setTimeout(() => {
          reject(new Error(`Timeout waiting for specific-effect-data for ${effectName}`))
        }, 5000);
        electron.ipcRenderer.once('specific-effect-data', () => clearTimeout(timeoutId)); // Clear timeout on reply

      } else {
        console.warn('Electron is not available for hardReloadCurrentEffect');
        reject(new Error("Electron not available"));
      }
    });
  };

  // Handles selecting a preset from the list
  const handlePresetSelect = (presetName) => {
    if (!presetName) {
      console.log('Preset selection cancelled.');
      setShowPresetSelector(false);
      return;
    }
    console.log(`Preset selected: ${presetName}`);
    switchPreset(presetName); // Call the existing function to load the preset
    setShowPresetSelector(false);
  };

  // Opens the preset selector
  const openPresetSelect = () => {
    console.log("Open Preset Selector triggered");
    setShowPresetSelector(true);
    setShowAudioSelector(false);
    setShowVisualSelector(false);
  };

  // Opens the audio selector
  const openAudioSelect = () => {
    console.log("Open Audio Selector triggered");
    setShowAudioSelector(true);
    setShowPresetSelector(false);
    setShowVisualSelector(false);
  };
  
  // Updated to fetch visualizer list on demand
  const openVisualSelect = async () => {
    console.log("Open Visual Selector triggered");
    // Fetch the list before showing the selector
    try {
      if (electron) {
        console.log('Fetching available visualizers...');
        const fetchedVisualizers = await electron.ipcRenderer.invoke('get-visualizers');
        console.log('Received visualizers:', fetchedVisualizers);
        setVisualizerList(fetchedVisualizers || []); 
        setShowVisualSelector(true); // Show selector only after successful fetch
        setShowAudioSelector(false); 
        setShowPresetSelector(false); // Also hide preset selector
      } else {
         throw new Error("Electron IPC not available");
      }
    } catch (err) {
      console.error("Failed to fetch visualizers:", err);
      setError("Could not load visualizer list.");
      setVisualizerList([]); // Clear list on error
      setShowVisualSelector(false); // Ensure selector is hidden
    }
  };

  const checkEffectsRepoStatus = async () => {
    if (!electron) return;
    
    setEffectsRepoStatus(prev => ({ 
      ...prev, 
      isChecking: true,
      error: null
    }));
    
    try {
      // The actual data from main.js will be the second argument to the listener
      const statusPayload = await new Promise((resolve, reject) => {
        electron.ipcRenderer.send('check-effects-repo');
        
        const timeout = setTimeout(() => {
          // Clean up listeners to prevent memory leaks if timeout occurs
          electron.ipcRenderer.removeAllListeners('effects-repo-status');
          electron.ipcRenderer.removeAllListeners('effects-repo-error');
          reject(new Error('Request to check effects repo timed out'));
        }, 10000); // 10 second timeout

        electron.ipcRenderer.once('effects-repo-status', (event, data) => {
          clearTimeout(timeout);
          electron.ipcRenderer.removeAllListeners('effects-repo-error'); // Clean up other listener
          console.log('App.js: Received effects-repo-status with data:', data);
          if (typeof data === 'object' && data !== null && typeof data.hasUpdates === 'boolean') {
            resolve(data); // Resolve with the actual data object { hasUpdates: ... }
          } else {
            console.warn('App.js: Invalid data received for effects-repo-status', data);
            reject(new Error('Invalid data received for effects repo status'));
          }
        });
        
        electron.ipcRenderer.once('effects-repo-error', (event, errorDetails) => {
          clearTimeout(timeout);
          electron.ipcRenderer.removeAllListeners('effects-repo-status'); // Clean up other listener
          console.error('App.js: Received effects-repo-error with details:', errorDetails);
          // errorDetails is expected to be { error: errorMessage, needsAttention: true }
          reject(errorDetails); 
        });
      });

      console.log('App.js: Promise resolved with statusPayload:', statusPayload);
      setEffectsRepoStatus({
        hasUpdates: Boolean(statusPayload.hasUpdates), // Now statusPayload should be the {hasUpdates: ...} object
        lastChecked: new Date(), // Set lastChecked to now
        isChecking: false,
        error: null
      });
    } catch (errorObject) { // Renamed to errorObject to avoid confusion
      console.error('App.js: Error in checkEffectsRepoStatus catch block:', errorObject);
      setEffectsRepoStatus(prev => ({
        ...prev,
        isChecking: false,
        // If errorObject is from effects-repo-error, it has an 'error' property with the message
        // Otherwise, it might be the timeout Error object, which has a 'message' property
        error: errorObject.error || errorObject.message || 'Failed to check for updates'
      }));
    }
  };

  // Handler for 'shader-effect-updated' IPC messages
  const handleShaderEffectUpdated = useCallback((event, data) => {
    console.log(`App.js: Received shader-effect-updated. Raw data:`, data);
    if (data && data.shaderPath !== undefined && data.shaderContent !== undefined) {
      const { shaderPath, shaderContent } = data; // Destructure here after check
      console.log(`App.js: Processing shader-effect-updated for ${shaderPath}`);
      // Check if the updated shader is the currently active one
      if (currentShaderPath === shaderPath) {
        console.log('Updated shader is active, applying new content.');
        setCurrentShaderContent(shaderContent);
      } else {
        console.log('Updated shader is not the active one. New content stored if its preset is reloaded.');
      }
    } else {
      console.warn('App.js: Received shader-effect-updated with invalid or missing data payload.', data);
    }
  }, [currentShaderPath, setCurrentShaderContent]); // Dependency: currentShaderPath, setCurrentShaderContent

  // Effect for general IPC listeners (like settings, wifi, etc.)
  useEffect(() => {
    electron.ipcRenderer.on('shader-effect-updated', handleShaderEffectUpdated);
    return () => {
        electron.ipcRenderer.removeAllListeners('shader-effect-updated');
    };
  }, [handleShaderEffectUpdated, electron]); // Add electron to dependency array

  if (error) {
    return <div className="error-message">{error}</div>;
  }

  return (
    <div className="App" style={styles.app}>
      <VisualizationMode
        // Pass necessary state and handlers
        currentPresetName={currentSynth ? currentSynth.name : 'None'} // Pass preset name
        currentAudioSourcePath={currentAudioSource}
        currentVisualSourcePath={currentVisualSource}
        currentVisualContent={currentVisualContent} // Pass the loaded sketch content
        currentShaderPath={currentShaderPath} // Pass new shader state
        currentShaderContent={currentShaderContent} // Pass new shader state
        currentAudioParams={currentAudioParams} // Pass the audio params
        // currentSynth={currentSynth} // Remove if no longer needed by VisMode besides params
        // Remove next/previous handlers
        // nextSynth={nextSynth} 
        // previousSynth={previousSynth}
        reloadEffectList={reloadEffectList}
        pullEffectsRepo={pullEffectsRepo}
        hardReloadCurrentEffect={hardReloadCurrentEffect} // Pass down the new function
        // Pass handlers to open selectors
        onOpenPresetSelect={openPresetSelect}
        onOpenAudioSelect={openAudioSelect} 
        onOpenVisualSelect={openVisualSelect} 
        // onOpenEffectSelect={openEffectSelect} // Replace this
        effectsRepoStatus={effectsRepoStatus}
        onCheckEffectsRepo={checkEffectsRepoStatus}
        devMode={devMode}
        // Still need a way to handle parameter changes, maybe pass `currentSynth.params`?
        // And a handler `onParamChange(paramName, value)` that sends SC messages
        // using `currentSynth.name` as the target synthdef.
      />
      {/* Render selectors conditionally based on new state */}
      { showPresetSelector && (
        <EffectSelectScreen
          type="preset"
          items={curatedPresets} // Use the filtered list of curated presets
          onSelect={handlePresetSelect} // Use the new preset handler
          currentSourcePath={currentSynth?.name} // Highlight based on current preset name
          onClose={() => setShowPresetSelector(false)}
        />
      )}
      { showAudioSelector && (
          <EffectSelectScreen
            type="audio"
            items={audioSources} 
            onSelect={handleAudioSelect} // Use the new handler
            // Pass current source for potential highlighting
            currentSourcePath={currentAudioSource} 
            // Need a way to close the selector without selection (e.g., back button)
            onClose={() => setShowAudioSelector(false)}
          />
      )}
       { showVisualSelector && (
          <EffectSelectScreen
            type="visual"
            items={visualizerList} // Use the new visualizerList state
            onSelect={handleVisualSelect} 
            currentSourcePath={currentVisualSource}
            onClose={() => setShowVisualSelector(false)}
          />
      )}
      {scError && (
          <div className="sc-error-display">
              <button 
                  className="sc-error-close" 
                  onClick={() => setScError(null)}
              >
                  ×
              </button>
              <div className="sc-error-header">
                  SuperCollider Compilation Error in {scError.file}:
              </div>
              <pre>{scError.errorMessage}</pre>
          </div>
      )}
    </div>
  );
}

export default App;
