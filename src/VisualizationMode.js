import React from 'react';
import SuperColliderBootManagement from './SuperColliderBootManagement';
import ParamFader from './ParamFader';
import VisualizationCanvas from './VisualizationCanvas';
import { useGesture } from '@use-gesture/react'

function VisualizationMode({ synths, currentSynth, switchSynth, nextSynth, previousSynth,  reloadEffectList, pullEffectsRepo }) {
  const [lastSwipeTime, setLastSwipeTime] = React.useState(0);
  const SWIPE_COOLDOWN = 500; // milliseconds between allowed swipes

  const prettifySynthName = (name) => {
    if (!name) return '';
    name = name.replace(/_/g, " ");
    return name.replace(/(?:^|\s)\S/g, function (a) { return a.toUpperCase(); });
  };

  const handleSwipe = (direction) => {
    if (!currentSynth || !Array.isArray(synths) || synths.length === 0) {
      console.log('Swipe aborted: invalid state', { currentSynth, synths });
      return;
    }
    
    if (direction === 'right') {
      nextSynth();
    } else {
      previousSynth();
    }
  };

  // Add state for current gesture and active fader
  const [currentGestureState, setCurrentGestureState] = React.useState(null);
  const [activeFaderId, setActiveFaderId] = React.useState(null);

  const bind = useGesture({
    onDrag: ({ movement: [mx, my], direction: [dx, dy], cancel, event, ...rest }) => {
      const now = Date.now();
      if (now - lastSwipeTime < SWIPE_COOLDOWN) {
        return;
      }

      // Get the closest fader element to the drag start point
      if (!activeFaderId) {
        const faderElement = event.target.closest('.param-fader');
        if (faderElement) {
          setActiveFaderId(faderElement.dataset.faderId);
        }
      }

      // Handle horizontal swipes
      if (Math.abs(mx) > 50 && Math.abs(mx) > Math.abs(my) * 2) {
        handleSwipe(dx > 0 ? 'right' : 'left');
        setLastSwipeTime(now);
        cancel();
        return;
      }
      
      // Only update gesture state if we have an active fader
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
    </div>
  );
}

export default VisualizationMode;