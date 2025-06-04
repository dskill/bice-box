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
  const [actualRenderedColumns, setActualRenderedColumns] = useState(6); // Default to 6, will be updated

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
        
        let maxColumnsPerRow = 6; // Default (includes 800px)
        if (viewportWidth <= 600) maxColumnsPerRow = 4;
        if (viewportWidth <= 480) maxColumnsPerRow = 3;
        if (viewportWidth <= 360) maxColumnsPerRow = 2;
        
        // Use actual param count up to the maximum allowed by viewport
        const gridColumns = Math.min(paramCount, maxColumnsPerRow);
        setActualRenderedColumns(gridColumns); // Update state
        
        const gridRows = Math.ceil(paramCount / gridColumns);
        const gapWidth = 15 * (gridColumns - 1);
        const maxFaderWidth = 120;
        const minFaderWidth = 60;
        let faderWidth = (availableWidth - gapWidth) / gridColumns;
        faderWidth = Math.max(minFaderWidth, Math.min(maxFaderWidth, faderWidth));
        
        document.documentElement.style.setProperty('--grid-columns', gridColumns.toString());
        document.documentElement.style.setProperty('--grid-rows', gridRows.toString());
        document.documentElement.style.setProperty('--fader-width', `${faderWidth}px`);
        
        console.log(`Smart grid: ${paramCount} params, ${gridColumns} cols, ${gridRows} rows, faderWidth: ${faderWidth}px, viewport: ${viewportWidth}px`);
      }
    };
    calculateFaderLayout();
    window.addEventListener('resize', calculateFaderLayout);
    return () => window.removeEventListener('resize', calculateFaderLayout);
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
              const faderParam = {
                name: paramName,
                value: paramSpec.default,
                range: [paramSpec.minval, paramSpec.maxval],
                index: index,
              };
              return (
                <div key={`${currentAudioSourcePath}-${paramName}`}>
                  <ParamFader param={faderParam} onParamChange={handleParamChange} />
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