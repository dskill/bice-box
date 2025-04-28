import React, { useState, useRef } from 'react';
import EffectManagement from './EffectManagement';
import ParamFader from './ParamFader';
import VisualizationCanvas from './VisualizationCanvas';

function VisualizationMode({ 
  currentPresetName,
  currentAudioSourcePath, 
  currentVisualSourcePath, 
  currentVisualContent,
  currentAudioParams,
  onOpenAudioSelect, 
  onOpenVisualSelect,
  reloadEffectList, 
  pullEffectsRepo, 
  effectsRepoStatus, 
  onCheckEffectsRepo 
}) {
  const [isLoadingEffect, setIsLoadingEffect] = useState(false);
  const paramValuesRef = useRef({});

  const handleEffectLoaded = () => {
    setIsLoadingEffect(false);
  };

  const handleParamChange = (paramName, value) => {
    paramValuesRef.current[paramName] = value;
    if (window.electron && currentAudioSourcePath) {
      const derivedSynthDefName = currentAudioSourcePath.split('/').pop().split('.')[0];
      if (derivedSynthDefName) {
        const scCode = `~${derivedSynthDefName}.set(\${paramName}, ${value});`;
        console.log(`Sending SC: ${scCode}`);
        window.electron.ipcRenderer.send('send-to-supercollider', scCode);
      } else {
        console.warn(`Could not derive SynthDef name from: ${currentAudioSourcePath}`);
      }
    } else {
      console.warn('Cannot send param change: No current audio source path');
    }
  };

  const prettifySourceName = (sourcePath) => {
    if (!sourcePath) return 'None';
    let name = sourcePath.split('/').pop().split('.')[0];
    name = name.replace(/_/g, " ");
    return name;
  };

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
          Audio: {prettifySourceName(currentAudioSourcePath)}
        </button>
        <button 
          className="nav-button visual-select-button" 
          onClick={onOpenVisualSelect}
        >
          Visual: {prettifySourceName(currentVisualSourcePath)}
        </button>
      </div>

      <VisualizationCanvas 
        currentEffect={currentAudioSourcePath}
        currentVisualContent={currentVisualContent}
        paramValuesRef={paramValuesRef} 
        onEffectLoaded={handleEffectLoaded}
      />
      <div className="visualization-controls">
        <div className="knobs-container">
          {currentAudioParams && currentAudioParams.map((param, index) => (
            <ParamFader
              key={`${currentAudioSourcePath}-${param.name}`}
              param={{ ...param, index }}
              onParamChange={handleParamChange}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

export default VisualizationMode;