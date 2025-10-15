import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import VisualizationMode from './VisualizationMode';
import EffectSelectScreen from './EffectSelectScreen';
import Whisper from './Whisper';
import ParamFader from './ParamFader';
import EffectManagement from './EffectManagement';
import ClaudeConsole from './ClaudeConsole';
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
  const [currentAudioSource, setCurrentAudioSource] = useState(null); // Stores scFilePath
  const [currentVisualSource, setCurrentVisualSource] = useState(null); // Stores p5SketchPath
  const [currentVisualContent, setCurrentVisualContent] = useState(''); // Stores loaded p5 sketch content
  const [currentShaderPath, setCurrentShaderPath] = useState(null); // New state for shader path
  const [currentShaderContent, setCurrentShaderContent] = useState(''); // New state for shader content
  const [error, setError] = useState(null);
  const [showAudioSelector, setShowAudioSelector] = useState(false);
  const [showVisualSelector, setShowVisualSelector] = useState(false);
  const [visualizerList, setVisualizerList] = useState([]); // State for direct visualizers
  const [currentAudioParams, setCurrentAudioParams] = useState([]); // State for active audio params
  const [effectsRepoStatus, setEffectsRepoStatus] = useState({
    hasUpdates: false,
    lastChecked: null,
    isChecking: false,
    error: null
  });
  const [scError, setScError] = useState(null);
  const [shaderError, setShaderError] = useState(null);
  const [devMode, setDevMode] = useState(false);
  const [paramValues, setParamValues] = useState({});
  const [platformInfo, setPlatformInfo] = useState({ isLinux: false, isPi: false });

  // --- State for Claude Voice Interaction ---
  const [isClaudeConsoleOpen, setIsClaudeConsoleOpen] = useState(false);
  const [isRecording, setIsRecording] = useState(false);

  // --- State for Faders ---
  const [useRotatedLabels, setUseRotatedLabels] = useState(false);

  // Calculate responsive fader layout (moved from VisualizationMode)
  useEffect(() => {
    const calculateFaderLayout = () => {
      if (currentAudioParams) {
        const paramCount = Object.keys(currentAudioParams).length;
        if (paramCount === 0) return;

        const shouldRotate = paramCount > 6;
        setUseRotatedLabels(shouldRotate);

        const viewportWidth = window.innerWidth;
        const availableWidth = viewportWidth - 40; 
        
        const gridColumns = paramCount;
        
        const maxFaderWidth = shouldRotate ? 80 : 120;
        const minFaderWidth = shouldRotate ? 40 : 60;
        let faderWidth = (availableWidth - (15 * (gridColumns - 1))) / gridColumns;
        faderWidth = Math.max(minFaderWidth, Math.min(maxFaderWidth, faderWidth));
        
        document.documentElement.style.setProperty('--grid-columns', gridColumns.toString());
        document.documentElement.style.setProperty('--fader-width', `${faderWidth}px`);
      }
    };
    calculateFaderLayout();
    window.addEventListener('resize', calculateFaderLayout);
    return () => window.removeEventListener('resize', calculateFaderLayout);
  }, [currentAudioParams]);

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

  const reloadEffectList = useCallback(() => {
    console.log("Requesting a reload of all effects...");
    if (electron) {
        electron.ipcRenderer.send('reload-all-effects');
    } else {
        console.warn('Electron is not available');
    }
  }, []);

  useEffect(() => {
    const handleEffectsData = (event, data) => {
        // console.log("Received effects-data:", data); // Spam removed
        if (Array.isArray(data)) {
            setSynths(prevSynths => {
                // Only set initial effect if the synths list was previously empty
                if (prevSynths.length === 0 && data.length > 0) {
                    const firstEffect = data[0];
                    setCurrentAudioSource(firstEffect.scFilePath);
                    setCurrentAudioParams(firstEffect.params || {});
                    console.log("Initial audio effect set:", { 
                        audio: firstEffect.scFilePath
                    });
                }
                return data;
            });
        } else {
            console.warn("Received invalid audio effects data", data);
        }
    };

    if (electron) {
        electron.ipcRenderer.on('effects-data', handleEffectsData);
        return () => {
            electron.ipcRenderer.removeListener('effects-data', handleEffectsData);
        };
    }
  }, []);

  const checkEffectsRepoStatus = useCallback(async () => {
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
  }, []);

  const handleScReady = useCallback((event) => {
    console.log('SuperCollider is ready');
    // On SC ready, request activation via unified action by effect name
    if (currentAudioSource && synths && synths.length > 0) {
      const match = synths.find(s => s.scFilePath && s.scFilePath.toLowerCase() === currentAudioSource.toLowerCase());
      if (match && electron && electron.ipcRenderer) {
        electron.ipcRenderer.send('effects/actions:set_current_effect', { name: match.name });
        console.log(`Requested activation of effect: ${match.name}`);
      }
    } else if (synths.length > 0) {
      const first = synths[0];
      if (first && electron && electron.ipcRenderer) {
        electron.ipcRenderer.send('effects/actions:set_current_effect', { name: first.name });
        console.log(`Requested activation of first effect: ${first.name}`);
      }
    }
  }, [currentAudioSource, synths]);

  useEffect(() => {
    // The initLoad ref is no longer needed here as the listener handles the initial setup.
    reloadEffectList();
    checkEffectsRepoStatus()
    .catch(err => {
      console.error("Failed to initialize:", err);
      setError("Failed to initialize. Check the console for more details.");
    });
  }, [reloadEffectList, checkEffectsRepoStatus]);

  // Legacy event listeners removed - now using unified effects/state

  const handleVisualSelect = useCallback(async (selectedVisual, options = {}) => { // Expects the full visual object
    const { fromMcp = false } = options;
    if (!selectedVisual || !selectedVisual.path || !selectedVisual.type) {
      console.log('Visual selection cancelled or invalid item');
      if (!fromMcp) setShowVisualSelector(false);
      return;
    }

    const visualizerName = selectedVisual.name;
    console.log(`Selecting visual: ${visualizerName}`);

    if (electron && electron.ipcRenderer && visualizerName) {
      // Use unified action to set current visualizer
      electron.ipcRenderer.send('visualizers/actions:set_current_visualizer', { name: visualizerName });
      
      // Also send the legacy event for hot-reloading (if not from MCP)
      if (!fromMcp) {
        electron.ipcRenderer.send('set-current-visual-source', selectedVisual.path);
      }
    }
    if (!fromMcp) setShowVisualSelector(false);
  }, [setShowVisualSelector]);

  const pullEffectsRepo = () => {
    return new Promise((resolve, reject) => {
      if (electron) {
        electron.ipcRenderer.send('pull-effects-repo');
        electron.ipcRenderer.once('pull-effects-repo-success', (event, message) => {
          console.log('Effects repo pulled successfully:', message);
          // After pull, main.js reloads effects and sends 'effects-data' automatically.
          // The persistent listener will update the state.
          resolve(message);
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

  // Handler for 'auto-visualizer-loaded' IPC messages (from SC file comments)
  const handleAutoVisualizerLoaded = useCallback(async (event, data) => {
    console.log(`App.js: Received auto-visualizer-loaded. Raw data:`, data);
    if (data && data.type && data.path && data.content !== undefined) {
      const { type, path } = data;
      console.log(`App.js: Auto-loading visualizer: ${path} (type: ${type})`);
      
      // First, get the list of visualizers to find the name
      try {
        const visualizers = await electron.ipcRenderer.invoke('visualizers/queries:list_visualizers');
        if (visualizers && visualizers.visualizers) {
          // Find the visualizer that matches this path
          const matchingVisualizer = visualizers.visualizers.find(v => v.path === path);
          if (matchingVisualizer) {
            // Use the unified action to set the current visualizer
            electron.ipcRenderer.send('visualizers/actions:set_current_visualizer', { name: matchingVisualizer.name });
            console.log(`Auto-loaded ${type} visualizer using unified action:`, matchingVisualizer.name);
          } else {
            console.warn(`Could not find visualizer with path: ${path}`);
            // Fallback to just setting visual source for hot-reloading
            electron.ipcRenderer.send('set-current-visual-source', path);
          }
        } else {
          // Fallback to just setting visual source for hot-reloading
          electron.ipcRenderer.send('set-current-visual-source', path);
        }
      } catch (error) {
        console.error('Error auto-loading visualizer:', error);
        // Fallback to just setting visual source for hot-reloading
        electron.ipcRenderer.send('set-current-visual-source', path);
      }
    } else {
      console.warn('App.js: Received auto-visualizer-loaded with invalid or missing data payload.', data);
    }
  }, []);

  // Legacy mcp-visual-source-changed listener removed - now using unified visualizers/state

  const handleVisualEffectUpdate = useCallback((event, payload) => {
    if (!payload) {
        console.warn('App.js: visual-effect-updated received no payload.');
        return;
    }
    const { p5SketchPath: updatedPath, p5SketchContent } = payload; 

    // Only apply if this is a hot-reload update (path matches current)
    if (currentVisualSource && currentVisualSource.toLowerCase() === updatedPath.toLowerCase()) {
      console.log('App.js: Hot-reload p5 visual update for:', updatedPath);
      setCurrentVisualContent(p5SketchContent);
    } else {
      console.log('App.js: Ignoring visual-effect-updated - likely handled by visualizers/state');
    }
  }, [currentVisualSource, setCurrentVisualContent]);

  const handleScErrorCallback = useCallback((event, errorData) => {
    console.log("SC error received:", errorData);
    setScError(errorData);
  }, [setScError]);

  const handleShaderErrorCallback = useCallback((event, errorData) => {
    console.log("Shader loading error received:", errorData);
    setShaderError(errorData);
  }, [setShaderError]);

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
  }, [currentVisualSource, synths, handleVisualEffectUpdate]);

  useEffect(() => {
    // Add this new effect for sc-ready
    if (electron) {
      electron.ipcRenderer.on('sc-ready', handleScReady);

      return () => {
        electron.ipcRenderer.removeListener('sc-ready', handleScReady);
      };
    }
  }, [currentAudioSource, synths, handleScReady]);

  useEffect(() => {
    if (electron) {
        electron.ipcRenderer.on('sc-compilation-error', handleScErrorCallback);

        return () => {
            electron.ipcRenderer.removeListener('sc-compilation-error', handleScErrorCallback);
        };
    }
  }, [handleScErrorCallback]);

  useEffect(() => {
    if (electron) {
        electron.ipcRenderer.on('shader-loading-error', handleShaderErrorCallback);

        return () => {
            electron.ipcRenderer.removeListener('shader-loading-error', handleShaderErrorCallback);
        };
    }
  }, [handleShaderErrorCallback]);

  useEffect(() => {
    if (electron && electron.ipcRenderer) {
      // Get initial dev mode state and platform info
      electron.ipcRenderer.invoke('get-dev-mode').then(setDevMode);
      electron.ipcRenderer.invoke('get-platform-info').then(setPlatformInfo);

      // Listen for changes to dev mode
      electron.ipcRenderer.on('dev-mode-changed', handleDevModeChange);

      return () => {
        electron.ipcRenderer.removeListener('dev-mode-changed', handleDevModeChange);
      };
    }
  }, [handleDevModeChange]);

  // Subscribe to unified effects/state broadcast from main
  const lastEffectUpdateRef = useRef({ name: null, paramValues: null, timestamp: 0 });
  
  useEffect(() => {
    // Handle effects state updates from SuperCollider
    const handleEffectsState = (event, payload) => {
      if (!payload || !payload.effect) return;
      const { effect } = payload;
      
      // Debounce duplicate updates with identical parameter values
      const now = Date.now();
      const paramValuesStr = JSON.stringify(effect.paramValues || {});
      if (lastEffectUpdateRef.current.name === effect.name && 
          lastEffectUpdateRef.current.paramValues === paramValuesStr &&
          now - lastEffectUpdateRef.current.timestamp < 50) {
        // Ignore duplicate parameter updates
        return;
      }
      
      lastEffectUpdateRef.current = { name: effect.name, paramValues: paramValuesStr, timestamp: now };
      
      // Parameter updates received from SuperCollider
      
      if (effect.scFilePath) setCurrentAudioSource(effect.scFilePath);
      if (effect.paramSpecs) setCurrentAudioParams(effect.paramSpecs);
      if (effect.paramValues) {
        // Update UI parameter values
        setParamValues(effect.paramValues);
      }
    };
    if (electron && electron.ipcRenderer) {
      electron.ipcRenderer.on('effects/state', handleEffectsState);
      return () => {
        electron.ipcRenderer.removeListener('effects/state', handleEffectsState);
      };
    }
  }, []);

  // Subscribe to unified visualizers/state broadcast from main
  const lastVisualizerUpdateRef = useRef({ name: null, timestamp: 0 });
  
  useEffect(() => {
    if (!electron || !electron.ipcRenderer) return;
    
    const handleVisualizersState = (event, payload) => {
      if (!payload || !payload.visualizer) return;
      const { visualizer } = payload;
      
      // Debounce duplicate updates from multiple listeners (React StrictMode)
      const now = Date.now();
      if (lastVisualizerUpdateRef.current.name === visualizer.name && 
          now - lastVisualizerUpdateRef.current.timestamp < 50) {
        console.log('App.js: Ignoring duplicate visualizers/state for:', visualizer.name);
        return;
      }
      
      lastVisualizerUpdateRef.current = { name: visualizer.name, timestamp: now };
      
      if (visualizer.type === 'shader') {
        setCurrentShaderPath(visualizer.path);
        setCurrentShaderContent(visualizer.content || '');
        setCurrentVisualSource(null);
        setCurrentVisualContent('');
      } else if (visualizer.type === 'p5') {
        setCurrentVisualSource(visualizer.path);
        setCurrentVisualContent(visualizer.content || '');
        setCurrentShaderPath(null);
        setCurrentShaderContent('');
      }
    };
    
    electron.ipcRenderer.on('visualizers/state', handleVisualizersState);
    return () => {
      electron.ipcRenderer.removeListener('visualizers/state', handleVisualizersState);
    };
  }, []);

  const handleAudioSelect = useCallback((selected) => {
    if (!selected) {
      console.log('Audio selection cancelled or invalid path');
      setShowAudioSelector(false);
      return;
    }
    const scFilePath = selected.scFilePath || selected;
    const effectName = selected.name;
    console.log(`Selecting audio source: ${scFilePath}`);
    if (scFilePath) setCurrentAudioSource(scFilePath);
    if (electron && electron.ipcRenderer && effectName) {
      electron.ipcRenderer.send('effects/actions:set_current_effect', { name: effectName });
    }
    setShowAudioSelector(false);
  }, [setCurrentAudioSource, setShowAudioSelector]);

  // Opens the audio selector
  const openAudioSelect = () => {
    console.log("Open Audio Selector triggered");
    setShowAudioSelector(true);
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

  // --- Handlers for Claude Voice Interaction ---
  const handleOpenConsole = useCallback(() => {
    setIsClaudeConsoleOpen(true);
  }, []);

  const handleCloseClaudeConsole = useCallback(() => {
    setIsClaudeConsoleOpen(false);
  }, []);

  const handleInteractionStart = useCallback((e) => {
    e.preventDefault(); // Stop touch from firing mouse events
    setIsRecording(true);
  }, []);

  const handleInteractionEnd = useCallback((e) => {
    e.preventDefault();
    setIsRecording(false);
  }, []);

  // --- Handlers for SC/Effects ---
  const handleTranscriptionComplete = useCallback((text) => {
    console.log("Transcription complete:", text);
    if (electron) {
      electron.ipcRenderer.send('send-to-claude', text);
    }
  }, []);

  const handleParamChange = useCallback((paramName, value) => {
    // Re-enabled: Fixed the actual feedback loop in main.js
    if (electron && electron.ipcRenderer) {
      electron.ipcRenderer.send('effects/actions:set_effect_parameters', { params: { [paramName]: value } });
    }
  }, []);

  // Handler for 'shader-effect-updated' IPC messages (primarily for hot-reload)
  const handleShaderEffectUpdated = useCallback((event, data) => {
    console.log('App.js: Received shader-effect-updated. Raw data:', data);

    // Validate the payload shape coming from main.js
    if (!data || typeof data !== 'object' || data.shaderPath === undefined || data.shaderContent === undefined) {
      console.warn('App.js: shader-effect-updated received with invalid payload.', data);
      return;
    }

    const { shaderPath, shaderContent } = data;
    
    // Only apply if this is a hot-reload update (path matches current)
    if (currentShaderPath && currentShaderPath.toLowerCase() === shaderPath.toLowerCase()) {
      console.log('App.js: Hot-reload shader update for:', shaderPath);
      setCurrentShaderContent(shaderContent);
    } else {
      console.log('App.js: Ignoring shader-effect-updated - likely handled by visualizers/state');
    }
  }, [currentShaderPath, setCurrentShaderContent]);

  // Handler for MIDI CC 117 push-to-talk events
  const handleMidiCC117 = useCallback((event, data) => {
    console.log('App.js: Received MIDI CC117 push-to-talk:', data);
    
    if (data && typeof data.pressed === 'boolean') {
      if (data.pressed) {
        // CC 117 pressed - start recording
        console.log('MIDI CC117: Starting recording');
        setIsRecording(true);
      } else {
        // CC 117 released - stop recording
        console.log('MIDI CC117: Stopping recording');
        setIsRecording(false);
      }
    }
  }, []);

  // Effect for general IPC listeners (like settings, wifi, etc.)
  useEffect(() => {
    electron.ipcRenderer.on('shader-effect-updated', handleShaderEffectUpdated);
    return () => {
        electron.ipcRenderer.removeAllListeners('shader-effect-updated');
    };
  }, [handleShaderEffectUpdated]);

  // Effect for auto-visualizer-loaded IPC listener
  useEffect(() => {
    electron.ipcRenderer.on('auto-visualizer-loaded', handleAutoVisualizerLoaded);
    return () => {
        electron.ipcRenderer.removeAllListeners('auto-visualizer-loaded');
    };
  }, [handleAutoVisualizerLoaded]);

  // Effect for MIDI CC 117 push-to-talk IPC listener
  useEffect(() => {
    if (electron && electron.ipcRenderer) {
      electron.ipcRenderer.on('midi-cc117', handleMidiCC117);
      return () => {
        electron.ipcRenderer.removeAllListeners('midi-cc117');
      };
    }
  }, [handleMidiCC117]);

  if (error) {
    return <div className="error-message">{error}</div>;
  }

  return (
    <div className="App" style={styles.app}>
      <EffectManagement 
        reloadEffectList={reloadEffectList} 
        pullEffectsRepo={pullEffectsRepo}
        effectsRepoStatus={effectsRepoStatus}
        onCheckEffectsRepo={checkEffectsRepoStatus}
      />
      <Whisper 
        isRecording={isRecording}
        onTranscriptionComplete={handleTranscriptionComplete}
      />

      <ClaudeConsole
        isOpen={isClaudeConsoleOpen}
        onOpen={handleOpenConsole}
        onClose={handleCloseClaudeConsole}
        isRecording={isRecording}
        onRecordingStart={handleInteractionStart}
        onRecordingEnd={handleInteractionEnd}
        devMode={devMode}
      />

      <VisualizationMode
        // Pass necessary state and handlers
        currentAudioSourcePath={currentAudioSource}
        currentVisualSourcePath={currentVisualSource}
        currentVisualContent={currentVisualContent}
        currentShaderPath={currentShaderPath}
        currentShaderContent={currentShaderContent}
        currentAudioParams={currentAudioParams}
        // Pass handlers to open selectors
        onOpenAudioSelect={openAudioSelect} 
        onOpenVisualSelect={openVisualSelect} 
        devMode={devMode}
        paramValues={paramValues}
      />

      <div className="effect-nav-buttons-container">
        <div className="visualization-controls">
          {/* Floating Claude Controls above faders - Desktop only */}
          {devMode && !platformInfo.isPi && (
            <div className="floating-claude-controls">
              <input
                type="text"
                className="floating-claude-input"
                placeholder="Type to AI..."
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && e.target.value.trim() && electron) {
                    const message = e.target.value.trim();
                    electron.ipcRenderer.send('send-to-claude', message);
                    e.target.value = '';
                  }
                }}
              />
              <button 
                className="floating-claude-send"
                onClick={(e) => {
                  const input = e.target.parentElement.querySelector('.floating-claude-input');
                  if (input.value.trim() && electron) {
                    const message = input.value.trim();
                    electron.ipcRenderer.send('send-to-claude', message);
                    input.value = '';
                  }
                }}
              >
                Send
              </button>
            </div>
          )}
          <div className="fader-container">
            {currentAudioParams && Object.entries(currentAudioParams)
              .sort(([a], [b]) => a.localeCompare(b)) // Sort parameters alphabetically
              .map(([paramName, paramSpec], index) => {
                const currentValue = paramValues[paramName] !== undefined ? paramValues[paramName] : paramSpec.default;
                
                // MIDI debug: log fader values when they change from MIDI
                if (paramValues[paramName] !== undefined) {
                  const prevValue = window._lastFaderValues?.[paramName];
                  if (prevValue !== currentValue) {
                    //console.log(`[MIDI DEBUG] Fader ${paramName} value changed: ${prevValue} -> ${currentValue}`);
                    if (!window._lastFaderValues) window._lastFaderValues = {};
                    window._lastFaderValues[paramName] = currentValue;
                  }
                }
                
                const faderParam = {
                  name: paramName,
                  value: currentValue,
                  range: [paramSpec.minval, paramSpec.maxval],
                  units: paramSpec.units || '',
                  index: index,
                };
                return (
                  <div key={`${currentAudioSource}-${paramName}`}>
                    <ParamFader 
                      param={faderParam} 
                      onParamChange={handleParamChange}
                      useRotatedLabels={useRotatedLabels}
                    />
                  </div>
                );
              })}
          </div>
        </div>
      </div>

      {/* Render selectors conditionally based on new state */}
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
      {shaderError && (
          <div className="shader-error-display">
              <button 
                  className="shader-error-close" 
                  onClick={() => setShaderError(null)}
              >
                  ×
              </button>
              <div className="shader-error-header">
                  Shader Loading Error for "{shaderError.shaderName}":
              </div>
              <pre>{shaderError.errorMessage}</pre>
          </div>
      )}
    </div>
  );
}

export default App;
