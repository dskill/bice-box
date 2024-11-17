import React from 'react';
import SuperColliderBootManagement from './SuperColliderBootManagement';
import ParamFader from './ParamFader';
import VisualizationCanvas from './VisualizationCanvas';

function VisualizationMode({ synths, currentSynth, switchSynth, nextSynth, previousSynth,  reloadEffectList, pullEffectsRepo, onOpenEffectSelect }) {
  const prettifySynthName = (name) => {
    if (!name) return '';
    name = name.replace(/_/g, " ");
    return name.replace(/(?:^|\s)\S/g, function (a) { return a.toUpperCase(); });
  };

  return (
    <div className="visualization-mode" style={{ touchAction: 'none' }}>
      {window.electron && (
        <div className="supercollider-management-wrapper">
          <SuperColliderBootManagement 
            reloadEffectList={reloadEffectList} 
            pullEffectsRepo={pullEffectsRepo}
            currentSynth={currentSynth}
            switchSynth={switchSynth}            
          />
        </div>
      )}
      
      <div className="effect-select-container">
        <button 
          className="nav-button effect-nav-button prev-button" 
          onClick={previousSynth}
        >
          ‹
        </button>
        <button className="select-screen-button" onClick={onOpenEffectSelect}>
          <div className="effect-name">
            {currentSynth ? prettifySynthName(currentSynth.name) : 'No Effect Selected'}
          </div>
        </button>
        <button 
          className="nav-button effect-nav-button next-button" 
          onClick={nextSynth}
        >
          ›
        </button>
      </div>

      <VisualizationCanvas currentEffect={currentSynth} />
      <div className="visualization-controls">
        <div className="knobs-container">
          {currentSynth && currentSynth.params && currentSynth.params.map(param => (
            <ParamFader
              key={`${currentSynth.name}-${param.name}`}
              synthName={currentSynth.name}
              param={param}
            />
          ))}
        </div>
      </div>

      <button 
        className="nav-button prev-button" 
        onClick={previousSynth}
      >
        ‹
      </button>
      <button 
        className="nav-button next-button" 
        onClick={nextSynth}
      >
        ›
      </button>
    </div>
  );
}

export default VisualizationMode;