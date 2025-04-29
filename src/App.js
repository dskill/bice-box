import React, { useState, useEffect, useMemo } from 'react';
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
    const handleEffectUpdate = (updatedEffect) => {
      console.log('Effect update received:', updatedEffect);
      
      if (!updatedEffect) {
        console.warn('Received undefined updatedEffect, skipping update');
        return;
      }

      if (typeof updatedEffect !== 'object' || typeof updatedEffect.name !== 'string') {
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

      // If the updated effect is the currently loaded preset, update sources
      setCurrentSynth(prevSynth => {
        if (prevSynth && prevSynth.name === updatedEffect.name) {
          console.log('Updating current synth preset and sources:', updatedEffect);
          setCurrentAudioSource(updatedEffect.scFilePath);
          setCurrentVisualSource(updatedEffect.p5SketchPath);
          // TODO: Potentially reload visual content if p5SketchPath changed
          // or if p5SketchContent is part of updatedEffect
          if (updatedEffect.p5SketchContent) {
            setCurrentVisualContent(updatedEffect.p5SketchContent);
          }
          return updatedEffect;
        }
        return prevSynth;
      });
    };

    if (electron) {
      console.log('Adding effect-updated listener');
      const removeListener = electron.ipcRenderer.on('effect-updated', handleEffectUpdate);
      return () => {
        console.log('Removing effect-updated listener');
        removeListener();
      };
    }
  }, []);

  // This useEffect might need adjustment based on how visual updates are handled
  useEffect(() => {
    if (electron) {
      const handleVisualEffectUpdate = (event, { name, p5SketchContent }) => {
         // Check if this update corresponds to the currently selected visual source
         // This might need refinement if multiple effects share the same sketch path.
         const currentPreset = synths.find(s => s.name === name);
         if (currentPreset && currentPreset.p5SketchPath === currentVisualSource) {
             console.log(`Visual content updated for ${name}`);
             setCurrentVisualContent(p5SketchContent);
         } else {
            console.log("Ignoring visual update for non-active source or preset name mismatch.");
         }
      };

      electron.ipcRenderer.on('visual-effect-updated', handleVisualEffectUpdate);

      return () => {
        electron.ipcRenderer.removeListener('visual-effect-updated', handleVisualEffectUpdate);
      };
    }
  }, [currentVisualSource, synths]); // Depend on currentVisualSource

  useEffect(() => {
    // Add this new effect for sc-ready
    if (electron) {
      const handleScReady = () => {
        console.log('SuperCollider is ready');
        // When SC is ready, ensure the current audio source is loaded
        if (currentAudioSource) {
          console.log(`SC ready, activating current audio source: ${currentAudioSource}`);
          electron.ipcRenderer.send('load-sc-file', currentAudioSource);
          // Also apply params from the original preset if it exists
           if (currentSynth && currentSynth.scFilePath === currentAudioSource && Array.isArray(currentSynth.params)) {
              currentSynth.params.forEach(param => {
                  if (param && typeof param.name === 'string' && param.value !== undefined) {
                      const scCode = `~${currentSynth.name}.set(\${param.name}, ${param.value});`;
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
      };

      electron.ipcRenderer.on('sc-ready', handleScReady);

      return () => {
        electron.ipcRenderer.removeListener('sc-ready', handleScReady);
      };
    }
  }, [currentAudioSource, currentSynth]); // Depend on currentAudioSource and currentSynth

  useEffect(() => {
    if (electron) {
        const handleScError = (errorData) => {
          console.log("SC error received:", errorData);
            setScError(errorData);
        };

        electron.ipcRenderer.on('sc-compilation-error', handleScError);

        return () => {
            electron.ipcRenderer.removeListener('sc-compilation-error', handleScError);
        };
    }
  }, []);

  const reloadEffectList = () => {
    return new Promise((resolve, reject) => {
      console.log("loadEffects function called");
      if (electron) {
        electron.ipcRenderer.send('reload-all-effects'); 
        electron.ipcRenderer.once('effects-data', (data) => {
          console.log("Received effects data:", data);
          if (Array.isArray(data) && data.length > 0) {
            setSynths(data);
            // Set the first synth as the initial preset and sources
            const firstSynth = data[0];
            setCurrentSynth(firstSynth);
            setCurrentAudioSource(firstSynth.scFilePath);
            setCurrentVisualSource(firstSynth.p5SketchPath);
            setCurrentVisualContent(firstSynth.p5SketchContent || ''); // Load initial visual content
            setCurrentAudioParams(firstSynth.params || []); // Load initial audio params
            
            console.log("Initial state set:", { 
              currentSynth: firstSynth.name, 
              audio: firstSynth.scFilePath, 
              visual: firstSynth.p5SketchPath 
            });
            
            // Automatically load the SC file for the first synth
            if (electron && firstSynth.scFilePath) {
              electron.ipcRenderer.send('load-sc-file', firstSynth.scFilePath);
              // We don't need set-current-effect anymore as state manages the active sources
              // electron.ipcRenderer.send('set-current-effect', firstSynth.name);
            }
            
            resolve(data);
          } else {
            const errorMessage = "Received empty or invalid effects data";
            console.warn(errorMessage, data);
            reject(new Error(errorMessage));
          }
        });

        electron.ipcRenderer.once('effects-error', (error) => {
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
    // Set the params based on the newly selected preset
    setCurrentAudioParams(selectedPreset.params || []);
    
    // Update audio source and load it
    if (selectedPreset.scFilePath) {
      setCurrentAudioSource(selectedPreset.scFilePath);
      if (electron) {
        electron.ipcRenderer.send('load-sc-file', selectedPreset.scFilePath);
        // Apply params after loading the synth def
        if (Array.isArray(selectedPreset.params)) {
          selectedPreset.params.forEach(param => {
            if (param && typeof param.name === 'string' && param.value !== undefined) {
              // Use preset name for synthdef target
              const scCode = `~${selectedPreset.name}.set(\${param.name}, ${param.value});`; 
              electron.ipcRenderer.send('send-to-supercollider', scCode);
            }
          });
        }
      }
    } else {
      setCurrentAudioSource(null); // No audio for this preset
      // Potentially send a command to stop the previous audio? TBD.
    }

    // Update visual source and load its content
    if (selectedPreset.p5SketchPath) {
      setCurrentVisualSource(selectedPreset.p5SketchPath);
      try {
        if (electron) {
          // Use the preloaded content if available, otherwise load it
          if (selectedPreset.p5SketchContent) {
             console.log("Using preloaded visual content for", presetName);
             setCurrentVisualContent(selectedPreset.p5SketchContent);
          } else {
             console.log("Loading visual content for", presetName);
             const sketchContent = await electron.ipcRenderer.invoke('load-p5-sketch', selectedPreset.p5SketchPath);
             setCurrentVisualContent(sketchContent);
             // Optional: Update the synth object in state with the loaded content?
          }
        }
      } catch (error) {
        console.error('Error loading p5 sketch for preset:', error);
        setCurrentVisualContent(''); // Clear visual on error
        setError(`Failed to load visual: ${error.message}`);
      }
    } else {
      setCurrentVisualSource(null);
      setCurrentVisualContent(''); // No visual for this preset
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

  const handleVisualSelect = async (p5SketchPath) => {
    if (!p5SketchPath) {
      console.log('Visual selection cancelled or invalid path');
      setShowVisualSelector(false);
      return;
    }
    console.log(`Selecting visual source: ${p5SketchPath}`);
    setCurrentVisualSource(p5SketchPath);
    try {
      if (electron) {
        console.log(`Loading visual content for: ${p5SketchPath}`);
        const sketchContent = await electron.ipcRenderer.invoke('load-p5-sketch', p5SketchPath);
        setCurrentVisualContent(sketchContent);
        console.log(`Visual content loaded successfully.`);
      }
    } catch (error) {
      console.error('Error loading selected p5 sketch:', error);
      setCurrentVisualContent(''); // Clear visual on error
      setError(`Failed to load visual: ${error.message}`);
    }
    setShowVisualSelector(false);
  };

  const pullEffectsRepo = () => {
    return new Promise((resolve, reject) => {
      console.log('Update Effects button clicked');
      if (electron && electron.ipcRenderer) {
        console.log('Sending pull-effects-repo message to main process');
        electron.ipcRenderer.send('pull-effects-repo');
        
        electron.ipcRenderer.once('pull-effects-repo-success', () => {
          console.log('Effects repo pulled successfully');
          reloadEffectList()
            .then(() => resolve())
            .catch(error => reject(error));
        });

        electron.ipcRenderer.once('pull-effects-repo-error', (error) => {
          console.error('Error pulling effects repo:', error);
          reject(new Error(error));
        });
      } else {
        console.error('ipcRenderer is not available');
        reject(new Error('ipcRenderer is not available'));
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
      const response = await new Promise((resolve, reject) => {
        electron.ipcRenderer.send('check-effects-repo');
        
        const timeout = setTimeout(() => {
          reject(new Error('Request timed out'));
        }, 10000);

        electron.ipcRenderer.once('effects-repo-status', (response) => {
          clearTimeout(timeout);
          console.log('Received repo status:', response);
          resolve(response.status || response);
        });
        
        electron.ipcRenderer.once('effects-repo-error', (error) => {
          clearTimeout(timeout);
          reject(error);
        });
      });

      console.log('Setting effects repo status with:', response);
      setEffectsRepoStatus({
        hasUpdates: Boolean(response.hasUpdates),
        lastChecked: response.lastChecked || new Date(),
        isChecking: false,
        error: null
      });
    } catch (error) {
      console.error('Error checking effects repo:', error);
      setEffectsRepoStatus(prev => ({
        ...prev,
        isChecking: false,
        error: error.message || 'Failed to check for updates'
      }));
    }
  };

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
        currentAudioParams={currentAudioParams} // Pass the audio params
        // currentSynth={currentSynth} // Remove if no longer needed by VisMode besides params
        // Remove next/previous handlers
        // nextSynth={nextSynth} 
        // previousSynth={previousSynth}
        reloadEffectList={reloadEffectList}
        pullEffectsRepo={pullEffectsRepo}
        // Pass handlers to open selectors
        onOpenPresetSelect={openPresetSelect}
        onOpenAudioSelect={openAudioSelect} 
        onOpenVisualSelect={openVisualSelect} 
        // onOpenEffectSelect={openEffectSelect} // Replace this
        effectsRepoStatus={effectsRepoStatus}
        onCheckEffectsRepo={checkEffectsRepoStatus}
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
