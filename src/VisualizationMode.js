import React from 'react';
import SuperColliderBootManagement from './SuperColliderBootManagement';
import ParamFader from './ParamFader';
import VisualizationCanvas from './VisualizationCanvas';
import { useGesture } from '@use-gesture/react'

function VisualizationMode({ synths, currentSynth, switchSynth, nextSynth, previousSynth,  reloadEffectList, pullEffectsRepo }) {
  const prettifySynthName = (name) => {
    if (!name) return '';
    name = name.replace(/_/g, " ");
    return name.replace(/(?:^|\s)\S/g, function (a) { return a.toUpperCase(); });
  };

  const [currentGestureState, setCurrentGestureState] = React.useState(null);
  const [activeFaderId, setActiveFaderId] = React.useState(null);

  const bind = useGesture({
    onDrag: ({ movement: [mx, my], event, ...rest }) => {
      if (!activeFaderId) {
        const faderElement = event.target.closest('.param-fader');
        if (faderElement) {
          setActiveFaderId(faderElement.dataset.faderId);
        }
      }
      
      if (activeFaderId) {
        setCurrentGestureState({ dragging: true, movement: [mx, my], ...rest });
      }
    },
    onDragEnd: () => {
      setCurrentGestureState(null);
      setActiveFaderId(null);
    }
  }, {
    drag: {
      filterTaps: true,
      threshold: 10,
      delay: 50
    }
  });

  return (
    <div className="visualization-mode" {...bind()} style={{ touchAction: 'none' }}>
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

      <VisualizationCanvas currentEffect={currentSynth} />
      <div className="visualization-controls">
        <div className="knobs-container">
          {currentSynth && currentSynth.params && currentSynth.params.map(param => (
            <ParamFader
              key={`${currentSynth.name}-${param.name}`}
              faderId={`${currentSynth.name}-${param.name}`}
              synthName={currentSynth.name}
              param={param}
              gestureState={activeFaderId === `${currentSynth.name}-${param.name}` ? currentGestureState : null}
            />
          ))}
        </div>
      </div>

      <button 
        className="nav-button prev-button" 
        onClick={previousSynth}
      >
        ←
      </button>
      <button 
        className="nav-button next-button" 
        onClick={nextSynth}
      >
        →
      </button>
    </div>
  );
}

export default VisualizationMode;