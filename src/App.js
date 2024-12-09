import React, { useState, useEffect } from 'react';
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
  const [currentSynth, setCurrentSynth] = useState(null);
  const [error, setError] = useState(null);
  const [currentScreen, setCurrentScreen] = useState('visualization'); // 'visualization' or 'select'
  const [effectsRepoStatus, setEffectsRepoStatus] = useState({
    hasUpdates: false,
    lastChecked: null,
    isChecking: false,
    error: null
  });

  useEffect(() => {
    // Initial effects load and repo check
    Promise.all([
      getEffectList(),
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

      setCurrentSynth(prevSynth => {
        if (prevSynth && prevSynth.name === updatedEffect.name) {
          console.log('Updating current synth:', updatedEffect);
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

  useEffect(() => {
    if (electron) {
      const handleCurrentEffectUpdate = (event, updatedCurrentEffect) => {
        if (updatedCurrentEffect) {
          setCurrentSynth(updatedCurrentEffect);
        }
      };

      electron.ipcRenderer.on('current-effect-updated', handleCurrentEffectUpdate);

      return () => {
        electron.ipcRenderer.removeListener('current-effect-updated', handleCurrentEffectUpdate);
      };
    }
  }, []);

  useEffect(() => {
    // Add this new effect for sc-ready
    if (electron) {
      const handleScReady = () => {
        console.log('SuperCollider is ready');
        if (currentSynth) {
          console.log(`Activating current synth: ${currentSynth.name}`);
          switchSynth(currentSynth.name);
        } else {
          console.log('No current synth to activate');
        }
      };

      electron.ipcRenderer.on('sc-ready', handleScReady);

      return () => {
        electron.ipcRenderer.removeListener('sc-ready', handleScReady);
      };
    }
  }, [currentSynth]); // Add currentSynth to the dependency array

  const getEffectList = () => {
    return new Promise((resolve, reject) => {
      console.log("loadEffects function called");
      if (electron) {
        electron.ipcRenderer.send('reload-all-effects'); 
        electron.ipcRenderer.once('effects-data', (data) => {
          console.log("Received effects data:", data);
          if (Array.isArray(data) && data.length > 0) {
            setSynths(data);
            setCurrentSynth(data[0]);
            console.log("Effects state updated");
            
            // Automatically load the SC file for the first synth
            if (electron && data[0].scFilePath) {
              electron.ipcRenderer.send('load-sc-file', data[0].scFilePath);
              electron.ipcRenderer.send('set-current-effect', data[0].name);
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

  const switchSynth = (synthName) => {
    if (typeof synthName !== 'string') {
      console.error('Invalid synth name:', synthName);
      return;
    }

    const selectedSynth = synths.find(synth => synth.name === synthName);
    if (!selectedSynth) {
      console.error('Synth not found:', synthName);
      return;
    }

    try {
      if (electron) {
        electron.ipcRenderer.send('load-sc-file', selectedSynth.scFilePath);
        electron.ipcRenderer.send('set-current-effect', synthName);
      }
      
      setCurrentSynth(selectedSynth);

      if (Array.isArray(selectedSynth.params)) {
        selectedSynth.params.forEach(param => {
          if (param && typeof param.name === 'string' && param.value !== undefined) {
            const scCode = `~${selectedSynth.name}.set(\\${param.name}, ${param.value});`;
            if (electron) {
              electron.ipcRenderer.send('send-to-supercollider', scCode);
            }
          }
        });
      }
    } catch (error) {
      console.error('Error switching synth:', error);
      setError(`Failed to switch synth: ${error.message}`);
    }
  };

  const pullEffectsRepo = () => {
    return new Promise((resolve, reject) => {
      console.log('Update Effects button clicked');
      if (electron && electron.ipcRenderer) {
        console.log('Sending pull-effects-repo message to main process');
        electron.ipcRenderer.send('pull-effects-repo');
        
        electron.ipcRenderer.once('pull-effects-repo-success', () => {
          console.log('Effects repo pulled successfully');
          getEffectList()
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

  const switchSynthByIndex = (index) => {
    if (typeof index !== 'number' || synths.length === 0) {
      console.error('Invalid index or no synths available:', index);
      return;
    }

    // Use modulo to wrap around the index
    const wrappedIndex = ((index % synths.length) + synths.length) % synths.length;
    const selectedSynth = synths[wrappedIndex];
    switchSynth(selectedSynth.name);
  };

  const nextSynth = () => {
    if (!currentSynth || synths.length === 0) return;
    const currentIndex = synths.findIndex(synth => synth.name === currentSynth.name);
    switchSynthByIndex(currentIndex + 1);
  };

  const previousSynth = () => {
    if (!currentSynth || synths.length === 0) return;
    const currentIndex = synths.findIndex(synth => synth.name === currentSynth.name);
    switchSynthByIndex(currentIndex - 1);
  };

  const handleEffectSelect = (synthName) => {
    if (synthName === null) {
      console.log('null synth received, closing effect select screen');
      setCurrentScreen('visualization');
    } else {
      switchSynth(synthName);
      setCurrentScreen('visualization');
    }
  };

  const openEffectSelect = () => {
    setCurrentScreen('select');
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
        synths={synths}
        currentSynth={currentSynth}
        switchSynth={handleEffectSelect}
        nextSynth={nextSynth}
        previousSynth={previousSynth}
        reloadEffectList={getEffectList}
        pullEffectsRepo={pullEffectsRepo}
        onOpenEffectSelect={openEffectSelect}
        effectsRepoStatus={effectsRepoStatus}
        onCheckEffectsRepo={checkEffectsRepoStatus}
      />
      {currentScreen === 'select' && (
          <EffectSelectScreen
            synths={synths}
            onSelectEffect={handleEffectSelect}
            currentSynth={currentSynth}
          />
      )}
    </div>
  );
}

export default App;
