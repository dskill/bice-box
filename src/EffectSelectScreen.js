import React from 'react';
import { colors } from './theme';  // Import the color generator

function EffectSelectScreen({ synths, onSelectEffect, currentSynth }) {
  const prettifySynthName = (name) => {
    if (!name) return '';
    name = name.replace(/_/g, " ");
    return name.replace(/(?:^|\s)\S/g, function(a) { return a.toUpperCase(); });
  };

  return (
    <div className="effect-select-screen">
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