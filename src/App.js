import React, { useState, useEffect } from 'react';
import VisualizationMode from './VisualizationMode';
import './App.css';

const electron = window.electron;

function App() {
  const [synths, setSynths] = useState([]);
  const [currentSynth, setCurrentSynth] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    // Load synths on component mount
    getEffectList().catch(err => {
      console.error("Failed to load effects:", err);
      setError("Failed to load effects. Check the console for more details.");
    });
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
        electron.ipcRenderer.send('request-effects'); 
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

  if (error) {
    return <div className="error-message">{error}</div>;
  }

  return (
    <div className="App visualization-mode">
      <VisualizationMode
        synths={synths}
        currentSynth={currentSynth}
        switchSynth={switchSynth}
        reloadEffectList={getEffectList}
        pullEffectsRepo={pullEffectsRepo}
      />
    </div>
  );
}

export default App;
