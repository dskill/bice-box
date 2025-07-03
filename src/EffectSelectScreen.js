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
    console.log('EffectSelectScreen: useEffect triggered, isDragging =', isDragging);
    
    const handlePointerMove = (e) => {
      console.log('EffectSelectScreen: handlePointerMove called', {
        isDragging,
        hasContainer: !!containerRef.current,
        pointerType: e.pointerType,
        pointerId: e.pointerId,
        clientY: e.clientY
      });
      
      if (!isDragging || !containerRef.current) {
        console.log('EffectSelectScreen: Skipping pointer move - isDragging:', isDragging, 'hasContainer:', !!containerRef.current);
        return;
      }
      
      console.log('EffectSelectScreen: Processing pointer move', e.clientY);
      e.preventDefault();
      
      const deltaY = e.clientY - initialYRef.current;
      const newScrollTop = initialScrollTopRef.current - deltaY;
      
      console.log('EffectSelectScreen: Scroll calculation', {
        currentY: e.clientY,
        initialY: initialYRef.current,
        deltaY: deltaY,
        initialScrollTop: initialScrollTopRef.current,
        newScrollTop: newScrollTop,
        currentScrollTop: containerRef.current.scrollTop
      });
      
      // Scroll the container
      containerRef.current.scrollTop = newScrollTop;
    };

    const handlePointerUp = () => {
      console.log('EffectSelectScreen: handlePointerUp called');
      setIsDragging(false);
      initialYRef.current = null;
      initialScrollTopRef.current = null;
    };

    if (isDragging) {
      console.log('EffectSelectScreen: Adding window event listeners for dragging');
      // Add listeners to window like ParamFader does
      window.addEventListener('pointermove', handlePointerMove, { passive: false });
      window.addEventListener('pointerup', handlePointerUp);
      window.addEventListener('pointercancel', handlePointerUp);
    } else {
      console.log('EffectSelectScreen: Not dragging, no listeners added');
    }

    return () => {
      console.log('EffectSelectScreen: Cleaning up event listeners');
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
    };
  }, [isDragging]);

  const handlePointerDown = (e) => {
    console.log('EffectSelectScreen: handlePointerDown called', {
      pointerType: e.pointerType,
      pointerId: e.pointerId,
      clientX: e.clientX,
      clientY: e.clientY,
      target: e.target?.className,
      currentTarget: e.currentTarget?.className
    });
    
    // Process all pointer events - on Pi, touch shows up as 'mouse'
    console.log('EffectSelectScreen: Processing pointer down event');
    e.preventDefault();
    e.stopPropagation();
    
    const scrollTop = containerRef.current?.scrollTop || 0;
    console.log('EffectSelectScreen: Setting initial values', {
      clientY: e.clientY,
      scrollTop: scrollTop
    });
    
    setIsDragging(true);
    initialYRef.current = e.clientY;
    initialScrollTopRef.current = scrollTop;
    
    console.log('EffectSelectScreen: State updated - isDragging should be true');
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