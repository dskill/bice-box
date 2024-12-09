import React from 'react';
import { colors } from './theme';  // Import the color generator

function EffectSelectScreen({ synths, onSelectEffect, currentSynth }) {
  const prettifySynthName = (name) => {
    if (!name) return '';
    name = name.replace(/_/g, " ");
    return name.replace(/(?:^|\s)\S/g, function(a) { return a.toUpperCase(); });
  };

  const handleBackgroundClick = (e) => {
    // Only close if clicking directly on the background (effect-select-screen),
    // not its children
    if (e.target.className === 'effect-select-screen') {
      onSelectEffect(null);
    }
  };

  return (
    <div className="effect-select-screen" onClick={handleBackgroundClick}>
      <div className="effect-grid">
        {synths.map((synth) => (
          <div className="effect-tile-wrapper" key={synth.name}>
            <button
              className={`effect-tile ${currentSynth?.name === synth.name ? 'active' : ''}`}
              onClick={() => onSelectEffect(synth.name)}
            >
              <div className="effect-name">{prettifySynthName(synth.name)}</div>
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

export default EffectSelectScreen; 