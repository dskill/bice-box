import React, { useRef, useEffect, useState } from 'react';
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
  const [isDragging, setIsDragging] = useState(false);
  const initialYRef = useRef(null);
  const initialScrollTopRef = useRef(null);
  
  // Touch scrolling handler for Raspberry Pi compatibility - matching ParamFader pattern
  useEffect(() => {
    const handlePointerMove = (e) => {
      if (!isDragging || !containerRef.current) return;
      
      console.log('EffectSelectScreen: Pointer move detected', e.clientY);
      e.preventDefault();
      
      const deltaY = e.clientY - initialYRef.current;
      const newScrollTop = initialScrollTopRef.current - deltaY;
      
      // Scroll the container
      containerRef.current.scrollTop = newScrollTop;
    };

    const handlePointerUp = () => {
      console.log('EffectSelectScreen: Pointer end detected');
      setIsDragging(false);
      initialYRef.current = null;
      initialScrollTopRef.current = null;
    };

    if (isDragging) {
      // Add listeners to window like ParamFader does
      window.addEventListener('pointermove', handlePointerMove, { passive: false });
      window.addEventListener('pointerup', handlePointerUp);
      window.addEventListener('pointercancel', handlePointerUp);
    }

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
    };
  }, [isDragging]);

  const handlePointerDown = (e) => {
    // Only handle touch/pen input, not mouse
    if (e.pointerType === 'mouse') return;
    
    console.log('EffectSelectScreen: Pointer start detected', e.pointerType);
    e.preventDefault();
    e.stopPropagation();
    
    setIsDragging(true);
    initialYRef.current = e.clientY;
    initialScrollTopRef.current = containerRef.current?.scrollTop || 0;
  };
  
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
      onPointerDown={handlePointerDown}
      style={{ 
        touchAction: 'none', // Match ParamFader
        cursor: isDragging ? 'grabbing' : 'grab'
      }}
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