import React from 'react';
import SuperColliderBootManagement from './SuperColliderBootManagement';
import ParamFader from './ParamFader';
import VisualizationCanvas from './VisualizationCanvas';
import { useGesture } from '@use-gesture/react'

function VisualizationMode({ synths, currentSynth, switchSynth, reloadEffectList, pullEffectsRepo }) {
  const prettifySynthName = (name) => {
    if (!name) return '';
    name = name.replace(/_/g, " ");
    return name.replace(/(?:^|\s)\S/g, function (a) { return a.toUpperCase(); });
  };

  const handleSwipe = (direction) => {
    if (!currentSynth || synths.length === 0) return;
    
    const currentIndex = synths.findIndex(synth => synth.name === currentSynth.name);
    let newIndex;
    
    if (direction === 'right') {
      newIndex = (currentIndex + 1) % synths.length;
    } else {
      newIndex = (currentIndex - 1 + synths.length) % synths.length;
    }
    
    switchSynth(synths[newIndex].name);
  };

  const bind = useGesture({
    onSwipe: ({ direction: [x], velocity }) => {
      if (velocity > 0.3) {
        handleSwipe(x > 0 ? 'right' : 'left');
      }
    },
    onTouchStart: () => {
      console.log('Touch started');
    },
    onTouchEnd: () => {
      console.log('Touch ended');
    }
  });

  return (
    <div className="visualization-mode">
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
        
      <div 
        className="visualization-overlay" 
        {...bind()} 
        style={{ touchAction: 'none' }}
      >
        <div className="effect-select-wrapper">
          <select 
            className="effect-select" 
            onChange={(e) => switchSynth(e.target.value)} 
            value={currentSynth ? currentSynth.name : ''}
          >
            {!currentSynth && <option value="">Select a synth</option>}
            {synths.map(synth => (
              <option key={synth.name} value={synth.name}>
                {prettifySynthName(synth.name)}
              </option>
            ))}
          </select>
        </div>
        
      </div>
      <VisualizationCanvas currentEffect={currentSynth} />
      <div className="visualization-controls">
        <div className="knobs-container">
          {currentSynth && currentSynth.params && currentSynth.params.map(param => (
            <ParamFader
              key={`${currentSynth.name}-${param.name}`}
              faderId={`${currentSynth.name}-${param.name}`}
              synthName={currentSynth.name}
              param={param}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

export default VisualizationMode;