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

  const bind = useGesture({
    onDrag: ({ movement: [mx, my], direction: [dx, dy], cancel, event }) => {
      const now = Date.now();
      // Check if enough time has passed since last swipe
      if (now - lastSwipeTime < SWIPE_COOLDOWN) {
        return;
      }

      // Increase threshold for horizontal movement
      if (Math.abs(mx) > 50 && Math.abs(mx) > Math.abs(my) * 2) {
        handleSwipe(dx > 0 ? 'right' : 'left');
        setLastSwipeTime(now);
        cancel();
      }
    }
  }, {
    drag: {
      filterTaps: true,
      threshold: 10,
      delay: 50
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
        style={{ 
          touchAction: 'none',
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          zIndex: 2  // Higher z-index to capture all touch events
        }}
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