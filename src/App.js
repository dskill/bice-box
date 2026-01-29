import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import VisualizationMode from './VisualizationMode';
import EffectSelectScreen from './EffectSelectScreen';
import Whisper from './Whisper';
import ParamFader from './ParamFader';
import EffectManagement from './EffectManagement';
import ClaudeConsole from './ClaudeConsole';
import ipcProxy from './ipcProxy';
import './App.css';

const styles = {
  app: {
    cursor: 'none',
    userSelect: 'none',
    WebkitUserSelect: 'none',
    MozUserSelect: 'none',
    msUserSelect: 'none',
  }
};

// Use ipcProxy which works for both Electron and remote browser
const electron = window.electron;
const ipc = ipcProxy;

function App() {
  const [synths, setSynths] = useState([]);
  const [currentAudioSource, setCurrentAudioSource] = useState(null); // Stores scFilePath
  const [currentVisualSource, setCurrentVisualSource] = useState(null); // Stores p5SketchPath
  const [currentVisualContent, setCurrentVisualContent] = useState(''); // Stores loaded p5 sketch content
  const [currentShaderPath, setCurrentShaderPath] = useState(null); // New state for shader path
  const [currentShaderContent, setCurrentShaderContent] = useState(''); // New state for shader content
  const [error, setError] = useState(null);
  const [showEffectSelector, setShowEffectSelector] = useState(false);
  const [lastEffectTab, setLastEffectTab] = useState('audio'); // Remember last tab
  const [lastEffectCategory, setLastEffectCategory] = useState(null); // Remember last category
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

  // --- State for Remote Connection (when running in browser) ---
  const [connectionStatus, setConnectionStatus] = useState('connected');
  const isRemoteMode = !electron;

  // --- State for Faders ---
  const [useRotatedLabels, setUseRotatedLabels] = useState(false);

  // Subscribe to connection status changes in remote mode
  useEffect(() => {
    if (isRemoteMode) {
      return ipc.onStatusChange(setConnectionStatus);
    }
  }, [isRemoteMode]);

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

  const audioSources = useMemo(() => {
    const sources = new Map();
    synths.forEach(synth => {
      if (synth.scFilePath && !sources.has(synth.scFilePath)) {
        sources.set(synth.scFilePath, {
          name: synth.name,
          scFilePath: synth.scFilePath,
          category: synth.category || 'Uncategorized',
          description: synth.description || ''
        });
      }
    });
    return Array.from(sources.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [synths]);

  const reloadEffectList = useCallback(() => {
    ipc.send('reload-all-effects');
  }, []);

  useEffect(() => {
    const handleEffectsData = (event, data) => {
      if (!Array.isArray(data)) {
        console.warn("Received invalid audio effects data", data);
        return;
      }

      setSynths(prevSynths => {
        if (prevSynths.length === 0 && data.length > 0) {
          const firstEffect = data[0];
          setCurrentAudioSource(firstEffect.scFilePath);
          setCurrentAudioParams(firstEffect.params || {});
        }
        return data;
      });
    };

    const unsubscribe = ipc.on('effects-data', handleEffectsData);
    return () => {
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      } else {
        ipc.removeListener('effects-data', handleEffectsData);
      }
    };
  }, []);

  const checkEffectsRepoStatus = useCallback(async () => {
    // Only check effects repo when running in Electron
    if (!electron) return;

    setEffectsRepoStatus(prev => ({ ...prev, isChecking: true, error: null }));

    try {
      const statusPayload = await new Promise((resolve, reject) => {
        ipc.send('check-effects-repo');

        const timeout = setTimeout(() => {
          ipc.removeAllListeners('effects-repo-status');
          ipc.removeAllListeners('effects-repo-error');
          reject(new Error('Request to check effects repo timed out'));
        }, 10000);

        ipc.once('effects-repo-status', (event, data) => {
          clearTimeout(timeout);
          ipc.removeAllListeners('effects-repo-error');
          if (typeof data === 'object' && data !== null && typeof data.hasUpdates === 'boolean') {
            resolve(data);
          } else {
            reject(new Error('Invalid data received for effects repo status'));
          }
        });

        ipc.once('effects-repo-error', (event, errorDetails) => {
          clearTimeout(timeout);
          ipc.removeAllListeners('effects-repo-status');
          reject(errorDetails);
        });
      });

      setEffectsRepoStatus({
        hasUpdates: Boolean(statusPayload.hasUpdates),
        lastChecked: new Date(),
        isChecking: false,
        error: null
      });
    } catch (errorObject) {
      console.error('Error checking effects repo:', errorObject);
      setEffectsRepoStatus(prev => ({
        ...prev,
        isChecking: false,
        error: errorObject.error || errorObject.message || 'Failed to check for updates'
      }));
    }
  }, []);

  const handleScReady = useCallback(() => {
    if (currentAudioSource && synths?.length > 0) {
      const match = synths.find(s => s.scFilePath?.toLowerCase() === currentAudioSource.toLowerCase());
      if (match) {
        ipc.send('effects/actions:set_current_effect', { name: match.name });
      }
    } else if (synths?.length > 0) {
      ipc.send('effects/actions:set_current_effect', { name: synths[0].name });
    }
  }, [currentAudioSource, synths]);

  useEffect(() => {
    reloadEffectList();
    checkEffectsRepoStatus().catch(err => {
      console.error("Failed to initialize:", err);
      setError("Failed to initialize. Check the console for more details.");
    });
  }, [reloadEffectList, checkEffectsRepoStatus]);

  const handleVisualSelect = useCallback(async (selectedVisual, options = {}) => {
    const { fromMcp = false } = options;
    if (!selectedVisual?.path || !selectedVisual?.type) {
      if (!fromMcp) setShowEffectSelector(false);
      return;
    }

    if (selectedVisual.name) {
      ipc.send('visualizers/actions:set_current_visualizer', { name: selectedVisual.name });
      if (!fromMcp) {
        ipc.send('set-current-visual-source', selectedVisual.path);
      }
    }
    if (!fromMcp) setShowEffectSelector(false);
  }, []);

  const pullEffectsRepo = () => {
    return new Promise((resolve, reject) => {
      // Only available in Electron mode
      if (!electron) {
        reject(new Error("Electron not available"));
        return;
      }

      ipc.send('pull-effects-repo');
      ipc.once('pull-effects-repo-success', (event, message) => {
        resolve(message);
      });
      ipc.once('pull-effects-repo-error', (event, error) => {
        console.error('Error pulling effects repo:', error);
        setError(`Failed to pull effects repo: ${error}`);
        reject(new Error(error));
      });
    });
  };

  const handleAutoVisualizerLoaded = useCallback(async (event, data) => {
    if (!data?.type || !data?.path || data.content === undefined) return;

    const { path } = data;
    try {
      const visualizers = await ipc.invoke('visualizers/queries:list_visualizers');
      const matchingVisualizer = visualizers?.visualizers?.find(v => v.path === path);
      if (matchingVisualizer) {
        ipc.send('visualizers/actions:set_current_visualizer', { name: matchingVisualizer.name });
      } else {
        ipc.send('set-current-visual-source', path);
      }
    } catch (error) {
      console.error('Error auto-loading visualizer:', error);
      ipc.send('set-current-visual-source', path);
    }
  }, []);

  const handleVisualEffectUpdate = useCallback((event, payload) => {
    if (!payload) return;

    const { p5SketchPath: updatedPath, p5SketchContent } = payload;
    if (currentVisualSource?.toLowerCase() === updatedPath?.toLowerCase()) {
      setCurrentVisualContent(p5SketchContent);
    }
  }, [currentVisualSource, setCurrentVisualContent]);

  const handleScErrorCallback = useCallback((event, errorData) => {
    setScError(errorData);
  }, [setScError]);

  const handleShaderErrorCallback = useCallback((event, errorData) => {
    setShaderError(errorData);
  }, [setShaderError]);

  const handleDevModeChange = useCallback((event, newMode) => {
    console.log('[App] dev-mode-changed received:', newMode);
    setDevMode(newMode);
  }, [setDevMode]);

  useEffect(() => {
    const unsubscribe = ipc.on('visual-effect-updated', handleVisualEffectUpdate);
    return () => {
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      } else {
        ipc.removeListener('visual-effect-updated', handleVisualEffectUpdate);
      }
    };
  }, [currentVisualSource, synths, handleVisualEffectUpdate]);

  useEffect(() => {
    const unsubscribe = ipc.on('sc-ready', handleScReady);
    return () => {
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      } else {
        ipc.removeListener('sc-ready', handleScReady);
      }
    };
  }, [currentAudioSource, synths, handleScReady]);

  useEffect(() => {
    const unsubscribe = ipc.on('sc-compilation-error', handleScErrorCallback);
    return () => {
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      } else {
        ipc.removeListener('sc-compilation-error', handleScErrorCallback);
      }
    };
  }, [handleScErrorCallback]);

  useEffect(() => {
    const unsubscribe = ipc.on('shader-loading-error', handleShaderErrorCallback);
    return () => {
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      } else {
        ipc.removeListener('shader-loading-error', handleShaderErrorCallback);
      }
    };
  }, [handleShaderErrorCallback]);

  useEffect(() => {
    ipc.invoke('get-dev-mode').then(setDevMode).catch(() => setDevMode(false));
    ipc.invoke('get-platform-info').then(setPlatformInfo).catch(() => {});
    const unsubscribe = ipc.on('dev-mode-changed', handleDevModeChange);

    return () => {
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      } else {
        ipc.removeListener('dev-mode-changed', handleDevModeChange);
      }
    };
  }, [handleDevModeChange]);

  const lastEffectUpdateRef = useRef({ name: null, paramValues: null, timestamp: 0 });

  useEffect(() => {
    const handleEffectsState = (event, payload) => {
      if (!payload?.effect) return;
      const { effect } = payload;

      const now = Date.now();
      const paramValuesStr = JSON.stringify(effect.paramValues || {});
      if (lastEffectUpdateRef.current.name === effect.name &&
          lastEffectUpdateRef.current.paramValues === paramValuesStr &&
          now - lastEffectUpdateRef.current.timestamp < 50) {
        return;
      }

      lastEffectUpdateRef.current = { name: effect.name, paramValues: paramValuesStr, timestamp: now };

      if (effect.scFilePath) setCurrentAudioSource(effect.scFilePath);
      if (effect.paramSpecs) setCurrentAudioParams(effect.paramSpecs);
      if (effect.paramValues) setParamValues(effect.paramValues);
    };

    const unsubscribe = ipc.on('effects/state', handleEffectsState);
    return () => {
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      } else {
        ipc.removeListener('effects/state', handleEffectsState);
      }
    };
  }, []);

  const lastVisualizerUpdateRef = useRef({ name: null, timestamp: 0 });

  useEffect(() => {
    const handleVisualizersState = (event, payload) => {
      if (!payload?.visualizer) return;
      const { visualizer } = payload;

      const now = Date.now();
      if (lastVisualizerUpdateRef.current.name === visualizer.name &&
          now - lastVisualizerUpdateRef.current.timestamp < 50) {
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

    const unsubscribe = ipc.on('visualizers/state', handleVisualizersState);
    return () => {
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      } else {
        ipc.removeListener('visualizers/state', handleVisualizersState);
      }
    };
  }, []);

  const handleAudioSelect = useCallback((selected) => {
    if (!selected) {
      setShowEffectSelector(false);
      return;
    }

    const scFilePath = selected.scFilePath || selected;
    const effectName = selected.name;
    if (scFilePath) setCurrentAudioSource(scFilePath);
    if (effectName) {
      ipc.send('effects/actions:set_current_effect', { name: effectName });
    }
    setShowEffectSelector(false);
  }, [setCurrentAudioSource]);

  const openEffectSelect = async () => {
    try {
      const fetchedVisualizers = await ipc.invoke('get-visualizers');
      setVisualizerList(fetchedVisualizers || []);
    } catch (err) {
      console.error("Failed to fetch visualizers:", err);
      setVisualizerList([]);
    }
    setShowEffectSelector(true);
  };

  const handleOpenConsole = useCallback(() => {
    setIsClaudeConsoleOpen(true);
  }, []);

  const handleCloseClaudeConsole = useCallback(() => {
    setIsClaudeConsoleOpen(false);
  }, []);

  const [isClaudeResponding, setIsClaudeResponding] = useState(false);

  const handleInteractionStart = useCallback((e) => {
    e?.preventDefault();
    if (isClaudeResponding) return;
    setIsRecording(true);
  }, [isClaudeResponding]);

  const handleInteractionEnd = useCallback((e) => {
    e?.preventDefault();
    setIsRecording(false);
  }, []);

  const handleCancelClaude = useCallback(() => {
    if (isClaudeResponding) {
      setIsClaudeResponding(false);
      ipc.send('cancel-claude');
    }
  }, [isClaudeResponding]);

  const handleTranscriptionComplete = useCallback((text) => {
    ipc.send('send-to-claude', text);
  }, []);

  const handleParamChange = useCallback((paramName, value) => {
    ipc.send('effects/actions:set_effect_parameters', { params: { [paramName]: value } });
  }, []);

  const handleShaderEffectUpdated = useCallback((event, data) => {
    if (!data?.shaderPath || data.shaderContent === undefined) return;

    if (currentShaderPath?.toLowerCase() === data.shaderPath.toLowerCase()) {
      setCurrentShaderContent(data.shaderContent);
    }
  }, [currentShaderPath, setCurrentShaderContent]);

  const handleMidiCC117 = useCallback((event, data) => {
    if (typeof data?.pressed !== 'boolean') return;

    if (data.pressed) {
      if (isClaudeResponding) {
        handleCancelClaude();
      } else {
        if (!isClaudeConsoleOpen) setIsClaudeConsoleOpen(true);
        setIsRecording(true);
      }
    } else {
      setIsRecording(false);
    }
  }, [isClaudeResponding, isClaudeConsoleOpen, handleCancelClaude]);

  useEffect(() => {
    const unsubscribe = ipc.on('shader-effect-updated', handleShaderEffectUpdated);
    return () => {
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      } else {
        ipc.removeAllListeners('shader-effect-updated');
      }
    };
  }, [handleShaderEffectUpdated]);

  useEffect(() => {
    const unsubscribe = ipc.on('auto-visualizer-loaded', handleAutoVisualizerLoaded);
    return () => {
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      } else {
        ipc.removeAllListeners('auto-visualizer-loaded');
      }
    };
  }, [handleAutoVisualizerLoaded]);

  useEffect(() => {
    const unsubscribe = ipc.on('midi-cc117', handleMidiCC117);
    return () => {
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      } else {
        ipc.removeAllListeners('midi-cc117');
      }
    };
  }, [handleMidiCC117]);

  if (error) {
    return <div className="error-message">{error}</div>;
  }

  return (
    <div className={`App${isRemoteMode ? ' remote-mode' : ''}`} style={styles.app}>
      {/* Connection status indicator for remote mode */}
      {isRemoteMode && (
        <div className={`remote-connection-status ${connectionStatus}`}>
          {connectionStatus === 'connected' ? 'Connected' :
           connectionStatus === 'connecting' ? 'Connecting...' :
           'Disconnected'}
        </div>
      )}

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
        isResponding={isClaudeResponding}
        onRespondingChange={setIsClaudeResponding}
      />

      <VisualizationMode
        // Pass necessary state and handlers
        currentAudioSourcePath={currentAudioSource}
        currentVisualSourcePath={currentVisualSource}
        currentVisualContent={currentVisualContent}
        currentShaderPath={currentShaderPath}
        currentShaderContent={currentShaderContent}
        // Pass handler to open effect selector
        onOpenEffectSelect={openEffectSelect}
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
                  if (e.key === 'Enter' && e.target.value.trim()) {
                    const message = e.target.value.trim();
                    ipc.send('send-to-claude', message);
                    e.target.value = '';
                  }
                }}
              />
              <button
                className="floating-claude-send"
                onClick={(e) => {
                  const input = e.target.parentElement.querySelector('.floating-claude-input');
                  if (input.value.trim()) {
                    const message = input.value.trim();
                    ipc.send('send-to-claude', message);
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

      {/* Render combined effect selector */}
      { showEffectSelector && (
          <EffectSelectScreen
            audioItems={audioSources}
            visualItems={visualizerList}
            onSelectAudio={handleAudioSelect}
            onSelectVisual={handleVisualSelect}
            currentAudioPath={currentAudioSource}
            currentVisualPath={currentVisualSource}
            onClose={() => setShowEffectSelector(false)}
            initialTab={lastEffectTab}
            initialCategory={lastEffectCategory}
            onTabChange={setLastEffectTab}
            onCategoryChange={setLastEffectCategory}
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
