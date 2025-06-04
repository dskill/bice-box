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

  // Calculate responsive fader width based on grid layout and screen size
  useEffect(() => {
    const calculateFaderWidth = () => {
      if (currentAudioParams) {
        const paramCount = Object.keys(currentAudioParams).length;
        const viewportWidth = window.innerWidth;
        const availableWidth = viewportWidth - 40; // Account for padding
        
        // Determine columns per row based on screen size (matching CSS breakpoints)
        let maxColumnsPerRow = 6; // Default (includes 800px)
        if (viewportWidth <= 600) maxColumnsPerRow = 4;
        if (viewportWidth <= 480) maxColumnsPerRow = 3;
        if (viewportWidth <= 360) maxColumnsPerRow = 2;
        
        const columnsPerRow = Math.min(maxColumnsPerRow, paramCount);
        const gapWidth = 15 * (columnsPerRow - 1); // Gap between columns in a row
        const maxFaderWidth = 120;
        const minFaderWidth = 60;
        
        // Calculate ideal width per fader based on columns in a row
        let faderWidth = (availableWidth - gapWidth) / columnsPerRow;
        
        // Clamp to min/max values
        faderWidth = Math.max(minFaderWidth, Math.min(maxFaderWidth, faderWidth));
        
        // Set CSS custom property
        document.documentElement.style.setProperty('--fader-width', `${faderWidth}px`);
        
        console.log(`Grid layout: ${paramCount} params, ${columnsPerRow}/${maxColumnsPerRow} columns, fader width: ${faderWidth}px, viewport: ${viewportWidth}px`);
      }
    };

    // Calculate on mount and when currentAudioParams changes
    calculateFaderWidth();

    // Add window resize listener
    window.addEventListener('resize', calculateFaderWidth);

    // Cleanup
    return () => {
      window.removeEventListener('resize', calculateFaderWidth);
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
              const faderParam = {
                name: paramName,
                value: paramSpec.default,
                range: [paramSpec.minval, paramSpec.maxval],
                index: index,
              };
              console.log(`VisualizationMode: Created faderParam for ${paramName}:`, faderParam);
              return (
                <ParamFader
                  key={`${currentAudioSourcePath}-${paramName}`}
                  param={faderParam}
                  onParamChange={handleParamChange}
                />
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

export default VisualizationMode;