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
  const hasDraggedBeyondThresholdRef = useRef(false); // Use ref instead of state to avoid re-renders
  const initialYRef = useRef(null);
  const initialXRef = useRef(null);
  const initialScrollTopRef = useRef(null);
  const lastUpdateTimeRef = useRef(0); // For throttling
  const DRAG_THRESHOLD = 15; // pixels - if user moves more than this, it's a drag not a tap
  
  // Touch scrolling handler for Raspberry Pi compatibility - matching ParamFader pattern
  useEffect(() => {
    const handlePointerMove = (e) => {
      if (!isDragging || !containerRef.current) {
        return;
      }
      
      // Throttle updates to 60fps like ParamFader
      const now = performance.now();
      if (now - lastUpdateTimeRef.current < 16) return;
      lastUpdateTimeRef.current = now;
      
      e.preventDefault();
      
      const deltaY = e.clientY - initialYRef.current;
      const deltaX = e.clientX - initialXRef.current;
      const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
      
      // Check if we've moved beyond the drag threshold (only set once)
      if (distance > DRAG_THRESHOLD && !hasDraggedBeyondThresholdRef.current) {
        hasDraggedBeyondThresholdRef.current = true;
      }
      
      const newScrollTop = initialScrollTopRef.current - deltaY;
      
      // Use requestAnimationFrame for smooth scrolling
      requestAnimationFrame(() => {
        if (containerRef.current) {
          containerRef.current.scrollTop = newScrollTop;
        }
      });
    };

    const handlePointerUp = () => {
      setIsDragging(false);
      initialYRef.current = null;
      initialXRef.current = null;
      initialScrollTopRef.current = null;
      
      // Reset drag threshold flag after a short delay to allow click prevention
      setTimeout(() => {
        hasDraggedBeyondThresholdRef.current = false;
      }, 100);
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
  }, [isDragging]); // Removed hasDraggedBeyondThreshold from dependencies

  const handlePointerDown = (e) => {
    // Process all pointer events - on Pi, touch shows up as 'mouse'
    e.preventDefault();
    e.stopPropagation();
    
    const scrollTop = containerRef.current?.scrollTop || 0;
    
    setIsDragging(true);
    hasDraggedBeyondThresholdRef.current = false;
    initialYRef.current = e.clientY;
    initialXRef.current = e.clientX;
    initialScrollTopRef.current = scrollTop;
    lastUpdateTimeRef.current = 0; // Reset throttle timer
  };

  const handleButtonClick = (item, itemPath) => {
    // Prevent click if user has dragged beyond threshold
    if (hasDraggedBeyondThresholdRef.current) {
      return;
    }
    
    // For audio, pass the full item so caller knows the effect name
    onSelect(type === 'visual' ? item : item);
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
                onClick={() => handleButtonClick(item, itemPath)}
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