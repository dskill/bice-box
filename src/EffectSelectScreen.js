import React, { useRef, useEffect } from 'react';
// Color import might be removed if styling changes significantly
// import { colors } from './theme';

function EffectSelectScreen({ 
  type, // 'audio' or 'visual' or 'preset'
  items, // Array of sources or presets
  onSelect, // Function called with the selected path (scFilePath/p5SketchPath) or preset name
  onClose, // Function called to close the screen
  currentSourcePath // The path of the currently active source for highlighting
}) {
  const containerRef = useRef(null);
  
  // Touch scrolling handler for Raspberry Pi compatibility
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let startY = 0;
    let lastY = 0;
    let isDragging = false;
    let pointerId = null;

    const handlePointerStart = (e) => {
      // Only handle touch/pen input, not mouse
      if (e.pointerType === 'mouse') return;
      
      console.log('EffectSelectScreen: Pointer start detected', e.pointerType);
      startY = e.clientY;
      lastY = startY;
      isDragging = true;
      pointerId = e.pointerId;
      
      // Capture pointer events
      container.setPointerCapture(e.pointerId);
      e.preventDefault();
    };

    const handlePointerMove = (e) => {
      if (!isDragging || e.pointerId !== pointerId) return;
      
      console.log('EffectSelectScreen: Pointer move detected', e.clientY);
      e.preventDefault();
      
      const currentY = e.clientY;
      const deltaY = lastY - currentY;
      
      // Scroll the container
      container.scrollTop += deltaY;
      lastY = currentY;
    };

    const handlePointerEnd = (e) => {
      if (e.pointerId !== pointerId) return;
      
      console.log('EffectSelectScreen: Pointer end detected');
      isDragging = false;
      pointerId = null;
      
      // Release pointer capture
      if (container.hasPointerCapture(e.pointerId)) {
        container.releasePointerCapture(e.pointerId);
      }
    };

    // Add pointer event listeners
    container.addEventListener('pointerdown', handlePointerStart);
    container.addEventListener('pointermove', handlePointerMove);
    container.addEventListener('pointerup', handlePointerEnd);
    container.addEventListener('pointercancel', handlePointerEnd);

    // Cleanup
    return () => {
      container.removeEventListener('pointerdown', handlePointerStart);
      container.removeEventListener('pointermove', handlePointerMove);
      container.removeEventListener('pointerup', handlePointerEnd);
      container.removeEventListener('pointercancel', handlePointerEnd);
    };
  }, []);
  
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
    if (type === 'visual') return item.path;
    if (type === 'preset') return item.name; // Use name as identifier for presets
    return null; // Should not happen
  };

  return (
    <div 
      className="effect-select-screen" 
      onClick={handleBackgroundClick}
      ref={containerRef}
    >
       <h2>Select {type === 'preset' ? 'Preset' : type === 'audio' ? 'Audio Source' : 'Visual Source'}</h2>
      <div className="effect-grid"> {/* Keep class name or make it generic? */} 
        {items.map((item) => {
          const itemPath = getPathForItem(item);
          const isActive = itemPath === currentSourcePath;
          return (
            <div className="effect-tile-wrapper" key={type === 'preset' ? item.name : itemPath}> 
              <button
                className={`effect-tile ${isActive ? 'active' : ''}`}
                onClick={() => onSelect(type === 'visual' ? item : itemPath)}
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