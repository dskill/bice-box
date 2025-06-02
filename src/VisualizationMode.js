import React, { useState, useRef, useCallback } from 'react';
import EffectManagement from './EffectManagement';
import ParamFader from './ParamFader';
import VisualizationCanvas from './VisualizationCanvas';

function VisualizationMode({ 
  currentPresetName,
  currentAudioSourcePath, 
  currentVisualSourcePath, 
  currentVisualContent,
  currentShaderPath,
  currentShaderContent,
  currentAudioParams,
  onOpenAudioSelect, 
  onOpenVisualSelect,
  onOpenPresetSelect,
  reloadEffectList, 
  pullEffectsRepo, 
  hardReloadCurrentEffect,
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

  return (
    <div className="visualization-mode" style={{ touchAction: 'none' }}>
      {window.electron && (
        <div className="supercollider-management-wrapper">
          <EffectManagement 
            reloadEffectList={reloadEffectList} 
            pullEffectsRepo={pullEffectsRepo}
            hardReloadCurrentEffect={hardReloadCurrentEffect}
            effectsRepoStatus={effectsRepoStatus}
            onCheckEffectsRepo={onCheckEffectsRepo}
          />
        </div>
      )}
      
      <div className="source-select-container">
        <button 
          className="nav-button preset-select-button" 
          onClick={onOpenPresetSelect}
        >
          <span className="button-label">Preset:</span>
          <span className="button-value">{currentPresetName}</span> 
        </button>
        {devMode && (
          <>
            <button 
              className="nav-button audio-select-button" 
              onClick={onOpenAudioSelect}
            >
              <span className="button-label">Audio:</span>
              <span className="button-value">{prettifySourceName(currentAudioSourcePath)}</span>
            </button>
            <button 
              className="nav-button visual-select-button" 
              onClick={onOpenVisualSelect}
            >
              <span className="button-label">Visual:</span>
              <span className="button-value">{activeVisualName}</span>
            </button>
          </>
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