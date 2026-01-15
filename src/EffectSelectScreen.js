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
  const effectsListRef = useRef(null);
  const categoriesListRef = useRef(null);

  // Tab state: 'audio' or 'visual'
  const [activeTab, setActiveTab] = useState(initialTab);

  // Category navigation state for audio
  const [selectedCategory, setSelectedCategory] = useState(initialCategory);

  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);

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

  const handleAudioClick = (item) => {
    onSelectAudio(item);
  };

  const handleVisualClick = (item) => {
    onSelectVisual(item);
  };

  const handleCategoryClick = (categoryName) => {
    setSelectedCategory(categoryName);
    setSearchQuery(''); // Clear search when selecting category
    setIsSearching(false);
    if (onCategoryChange) onCategoryChange(categoryName);
  };

  const handleTabClick = (tab) => {
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
    setSearchQuery('');
    setIsSearching(false);
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
            <div className="effect-categories-sidebar" ref={categoriesListRef}>
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
            <div className="effect-list-container" ref={effectsListRef}>
              <div className="effect-list-header">
                <span className="effect-list-title">
                  {isSearching ? `Results for "${searchQuery}"` : selectedCategory}
                </span>
                <span className="effect-list-count">{effectCount} effects</span>
              </div>
              <div className="effect-list">
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
          <div className="effect-list-container visual-full-width" ref={effectsListRef}>
            <div className="effect-list-header">
              <span className="effect-list-title">Visual Effects</span>
              <span className="effect-list-count">{effectCount} effects</span>
            </div>
            <div className="effect-list">
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
