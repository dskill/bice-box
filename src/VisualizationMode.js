import React, { useState, useRef, useCallback, useEffect } from 'react';
import VisualizationCanvas from './VisualizationCanvas';

function VisualizationMode({ 
  currentAudioSourcePath, 
  currentVisualSourcePath, 
  currentVisualContent,
  currentShaderPath,
  currentShaderContent,
  onOpenEffectSelect,
  devMode,
  paramValues
}) {
  const [isLoadingEffect, setIsLoadingEffect] = useState(false);

  const handleEffectLoaded = useCallback(() => {
    setIsLoadingEffect(false);
  }, []);

  const prettifySourceName = (sourcePath) => {
    if (!sourcePath) return 'None';
    let name = sourcePath.split('/').pop().split('.')[0];
    name = name.replace(/_/g, " ");
    return name;
  };

  return (
    <div className="visualization-mode" style={{ touchAction: 'none' }}>
      
      <div className="source-select-container">
        <button 
          className="nav-button effect-select-button" 
          onClick={onOpenEffectSelect}
        >
          <span className="button-value">{prettifySourceName(currentAudioSourcePath)}</span>
        </button>
      </div>

      <VisualizationCanvas 
        currentVisualContent={currentVisualContent}
        currentShaderPath={currentShaderPath}
        currentShaderContent={currentShaderContent}
        onEffectLoaded={handleEffectLoaded}
        devMode={devMode}
        paramValues={paramValues}
      />
      {isLoadingEffect && <div className="loading-overlay">Loading Effect...</div>}
    </div>
  );
}

export default VisualizationMode;
