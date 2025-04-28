import React from 'react';
// Color import might be removed if styling changes significantly
// import { colors } from './theme';

function EffectSelectScreen({ 
  type, // 'audio' or 'visual'
  items, // Array of { name: string, scFilePath?: string, p5SketchPath?: string }
  onSelect, // Function called with the selected path (scFilePath or p5SketchPath)
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
    return type === 'audio' ? item.scFilePath : item.p5SketchPath;
  };

  return (
    <div className="effect-select-screen" onClick={handleBackgroundClick}>
       <button className="close-button" onClick={onClose}>×</button>
       <h2>Select {type === 'audio' ? 'Audio' : 'Visual'} Source</h2>
      <div className="effect-grid"> {/* Keep class name or make it generic? */} 
        {items.map((item) => {
          const itemPath = getPathForItem(item);
          const isActive = itemPath === currentSourcePath;
          return (
            <div className="effect-tile-wrapper" key={itemPath}> {/* Use path as key */} 
              <button
                className={`effect-tile ${isActive ? 'active' : ''}`}
                onClick={() => onSelect(itemPath)} // Pass the path to onSelect
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