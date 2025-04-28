import React from 'react';
// Color import might be removed if styling changes significantly
// import { colors } from './theme';

function EffectSelectScreen({ 
  type, // 'audio' or 'visual' or 'preset'
  items, // Array of sources or presets
  onSelect, // Function called with the selected path (scFilePath/p5SketchPath) or preset name
  onClose, // Function called to close the screen
  currentSourcePath // The path of the currently active source for highlighting
}) {
  
  // Use a generic name prettifier or just display the name directly
  const prettifyName = (name) => {
    if (!name) return '';
    // Keep existing prettification for now
    name = name.replace(/_/g, " ");
    return name.replace(/(?:^|\s)\S/g, function(a) { return a.toUpperCase(); });
  };

  const handleBackgroundClick = (e) => {
    if (e.target.classList.contains('effect-select-screen')) {
      onClose(); // Use onClose instead of onSelectEffect(null)
    }
  };

  const getPathForItem = (item) => {
    if (type === 'audio') return item.scFilePath;
    if (type === 'visual') return item.p5SketchPath;
    if (type === 'preset') return item.name; // Use name as identifier for presets
    return null; // Should not happen
  };

  return (
    <div className="effect-select-screen" onClick={handleBackgroundClick}>
       <button className="close-button" onClick={onClose}>×</button>
       <h2>Select {type === 'preset' ? 'Preset' : type === 'audio' ? 'Audio Source' : 'Visual Source'}</h2>
      <div className="effect-grid"> {/* Keep class name or make it generic? */} 
        {items.map((item) => {
          const itemPath = getPathForItem(item);
          const isActive = itemPath === currentSourcePath;
          return (
            <div className="effect-tile-wrapper" key={type === 'preset' ? item.name : itemPath}> 
              <button
                className={`effect-tile ${isActive ? 'active' : ''}`}
                onClick={() => onSelect(itemPath)} // Pass the path or name to onSelect
                disabled={!itemPath} // Disable if path is missing (shouldn't happen with derived lists)
              >
                {/* Display the name from the item */}
                <div className="effect-name">{prettifyName(item.name)}</div> 
                {/* Optional: Display the path too? */}
                {/* <div className="effect-path">{itemPath}</div> */}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default EffectSelectScreen; 