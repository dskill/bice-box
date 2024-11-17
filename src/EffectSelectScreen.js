import React from 'react';

function EffectSelectScreen({ synths, onSelectEffect, currentSynth }) {
  const prettifySynthName = (name) => {
    if (!name) return '';
    name = name.replace(/_/g, " ");
    return name.replace(/(?:^|\s)\S/g, function(a) { return a.toUpperCase(); });
  };

  return (
    <div className="effect-select-screen">
      <div className="effect-grid">
        {synths.map(synth => (
          <button
            key={synth.name}
            className={`effect-tile ${currentSynth?.name === synth.name ? 'active' : ''}`}
            onClick={() => onSelectEffect(synth.name)}
          >
            {prettifySynthName(synth.name)}
          </button>
        ))}
      </div>
    </div>
  );
}

export default EffectSelectScreen; 