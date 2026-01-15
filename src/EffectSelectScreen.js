import React, { useRef, useEffect, useState, useMemo, useCallback } from 'react';

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
  const effectsListRef = useRef(null);
  const categoriesListRef = useRef(null);

  // Tab state: 'audio' or 'visual'
  const [activeTab, setActiveTab] = useState(initialTab);

  // Category navigation state for audio
  const [selectedCategory, setSelectedCategory] = useState(initialCategory);

  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);

  // Touch scrolling state for Pi compatibility
  const [isDragging, setIsDragging] = useState(false);
  const hasDraggedBeyondThresholdRef = useRef(false);
  const initialYRef = useRef(null);
  const initialXRef = useRef(null);
  const initialScrollTopRef = useRef(null);
  const activeScrollContainerRef = useRef(null);
  const lastUpdateTimeRef = useRef(0);
  const DRAG_THRESHOLD = 15;

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

  // Auto-select first category if none selected
  useEffect(() => {
    if (activeTab === 'audio' && !selectedCategory && categories.length > 0 && !isSearching) {
      setSelectedCategory(categories[0].name);
      if (onCategoryChange) onCategoryChange(categories[0].name);
    }
  }, [activeTab, selectedCategory, categories, isSearching, onCategoryChange]);

  // Get effects filtered by selected category or search
  const filteredAudioItems = useMemo(() => {
    if (!audioItems) return [];

    // If searching, filter by search query across all effects
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      return audioItems.filter(item => {
        const nameMatch = item.name?.toLowerCase().includes(query);
        const descMatch = item.description?.toLowerCase().includes(query);
        const catMatch = item.category?.toLowerCase().includes(query);
        return nameMatch || descMatch || catMatch;
      });
    }

    // Otherwise filter by category
    if (!selectedCategory) return audioItems;
    return audioItems.filter(item => (item.category || 'Uncategorized') === selectedCategory);
  }, [audioItems, selectedCategory, searchQuery]);

  // Reset effects scroll when category changes
  useEffect(() => {
    if (effectsListRef.current) {
      effectsListRef.current.scrollTop = 0;
    }
  }, [selectedCategory, activeTab, searchQuery]);

  // Touch scrolling handler for Pi compatibility - matching ClaudeConsole pattern
  useEffect(() => {
    const handlePointerMove = (e) => {
      if (!isDragging || !activeScrollContainerRef.current) {
        return;
      }

      // Throttle updates to 60fps
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
        if (activeScrollContainerRef.current) {
          activeScrollContainerRef.current.scrollTop = newScrollTop;
        }
      });
    };

    const handlePointerUp = () => {
      setIsDragging(false);
      initialYRef.current = null;
      initialXRef.current = null;
      initialScrollTopRef.current = null;
      activeScrollContainerRef.current = null;

      // Reset drag threshold flag after a short delay to allow click prevention
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

  const handlePointerDown = useCallback((e, scrollContainerRef) => {
    // Process all pointer events - on Pi, touch shows up as 'mouse'
    e.preventDefault();
    e.stopPropagation();

    const scrollContainer = scrollContainerRef?.current;
    const scrollTop = scrollContainer?.scrollTop || 0;

    setIsDragging(true);
    hasDraggedBeyondThresholdRef.current = false;
    initialYRef.current = e.clientY;
    initialXRef.current = e.clientX;
    initialScrollTopRef.current = scrollTop;
    activeScrollContainerRef.current = scrollContainer;
    lastUpdateTimeRef.current = 0; // Reset throttle timer
  }, []);

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
    setSearchQuery(''); // Clear search when selecting category
    setIsSearching(false);
    if (onCategoryChange) onCategoryChange(categoryName);
  };

  const handleTabClick = (tab) => {
    if (hasDraggedBeyondThresholdRef.current) return;
    setActiveTab(tab);
    setSearchQuery(''); // Clear search when switching tabs
    setIsSearching(false);
    if (onTabChange) onTabChange(tab);
  };

  const handleSearchChange = (e) => {
    const value = e.target.value;
    setSearchQuery(value);
    if (value.trim()) {
      setIsSearching(true);
    } else {
      setIsSearching(false);
    }
  };

  const handleSearchClear = () => {
    if (hasDraggedBeyondThresholdRef.current) return;
    setSearchQuery('');
    setIsSearching(false);
  };

  const prettifyName = (name) => {
    if (!name) return '';
    name = name.replace(/_/g, " ");
    return name.replace(/(?:^|\s)\S/g, function(a) { return a.toUpperCase(); });
  };

  const handleBackgroundClick = (e) => {
    if (hasDraggedBeyondThresholdRef.current) return;
    if (e.target.classList.contains('effect-select-screen')) {
      onClose();
    }
  };

  // Get count for display
  const effectCount = activeTab === 'audio'
    ? filteredAudioItems.length
    : (visualItems || []).length;

  return (
    <div
      className="effect-select-screen"
      onClick={handleBackgroundClick}
    >
      {/* Header with tabs and search */}
      <div className="effect-select-header-bar">
        <div className="effect-select-tabs">
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

        <div className="effect-search-container">
          <input
            type="text"
            className="effect-search-input"
            placeholder="Search..."
            value={searchQuery}
            onChange={handleSearchChange}
          />
          {searchQuery && (
            <button className="effect-search-clear" onClick={handleSearchClear}>
              ×
            </button>
          )}
        </div>
      </div>

      {/* Main content area - two columns for audio, single for visual */}
      <div className="effect-select-content">
        {activeTab === 'audio' ? (
          <>
            {/* Category sidebar */}
            <div
              className="effect-categories-sidebar"
              ref={categoriesListRef}
              onPointerDown={(e) => handlePointerDown(e, categoriesListRef)}
              style={{ touchAction: 'none', cursor: isDragging ? 'grabbing' : 'default' }}
            >
              {categories.map((category) => {
                const isSelected = category.name === selectedCategory && !isSearching;
                return (
                  <button
                    key={category.name}
                    className={`category-item ${isSelected ? 'selected' : ''}`}
                    onClick={() => handleCategoryClick(category.name)}
                  >
                    <span className="category-item-name">{category.name}</span>
                    <span className="category-item-count">{category.count}</span>
                  </button>
                );
              })}
            </div>

            {/* Effects list */}
            <div className="effect-list-container">
              <div className="effect-list-header">
                <span className="effect-list-title">
                  {isSearching ? `Results for "${searchQuery}"` : selectedCategory}
                </span>
                <span className="effect-list-count">{effectCount} effects</span>
              </div>
              <div
                className="effect-list"
                ref={effectsListRef}
                onPointerDown={(e) => handlePointerDown(e, effectsListRef)}
                style={{ touchAction: 'none', cursor: isDragging ? 'grabbing' : 'default' }}
              >
                {filteredAudioItems.map((item) => {
                  const isActive = item.scFilePath === currentAudioPath;
                  return (
                    <button
                      key={item.scFilePath}
                      className={`effect-item ${isActive ? 'active' : ''}`}
                      onClick={() => handleAudioClick(item)}
                    >
                      <div className="effect-item-name">{prettifyName(item.name)}</div>
                      {item.description && (
                        <div className="effect-item-description">{item.description}</div>
                      )}
                    </button>
                  );
                })}
                {filteredAudioItems.length === 0 && (
                  <div className="effect-list-empty">
                    {isSearching ? 'No effects match your search' : 'No effects in this category'}
                  </div>
                )}
              </div>
            </div>
          </>
        ) : (
          /* Visual effects - full width list */
          <div className="effect-list-container visual-full-width">
            <div className="effect-list-header">
              <span className="effect-list-title">Visual Effects</span>
              <span className="effect-list-count">{effectCount} effects</span>
            </div>
            <div
              className="effect-list"
              ref={effectsListRef}
              onPointerDown={(e) => handlePointerDown(e, effectsListRef)}
              style={{ touchAction: 'none', cursor: isDragging ? 'grabbing' : 'default' }}
            >
              {(visualItems || []).map((item) => {
                const isActive = item.path === currentVisualPath;
                return (
                  <button
                    key={item.path}
                    className={`effect-item ${isActive ? 'active' : ''}`}
                    onClick={() => handleVisualClick(item)}
                  >
                    <div className="effect-item-name">{prettifyName(item.name)}</div>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default EffectSelectScreen;
