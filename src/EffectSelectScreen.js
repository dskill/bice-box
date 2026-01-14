import React, { useRef, useEffect, useState, useMemo } from 'react';

function EffectSelectScreen({ 
  audioItems, // Array of audio sources with category
  visualItems, // Array of visual sources
  onSelectAudio, // Function called with selected audio item
  onSelectVisual, // Function called with selected visual item
  onClose, // Function called to close the screen
  currentAudioPath, // Currently active audio source path
  currentVisualPath, // Currently active visual source path
  initialTab = 'audio', // Remember last tab
  initialCategory = null, // Remember last category
  onTabChange, // Callback when tab changes
  onCategoryChange // Callback when category changes
}) {
  const containerRef = useRef(null);
  const [isDragging, setIsDragging] = useState(false);
  const hasDraggedBeyondThresholdRef = useRef(false);
  const initialYRef = useRef(null);
  const initialXRef = useRef(null);
  const initialScrollTopRef = useRef(null);
  const lastUpdateTimeRef = useRef(0);
  const DRAG_THRESHOLD = 15;
  
  // Tab state: 'audio' or 'visual' - initialized from prop
  const [activeTab, setActiveTab] = useState(initialTab);
  
  // Category navigation state for audio - initialized from prop
  const [selectedCategory, setSelectedCategory] = useState(initialCategory);
  
  // Derive categories from audio items
  const categories = useMemo(() => {
    if (!audioItems) return [];
    
    const categoryMap = new Map();
    audioItems.forEach(item => {
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
  }, [audioItems]);
  
  // Get effects filtered by selected category
  const filteredAudioItems = useMemo(() => {
    if (!audioItems || !selectedCategory) return audioItems || [];
    return audioItems.filter(item => (item.category || 'Uncategorized') === selectedCategory);
  }, [audioItems, selectedCategory]);
  
  // Touch scrolling handler
  useEffect(() => {
    const handlePointerMove = (e) => {
      if (!isDragging || !containerRef.current) {
        return;
      }
      
      const now = performance.now();
      if (now - lastUpdateTimeRef.current < 16) return;
      lastUpdateTimeRef.current = now;
      
      e.preventDefault();
      
      const deltaY = e.clientY - initialYRef.current;
      const deltaX = e.clientX - initialXRef.current;
      const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
      
      if (distance > DRAG_THRESHOLD && !hasDraggedBeyondThresholdRef.current) {
        hasDraggedBeyondThresholdRef.current = true;
      }
      
      const newScrollTop = initialScrollTopRef.current - deltaY;
      
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
      
      setTimeout(() => {
        hasDraggedBeyondThresholdRef.current = false;
      }, 100);
    };

    if (isDragging) {
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

  // Reset scroll position when changing views
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = 0;
    }
  }, [selectedCategory, activeTab]);

  const handlePointerDown = (e) => {
    e.preventDefault();
    e.stopPropagation();
    
    const scrollTop = containerRef.current?.scrollTop || 0;
    
    setIsDragging(true);
    hasDraggedBeyondThresholdRef.current = false;
    initialYRef.current = e.clientY;
    initialXRef.current = e.clientX;
    initialScrollTopRef.current = scrollTop;
    lastUpdateTimeRef.current = 0;
  };

  const handleAudioClick = (item) => {
    if (hasDraggedBeyondThresholdRef.current) return;
    onSelectAudio(item);
  };
  
  const handleVisualClick = (item) => {
    if (hasDraggedBeyondThresholdRef.current) return;
    onSelectVisual(item);
  };
  
  const handleCategoryClick = (categoryName) => {
    if (hasDraggedBeyondThresholdRef.current) return;
    setSelectedCategory(categoryName);
    if (onCategoryChange) onCategoryChange(categoryName);
  };
  
  const handleBackToCategories = () => {
    if (hasDraggedBeyondThresholdRef.current) return;
    setSelectedCategory(null);
    if (onCategoryChange) onCategoryChange(null);
  };
  
  const handleTabClick = (tab) => {
    if (hasDraggedBeyondThresholdRef.current) return;
    setActiveTab(tab);
    if (onTabChange) onTabChange(tab);
    // Don't reset category when switching tabs - preserve it
  };
  
  const prettifyName = (name) => {
    if (!name) return '';
    name = name.replace(/_/g, " ");
    return name.replace(/(?:^|\s)\S/g, function(a) { return a.toUpperCase(); });
  };

  const handleBackgroundClick = (e) => {
    if (e.target.classList.contains('effect-select-screen')) {
      onClose();
    }
  };

  // Determine what to show based on tab and navigation state
  const showCategories = activeTab === 'audio' && !selectedCategory;
  
  // Get title based on current view
  const getTitle = () => {
    if (activeTab === 'visual') return 'Visual';
    return selectedCategory ? selectedCategory : 'Category';
  };

  return (
    <div 
      className="effect-select-screen" 
      onClick={handleBackgroundClick}
      ref={containerRef}
      onPointerDown={handlePointerDown}
      style={{ 
        touchAction: 'none',
        cursor: isDragging ? 'grabbing' : 'grab'
      }}
    >
      {/* Tab bar with back button */}
      <div className="effect-select-tabs">
        {activeTab === 'audio' && selectedCategory ? (
          <button 
            className="effect-back-button"
            onClick={handleBackToCategories}
          >
            ←
          </button>
        ) : null}
        <button 
          className={`effect-tab ${activeTab === 'audio' ? 'active' : ''}`}
          onClick={() => handleTabClick('audio')}
        >
          Audio
        </button>
        <button 
          className={`effect-tab ${activeTab === 'visual' ? 'active' : ''}`}
          onClick={() => handleTabClick('visual')}
        >
          Visual
        </button>
      </div>

      {/* Category/section title */}
      {(activeTab === 'audio' && selectedCategory) && (
        <div className="effect-select-header">
          <h2>{selectedCategory}</h2>
        </div>
      )}
       
      {activeTab === 'audio' ? (
        showCategories ? (
          // Category grid for audio effects
          <div className="category-grid">
            {categories.map((category) => (
              <div className="category-tile-wrapper" key={category.name}>
                <button
                  className="category-tile"
                  onClick={() => handleCategoryClick(category.name)}
                >
                  <div className="category-name">{category.name}</div>
                  <div className="category-count">{category.count}</div>
                </button>
              </div>
            ))}
          </div>
        ) : (
          // Effect list for selected category
          <div className="effect-grid">
            {filteredAudioItems.map((item) => {
              const isActive = item.scFilePath === currentAudioPath;
              return (
                <div className="effect-tile-wrapper" key={item.scFilePath}>
                  <button
                    className={`effect-tile ${isActive ? 'active' : ''}`}
                    onClick={() => handleAudioClick(item)}
                  >
                    <div className="effect-name">{prettifyName(item.name)}</div>
                    {item.description && (
                      <div className="effect-description">{item.description}</div>
                    )}
                  </button>
                </div>
              );
            })}
          </div>
        )
      ) : (
        // Visual effects list
        <div className="effect-grid">
          {(visualItems || []).map((item) => {
            const isActive = item.path === currentVisualPath;
            return (
              <div className="effect-tile-wrapper" key={item.path}> 
                <button
                  className={`effect-tile ${isActive ? 'active' : ''}`}
                  onClick={() => handleVisualClick(item)}
                >
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
