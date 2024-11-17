import React, { useState, useEffect, useRef } from 'react';
import useSuperCollider from './hooks/useSuperCollider';
import './ParamFader.css';

const ParamFader = ({ synthName, param, faderId, gestureState, currentSynth }) => {
  const { name, value, range } = param;
  const { sendCode } = useSuperCollider();
  const [faderValue, setFaderValue] = useState(value);
  const [isDragging, setIsDragging] = useState(false);
  const currentValueRef = useRef(value);
  const initialValueRef = useRef(null);

  // Helper function to convert camelCase to Title Case
  const toTitleCase = (str) => {
    // First split the camelCase string into words
    const result = str.replace(/([A-Z])/g, ' $1');
    // Convert first character to uppercase and trim any extra spaces
    return result.charAt(0).toUpperCase() + result.slice(1).trim();
  };

  // Handle initial value and external value changes
  useEffect(() => {
    if (value !== currentValueRef.current) {
      currentValueRef.current = value;
      setFaderValue(value);
    }
  }, [value]);

  // Handle SuperCollider updates
  useEffect(() => {
    if (faderValue !== currentValueRef.current) {
      currentValueRef.current = faderValue;
      sendCode(`~effect.set(\\${name}, ${faderValue})`);
    }
  }, [faderValue, name, sendCode]);

  // Add this new useEffect to set initial value when dragging starts
  useEffect(() => {
    if (gestureState?.dragging && !isDragging) {
      // Set initial value when drag starts
      gestureState.initialValue = faderValue;
    }
  }, [gestureState?.dragging]);

  // Handle gesture updates
  useEffect(() => {
    if (!gestureState || !gestureState.dragging) {
      setIsDragging(false);
      initialValueRef.current = null;
      return;
    }

    if (initialValueRef.current === null) {
      initialValueRef.current = faderValue;
    }

    const [_, my] = gestureState.movement;
    if (Math.abs(my) > Math.abs(gestureState.movement[0])) {
      setIsDragging(true);
      
      // Convert pixel movement to percentage of screen height
      const normalizedMovement = my / window.innerHeight;
      
      // Use the initial value from our ref
      const valueRange = range[1] - range[0];
      const newValue = Math.max(range[0], Math.min(range[1], 
        initialValueRef.current + -(normalizedMovement * valueRange)
      ));
      
      if (newValue !== currentValueRef.current) {
        setFaderValue(newValue);
      }
    }
  }, [gestureState, range, faderValue]);

  const faderPosition = ((faderValue - range[0]) / (range[1] - range[0])) * 100;

  // Update the color generation function to ensure better distribution
  const generateColor = (synthName, paramName, index) => {
    const str = `${synthName}-${paramName}`;
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    
    // Get a base hue from the hash
    const baseHue = (hash % 360 + 360) % 360;
    
    // Add an offset based on the parameter's position
    const paramIndex = currentSynth?.params?.findIndex(p => p.name === paramName) || 0;
    const hueOffset = (paramIndex * 60) % 360; // Distribute colors evenly around the color wheel
    
    const finalHue = (baseHue + hueOffset) % 360;
    return `hsla(${finalHue}, 85%, 60%, 0.8)`;
  };

  return (
    <div className="param-fader" data-fader-id={faderId}>
      <div className="fader-track">
        <div
          className={`fader-thumb ${isDragging ? 'dragging' : ''}`}
          style={{ 
            '--fader-scale': `${faderPosition / 100}`,
            '--fader-color': generateColor(synthName, name)
          }}
        />
      </div>
      <div 
        className={`fader-label ${isDragging ? 'dragging' : ''}`}
        style={{ 
          '--fader-color': generateColor(synthName, name)
        }}
      >
        {toTitleCase(name)}
      </div>
    </div>
  );
};

export default ParamFader;