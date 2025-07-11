import React, { useState, useEffect, useMemo, useCallback } from 'react';
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
  const [currentScreen, setCurrentScreen] = useState('visualization'); // 'visualization' or 'select' - Will be replaced
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
        console.log("Received effects-data:", data);
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
    // When SC is ready, ensure the current audio source is loaded
    if (currentAudioSource) {
      console.log(`SC ready, activating current audio source: ${currentAudioSource}`);
      electron.ipcRenderer.send('load-sc-file-and-request-specs', currentAudioSource);
      // Also apply params from the original preset if it exists
       if (Array.isArray(currentAudioParams)) {
          currentAudioParams.forEach(param => {
              if (param && typeof param.name === 'string' && param.value !== undefined) {
                  if (electron && electron.ipcRenderer) {
                    electron.ipcRenderer.send('send-osc-to-sc', { address: '/effect/param/set', args: [param.name, param.value] });
                  }
              }
          });
       }
    } else if (synths.length > 0 && synths[0].scFilePath) {
        // Fallback to loading the preset's audio if no override is set
         console.log(`SC ready, activating preset audio source: ${synths[0].scFilePath}`);
         electron.ipcRenderer.send('load-sc-file-and-request-specs', synths[0].scFilePath);
    } else {
      console.log('SC ready, but no current audio source to activate');
    }
  }, [currentAudioSource, currentAudioParams, synths, electron]); // Added electron to dependencies

  useEffect(() => {
    // The initLoad ref is no longer needed here as the listener handles the initial setup.
    reloadEffectList();
    checkEffectsRepoStatus()
    .catch(err => {
      console.error("Failed to initialize:", err);
      setError("Failed to initialize. Check the console for more details.");
    });
  }, [reloadEffectList, checkEffectsRepoStatus]);

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
        console.log(`Updated synths: ${updatedSynths.length} effects, updated "${updatedEffect.name}"`);
        return updatedSynths;
      });

      // Check if the updated effect matches the current audio source (for direct audio selection)
      if (currentAudioSource && updatedEffect.scFilePath && 
          currentAudioSource.toLowerCase() === updatedEffect.scFilePath.toLowerCase()) {
        const paramCount = updatedEffect.params ? Object.keys(updatedEffect.params).length : 0;
        console.log(`Updated effect matches current audio source "${updatedEffect.name}": ${paramCount} parameters`);
        if (updatedEffect.params) {
          setCurrentAudioParams(updatedEffect.params);
        }
      }
    };

    const handleMcpAudioSourceChanged = (event, newAudioSource) => {
      console.log('MCP audio source changed to:', newAudioSource);
      setCurrentAudioSource(newAudioSource);
    };

    if (electron) {
      console.log('Adding effect-updated and mcp-audio-source-changed listeners for App.js');
      electron.ipcRenderer.on('effect-updated', handleEffectUpdate);
      electron.ipcRenderer.on('mcp-audio-source-changed', handleMcpAudioSourceChanged);
      return () => {
        console.log('Removing effect-updated and mcp-audio-source-changed listeners from App.js');
        electron.ipcRenderer.removeListener('effect-updated', handleEffectUpdate);
        electron.ipcRenderer.removeListener('mcp-audio-source-changed', handleMcpAudioSourceChanged);
      };
    }
  }, [currentAudioSource]); // Add currentAudioSource to dependency array

  const handleVisualSelect = useCallback(async (selectedVisual, options = {}) => { // Expects the full visual object
    const { fromMcp = false } = options;
    if (!selectedVisual || !selectedVisual.path || !selectedVisual.type) {
      console.log('Visual selection cancelled or invalid item');
      if (!fromMcp) setShowVisualSelector(false);
      return;
    }

    const { path: visualPath, type: visualType } = selectedVisual;
    console.log(`Selecting visual source: ${visualPath} (type: ${visualType})`);

    if (electron) {
      try {
        // Use the shared visualizer loading logic
        const result = await electron.ipcRenderer.invoke('load-visualizer-content', visualPath);
        
        if (result.type === 'p5') {
          setCurrentVisualSource(visualPath);
          setCurrentVisualContent(result.content);
          setCurrentShaderPath(null); // Clear shader if p5 is selected
          setCurrentShaderContent('');
          if (!fromMcp) electron.ipcRenderer.send('set-current-visual-source', visualPath); // For hot-reloading p5
          console.log(`P5 sketch content loaded successfully.`);
        } else if (result.type === 'shader') {
          setCurrentShaderPath(visualPath);
          setCurrentShaderContent(result.content);
          setCurrentVisualSource(null); // Clear p5 if shader is selected
          setCurrentVisualContent('');
          if (!fromMcp) electron.ipcRenderer.send('set-current-visual-source', visualPath); // For hot-reloading shader
          console.log(`Shader content loaded successfully.`);
        } else {
          console.warn(`Unknown visualizer result type: ${result.type}`);
          setError(`Unknown visualizer result type: ${result.type}`);
        }
      } catch (error) {
        console.error(`Error loading selected visual:`, error);
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
    if (!fromMcp) setShowVisualSelector(false);
  }, [setCurrentVisualSource, setCurrentVisualContent, setCurrentShaderPath, setCurrentShaderContent, setError, setShowVisualSelector]);

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
  const handleAutoVisualizerLoaded = useCallback((event, data) => {
    console.log(`App.js: Received auto-visualizer-loaded. Raw data:`, data);
    if (data && data.type && data.path && data.content !== undefined) {
      const { type, path, content } = data;
      console.log(`App.js: Auto-loading visualizer: ${path} (type: ${type})`);
      
      if (type === 'p5') {
        setCurrentVisualSource(path);
        setCurrentVisualContent(content);
        setCurrentShaderPath(null); // Clear shader if p5 is auto-loaded
        setCurrentShaderContent('');
        // Also send to main for hot-reloading
        electron.ipcRenderer.send('set-current-visual-source', path);
        console.log(`Auto-loaded p5 visualizer: ${path}`);
      } else if (type === 'shader') {
        setCurrentShaderPath(path);
        setCurrentShaderContent(content);
        setCurrentVisualSource(null); // Clear p5 if shader is auto-loaded
        setCurrentVisualContent('');
        // Also send to main for hot-reloading
        electron.ipcRenderer.send('set-current-visual-source', path);
        console.log(`Auto-loaded shader visualizer: ${path}`);
      } else {
        console.warn(`App.js: Unknown auto-visualizer type: ${type}`);
      }
    } else {
      console.warn('App.js: Received auto-visualizer-loaded with invalid or missing data payload.', data);
    }
  }, [setCurrentVisualSource, setCurrentVisualContent, setCurrentShaderPath, setCurrentShaderContent]);

  useEffect(() => {
    const handleMcpVisualSourceChanged = async (event, selectedVisual) => {
      console.log('MCP visual source changed to:', selectedVisual);
      if (!selectedVisual || !selectedVisual.path || !selectedVisual.type) {
        console.log('MCP visual selection invalid.');
        return;
      }
      await handleVisualSelect(selectedVisual, { fromMcp: true });
    };

    if (electron) {
      electron.ipcRenderer.on('mcp-visual-source-changed', handleMcpVisualSourceChanged);
      return () => {
        electron.ipcRenderer.removeListener('mcp-visual-source-changed', handleMcpVisualSourceChanged);
      };
    }
  }, [handleVisualSelect]);

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
  }, [currentVisualSource, synths, handleVisualEffectUpdate, electron]); // Depend on currentVisualSource, synths, and the new handler + electron

  useEffect(() => {
    // Add this new effect for sc-ready
    if (electron) {
      electron.ipcRenderer.on('sc-ready', handleScReady);

      return () => {
        electron.ipcRenderer.removeListener('sc-ready', handleScReady);
      };
    }
  }, [currentAudioSource, synths, handleScReady, electron]); // Added handleScReady and electron to dependencies

  useEffect(() => {
    if (electron) {
        electron.ipcRenderer.on('sc-compilation-error', handleScErrorCallback);

        return () => {
            electron.ipcRenderer.removeListener('sc-compilation-error', handleScErrorCallback);
        };
    }
  }, [handleScErrorCallback, electron]); // Added handleScErrorCallback and electron

  useEffect(() => {
    if (electron) {
        electron.ipcRenderer.on('shader-loading-error', handleShaderErrorCallback);

        return () => {
            electron.ipcRenderer.removeListener('shader-loading-error', handleShaderErrorCallback);
        };
    }
  }, [handleShaderErrorCallback, electron]);

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

  // Effect to initialize parameter values when a new effect is loaded
  useEffect(() => {
    if (currentAudioParams) {
      const defaultValues = Object.entries(currentAudioParams).reduce((acc, [name, spec]) => {
        acc[name] = spec.default;
        return acc;
      }, {});
      setParamValues(defaultValues);
    }
  }, [currentAudioParams]);

  const handleAudioSelect = useCallback((scFilePath) => {
    if (!scFilePath) {
      console.log('Audio selection cancelled or invalid path');
      setShowAudioSelector(false);
      return;
    }
    console.log(`Selecting audio source: ${scFilePath}`);
    setCurrentAudioSource(scFilePath);
    if (electron) {
      // Use the new handler that loads SC file AND requests specs
      electron.ipcRenderer.send('load-sc-file-and-request-specs', scFilePath);
      electron.ipcRenderer.send('set-current-audio-source', scFilePath); // Inform main process
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
    setParamValues(prev => ({ ...prev, [paramName]: value }));
    if (electron && electron.ipcRenderer) {
      electron.ipcRenderer.send('send-osc-to-sc', { address: '/effect/param/set', args: [paramName, value] });
    }
  }, []);

  // Handler for 'shader-effect-updated' IPC messages (GLSL hot-reload)
  const handleShaderEffectUpdated = useCallback((event, data) => {
    console.log('App.js: Received shader-effect-updated. Raw data:', data);

    // Validate the payload shape coming from main.js
    if (!data || typeof data !== 'object' || data.shaderPath === undefined || data.shaderContent === undefined) {
      console.warn('App.js: shader-effect-updated received with invalid payload.', data);
      return;
    }

    const { shaderPath, shaderContent } = data;

    // Only update the shader that is currently active in the UI
    if (currentShaderPath && currentShaderPath.toLowerCase() === shaderPath.toLowerCase()) {
      console.log('App.js: Updated shader matches active shader – applying new content.');
      setCurrentShaderContent(shaderContent);
    } else {
      console.log('App.js: Updated shader does not match the active shader – ignoring.');
    }
  }, [currentShaderPath, setCurrentShaderContent]);

  // Effect for general IPC listeners (like settings, wifi, etc.)
  useEffect(() => {
    electron.ipcRenderer.on('shader-effect-updated', handleShaderEffectUpdated);
    return () => {
        electron.ipcRenderer.removeAllListeners('shader-effect-updated');
    };
  }, [handleShaderEffectUpdated, electron]); // Add electron to dependency array

  // Effect for auto-visualizer-loaded IPC listener
  useEffect(() => {
    electron.ipcRenderer.on('auto-visualizer-loaded', handleAutoVisualizerLoaded);
    return () => {
        electron.ipcRenderer.removeAllListeners('auto-visualizer-loaded');
    };
  }, [handleAutoVisualizerLoaded, electron]);

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
          <div className="fader-container">
            {currentAudioParams && Object.entries(currentAudioParams).map(([paramName, paramSpec], index) => {
              const faderParam = {
                name: paramName,
                value: paramValues[paramName] !== undefined ? paramValues[paramName] : paramSpec.default,
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
