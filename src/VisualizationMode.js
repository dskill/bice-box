import React, { useState, useRef, useCallback, useEffect } from 'react';
import EffectManagement from './EffectManagement';
import ParamFader from './ParamFader';
import VisualizationCanvas from './VisualizationCanvas';

function VisualizationMode({ 
  currentAudioSourcePath, 
  currentVisualSourcePath, 
  currentVisualContent,
  currentShaderPath,
  currentShaderContent,
  currentAudioParams,
  onOpenAudioSelect, 
  onOpenVisualSelect,
  reloadEffectList, 
  pullEffectsRepo, 
  effectsRepoStatus, 
  onCheckEffectsRepo,
  devMode
}) {
  const [isLoadingEffect, setIsLoadingEffect] = useState(false);
  const paramValuesRef = useRef({});

  const handleEffectLoaded = useCallback(() => {
    setIsLoadingEffect(false);
  }, []);

  const handleParamChange = (paramName, value) => {
    paramValuesRef.current[paramName] = value;
    // The SuperCollider send previously here has been removed.
    // ParamFader.js is already handling the send to ~effect.set
    // console.log(`ParamFader changed '${paramName}' to ${value}. VisualizationMode acknowledging.`);
  };

  const prettifySourceName = (sourcePath) => {
    if (!sourcePath) return 'None';
    let name = sourcePath.split('/').pop().split('.')[0];
    name = name.replace(/_/g, " ");
    return name;
  };

  const activeVisualName = currentShaderPath 
    ? prettifySourceName(currentShaderPath) 
    : prettifySourceName(currentVisualSourcePath);

  // Calculate responsive fader width and smart grid layout
  useEffect(() => {
    const calculateFaderLayout = () => {
      if (currentAudioParams) {
        const paramCount = Object.keys(currentAudioParams).length;
        const viewportWidth = window.innerWidth;
        const availableWidth = viewportWidth - 40; // Account for padding
        
        // Determine max columns based on screen size
        let maxColumnsPerRow = 6; // Default (includes 800px)
        if (viewportWidth <= 600) maxColumnsPerRow = 4;
        if (viewportWidth <= 480) maxColumnsPerRow = 3;
        if (viewportWidth <= 360) maxColumnsPerRow = 2;
        
        // Calculate optimal grid layout
        let gridColumns, columnsForWidth;
        
        if (paramCount <= maxColumnsPerRow) {
          // Fewer params than max: always use full width but center the params
          gridColumns = maxColumnsPerRow; // Always use full 6 columns (or responsive max)
          columnsForWidth = paramCount; // But calculate width based on actual params
        } else {
          // More params than max: use max columns and multiple rows
          gridColumns = maxColumnsPerRow;
          columnsForWidth = maxColumnsPerRow;
        }
        
        // Calculate number of rows needed
        const gridRows = Math.ceil(paramCount / gridColumns);
        
        // Calculate fader width based on columns that will actually be used
        const gapWidth = 15 * (columnsForWidth - 1);
        const maxFaderWidth = 120;
        const minFaderWidth = 60;
        let faderWidth = (availableWidth - gapWidth) / columnsForWidth;
        faderWidth = Math.max(minFaderWidth, Math.min(maxFaderWidth, faderWidth));
        
        // Set CSS custom properties
        document.documentElement.style.setProperty('--grid-columns', gridColumns.toString());
        document.documentElement.style.setProperty('--grid-rows', gridRows.toString());
        document.documentElement.style.setProperty('--fader-width', `${faderWidth}px`);
        
        console.log(`Smart grid: ${paramCount} params, ${gridColumns} columns, ${gridRows} rows, fader width: ${faderWidth}px, viewport: ${viewportWidth}px`);
      }
    };

    // Calculate on mount and when currentAudioParams changes
    calculateFaderLayout();

    // Add window resize listener
    window.addEventListener('resize', calculateFaderLayout);

    // Cleanup
    return () => {
      window.removeEventListener('resize', calculateFaderLayout);
    };
  }, [currentAudioParams]);

  // Debug logging for currentAudioParams
  console.log('VisualizationMode render - currentAudioParams:', currentAudioParams);
  console.log('VisualizationMode render - currentAudioParams type:', typeof currentAudioParams);
  console.log('VisualizationMode render - currentAudioParams keys:', currentAudioParams ? Object.keys(currentAudioParams) : 'null/undefined');
  
  // Additional debugging for parameters
  if (currentAudioParams) {
    console.log('Parameter details:');
    Object.entries(currentAudioParams).forEach(([key, value]) => {
      console.log(`  ${key}:`, value);
    });
  }

  return (
    <div className="visualization-mode" style={{ touchAction: 'none' }}>
      {window.electron && (
        <div className="supercollider-management-wrapper">
          <EffectManagement 
            reloadEffectList={reloadEffectList} 
            pullEffectsRepo={pullEffectsRepo}
            effectsRepoStatus={effectsRepoStatus}
            onCheckEffectsRepo={onCheckEffectsRepo}
          />
        </div>
      )}
      
      <div className="source-select-container">
        <button 
          className="nav-button audio-select-button" 
          onClick={onOpenAudioSelect}
        >
          <span className="button-label">Audio:</span>
          <span className="button-value">{prettifySourceName(currentAudioSourcePath)}</span>
        </button>
        {devMode && (
          <button 
            className="nav-button visual-select-button" 
            onClick={onOpenVisualSelect}
          >
            <span className="button-label">Visual:</span>
            <span className="button-value">{activeVisualName}</span>
          </button>
        )}
      </div>

      <VisualizationCanvas 
        currentVisualContent={currentVisualContent}
        currentShaderPath={currentShaderPath}
        currentShaderContent={currentShaderContent}
        paramValuesRef={paramValuesRef} 
        onEffectLoaded={handleEffectLoaded}
        devMode={devMode}
      />
      {isLoadingEffect && <div className="loading-overlay">Loading Effect...</div>}
      <div className="effect-nav-buttons-container">
        <div className="visualization-controls">
          <div className="knobs-container">
            {currentAudioParams && Object.entries(currentAudioParams).map(([paramName, paramSpec], index) => {
              console.log(`VisualizationMode: Processing param ${paramName}:`, paramSpec);
              
              // Calculate grid position for bottom-row-first behavior
              const paramCount = Object.keys(currentAudioParams).length;
              const maxCols = 6; // Use base 6 columns for positioning logic
              let gridColumn, gridRow;
              
              if (paramCount <= maxCols) {
                // Single row: let CSS Grid handle placement
                gridColumn = 'auto';
                gridRow = 'auto'; // This combined with align-items: end should place it at bottom
              } else {
                // Multiple rows: first 6 go to bottom row, rest go above
                // We need to be explicit with rows for multi-row layout to ensure bottom-first
                const totalRows = Math.ceil(paramCount / maxCols);
                if (index < maxCols) {
                  // First 6 parameters: bottom row
                  gridColumn = (index % maxCols) + 1;
                  gridRow = totalRows; // Explicitly set to the last row
                } else {
                  // Subsequent parameters: rows above
                  const positionInUpperRows = index - maxCols;
                  gridColumn = (positionInUpperRows % maxCols) + 1;
                  // Calculate row index from the top (e.g., row 1 for 2-row layout)
                  gridRow = totalRows - 1 - Math.floor(positionInUpperRows / maxCols);
                }
              }
              
              const faderParam = {
                name: paramName,
                value: paramSpec.default,
                range: [paramSpec.minval, paramSpec.maxval],
                index: index,
              };
              console.log(`VisualizationMode: Created faderParam for ${paramName}:`, faderParam);
              return (
                <div
                  key={`${currentAudioSourcePath}-${paramName}`}
                  style={{
                    gridColumn: gridColumn,
                    gridRow: gridRow
                  }}
                >
                  <ParamFader
                    param={faderParam}
                    onParamChange={handleParamChange}
                  />
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

export default VisualizationMode;