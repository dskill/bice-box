import React, { useState } from 'react';
import EffectManagement from './EffectManagement';
import ParamFader from './ParamFader';
import VisualizationCanvas from './VisualizationCanvas';
import ToggleButton from './ToggleButton';

function VisualizationMode({ synths, currentSynth, switchSynth, nextSynth, previousSynth, reloadEffectList, pullEffectsRepo, onOpenEffectSelect, effectsRepoStatus, onCheckEffectsRepo }) {
  const [isLoadingEffect, setIsLoadingEffect] = useState(false);

  const prettifySynthName = (name) => {
    if (!name) return '';
    name = name.replace(/_/g, " ");
    return name.replace(/(?:^|\s)\S/g, function (a) { return a.toUpperCase(); });
  };

  const handleNextSynth = () => {
    if (!isLoadingEffect) {
      setIsLoadingEffect(true);
      nextSynth();
    }
  };

  const handlePreviousSynth = () => {
    if (!isLoadingEffect) {
      setIsLoadingEffect(true);
      previousSynth();
    }
  };

  const handleEffectLoaded = () => {
    setIsLoadingEffect(false);
  };

  return (
    <div className="visualization-mode" style={{ touchAction: 'none' }}>
      {window.electron && (
        <div className="supercollider-management-wrapper">
          <EffectManagement 
            reloadEffectList={reloadEffectList} 
            pullEffectsRepo={pullEffectsRepo}
            currentSynth={currentSynth}
            switchSynth={switchSynth}   
            effectsRepoStatus={effectsRepoStatus}
            onCheckEffectsRepo={onCheckEffectsRepo}
          />
        </div>
      )}
      
      <div className="effect-select-container">
        <button 
          className="nav-button effect-nav-button prev-button" 
          onClick={handlePreviousSynth}
          disabled={isLoadingEffect}
        >
          ‹
        </button>
        <ToggleButton
          isOn={false}
          setIsOn={() => {
            if (!isLoadingEffect) {
              onOpenEffectSelect();
            }
          }}
          onText={currentSynth ? prettifySynthName(currentSynth.name) : 'No Effect Selected'}
          offText={currentSynth ? prettifySynthName(currentSynth.name) : 'No Effect Selected'}
          disabled={isLoadingEffect}
        />
        <button 
          className="nav-button effect-nav-button next-button" 
          onClick={handleNextSynth}
          disabled={isLoadingEffect}
        >
          ›
        </button>
      </div>

      <VisualizationCanvas currentEffect={currentSynth} onEffectLoaded={handleEffectLoaded} />
      <div className="visualization-controls">
        <div className="knobs-container">
          {currentSynth && currentSynth.params && currentSynth.params.map((param, index) => (
            <ParamFader
              key={`${currentSynth.name}-${param.name}`}
              synthName={currentSynth.name}
              param={{ ...param, index }}
            />
          ))}
        </div>
      </div>

      <button 
        className="nav-button prev-button" 
        onClick={handlePreviousSynth}
        disabled={isLoadingEffect}
      >
        ‹
      </button>
      <button 
        className="nav-button next-button" 
        onClick={handleNextSynth}
        disabled={isLoadingEffect}
      >
        ›
      </button>
    </div>
  );
}

export default VisualizationMode;