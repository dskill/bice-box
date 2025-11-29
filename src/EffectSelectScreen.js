import React, { useRef, useEffect, useState, useMemo } from 'react';
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
  
  // Two-step navigation state for audio effects
  const [selectedCategory, setSelectedCategory] = useState(null);
  
  // Derive categories from items (only for audio type)
  const categories = useMemo(() => {
    if (type !== 'audio') return [];
    
    const categoryMap = new Map();
    items.forEach(item => {
      const cat = item.category || 'Uncategorized';
      if (!categoryMap.has(cat)) {
        categoryMap.set(cat, { name: cat, count: 0 });
      }
      categoryMap.get(cat).count++;
    });
    
    // Sort categories - put Utility at the end, others alphabetically
    return Array.from(categoryMap.values()).sort((a, b) => {
      if (a.name === 'Utility') return 1;
      if (b.name === 'Utility') return -1;
      return a.name.localeCompare(b.name);
    });
  }, [items, type]);
  
  // Get effects filtered by selected category
  const filteredItems = useMemo(() => {
    if (type !== 'audio' || !selectedCategory) return items;
    return items.filter(item => (item.category || 'Uncategorized') === selectedCategory);
  }, [items, selectedCategory, type]);
  
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

  // Reset scroll position when changing views
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = 0;
    }
  }, [selectedCategory]);

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
  
  const handleCategoryClick = (categoryName) => {
    // Prevent click if user has dragged beyond threshold
    if (hasDraggedBeyondThresholdRef.current) {
      return;
    }
    setSelectedCategory(categoryName);
  };
  
  const handleBackToCategories = () => {
    // Prevent click if user has dragged beyond threshold
    if (hasDraggedBeyondThresholdRef.current) {
      return;
    }
    setSelectedCategory(null);
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

  // Determine what to show based on type and navigation state
  const showCategories = type === 'audio' && !selectedCategory;
  const displayItems = showCategories ? categories : filteredItems;
  
  // Get title based on current view
  const getTitle = () => {
    if (type === 'preset') return 'Select Preset';
    if (type === 'visual') return 'Select Visual Source';
    if (type === 'audio') {
      return selectedCategory ? selectedCategory : 'Select Category';
    }
    return 'Select';
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
      {/* Header with back button for effects view */}
      <div className="effect-select-header">
        {type === 'audio' && selectedCategory && (
          <button 
            className="effect-back-button"
            onClick={handleBackToCategories}
          >
            ← Back
          </button>
        )}
        <h2>{getTitle()}</h2>
      </div>
       
      {showCategories ? (
        // Category grid for audio effects
        <div className="category-grid">
          {categories.map((category) => (
            <div className="category-tile-wrapper" key={category.name}>
              <button
                className="category-tile"
                onClick={() => handleCategoryClick(category.name)}
              >
                <div className="category-name">{category.name}</div>
                <div className="category-count">{category.count} effects</div>
              </button>
            </div>
          ))}
        </div>
      ) : (
        // Effect grid (for effects within category, visual, or preset)
        <div className="effect-grid">
          {displayItems.map((item) => {
            const itemPath = getPathForItem(item);
            const isActive = itemPath === currentSourcePath;
            return (
              <div className="effect-tile-wrapper" key={type === 'preset' ? item.name : (itemPath || item.name)}> 
                <button
                  className={`effect-tile ${isActive ? 'active' : ''}`}
                  onClick={() => handleButtonClick(item, itemPath)}
                  disabled={!itemPath} // Disable if path is missing (shouldn't happen with derived lists)
                >
                  {/* Display the name from the item */}
                  <div className="effect-name">{prettifyName(item.name)}</div> 
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default EffectSelectScreen;
