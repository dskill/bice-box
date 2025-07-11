import React, { useState, useEffect, useRef, useCallback } from 'react';
import { generateColor } from './theme';
import './ParamFader.css';

// Throttle helper function
const throttle = (func, limit) => {
  let inThrottle;
  return function(...args) {
    if (!inThrottle) {
      func.apply(this, args);
      inThrottle = true;
      setTimeout(() => inThrottle = false, limit);
    }
  }
};

const ParamFader = ({ param, onParamChange, useRotatedLabels }) => {
  const { name, value, range, units } = param;
  const [faderValue, setFaderValue] = useState(value);
  const [isDragging, setIsDragging] = useState(false);
  const currentValueRef = useRef(value);
  const initialValueRef = useRef(null);
  const initialMouseYRef = useRef(null);
  const lastUpdateTime = useRef(0);
  const faderTrackRef = useRef(null);

  // Throttled version of sending OSC message
  const throttledSendOsc = useCallback(
    throttle((oscAddress, oscArgs) => {
      if (window.electron && window.electron.ipcRenderer) {
        window.electron.ipcRenderer.send('send-osc-to-sc', { address: oscAddress, args: oscArgs });
      }
    }, 16), // ~60fps (1000ms / 60fps = ~16.67ms)
    [] // No dependencies needed for this version of throttledSendOsc
  );

  // Throttled version of parent callback to prevent excessive calls during dragging
  const throttledOnParamChange = useCallback(
    throttle((paramName, paramValue) => {
      onParamChange(paramName, paramValue);
    }, 16), // Match OSC throttling rate
    [onParamChange]
  );

  // Helper function to convert camelCase to Title Case
  const toTitleCase = (str) => {
    // First split the camelCase string into words
    const result = str.replace(/([A-Z])/g, ' $1');
    // Convert first character to uppercase and trim any extra spaces
    return result.charAt(0).toUpperCase() + result.slice(1).trim();
  };

  // Helper function to format the value with appropriate precision and units
  const formatValue = (val, unit) => {
    let formattedValue;
    
    // Format based on unit type and value range
    if (unit === 'Hz' && val >= 1000) {
      formattedValue = (val / 1000).toFixed(1) + ' k';
    } else if (unit === 'Hz' || unit === 's' || unit === 'ms') {
      formattedValue = val.toFixed(val < 1 ? 3 : val < 10 ? 2 : 1);
    } else if (unit === '%') {
      formattedValue = Math.round(val * 100);
    } else if (unit === 'dB') {
      formattedValue = val.toFixed(1);
    } else if (unit === 'x' || unit === 'Q') {
      formattedValue = val.toFixed(2);
    } else if (unit === 'bits' || unit === 'st') {
      formattedValue = Math.round(val);
    } else {
      // Default formatting for other units or no units
      formattedValue = val.toFixed(val < 1 ? 3 : val < 10 ? 2 : 1);
    }
    
    return unit ? `${formattedValue} ${unit}` : formattedValue;
  };

  // Handle initial value and external value changes
  useEffect(() => {
    if (value !== currentValueRef.current) {
      currentValueRef.current = value;
      setFaderValue(value);
      // Remove the onParamChange call here to avoid double-calling
    }
  }, [value]);

  // init value
  useEffect(() => {
    onParamChange(name, faderValue);
  }, []);

  // Handle SuperCollider updates
  useEffect(() => {
    if (faderValue !== currentValueRef.current) {
      currentValueRef.current = faderValue;
      throttledSendOsc('/effect/param/set', [name, faderValue]);
      throttledOnParamChange(name, faderValue); // Use throttled version
    }
  }, [faderValue, name, throttledSendOsc, throttledOnParamChange]);

  useEffect(() => {
    const handleMouseMove = (e) => {
      if (!isDragging) return;
      
      const now = performance.now();
      if (now - lastUpdateTime.current < 16) return; // 60fps throttle
      lastUpdateTime.current = now;

      if (!faderTrackRef.current) return;
      const faderHeight = faderTrackRef.current.offsetHeight;
      if (faderHeight === 0) return;

      let deltaY = (e.clientY - initialMouseYRef.current) / faderHeight;
      const valueRange = range[1] - range[0];
      const newValue = Math.max(range[0], Math.min(range[1],
        initialValueRef.current + -(deltaY * valueRange)
      ));

      // Use a more effective threshold based on the value range
      const threshold = Math.max(0.001, valueRange * 0.0001); // Adaptive threshold
      if (Math.abs(newValue - currentValueRef.current) > threshold) {
        setFaderValue(newValue);
      }
    };

    const handleMouseUp = (e) => {
      setIsDragging(false);
      initialValueRef.current = null;
      initialMouseYRef.current = null;
    };

    if (isDragging) {
      // Add both mouse and pointer events
      window.addEventListener('mousemove', handleMouseMove, { passive: false });
      window.addEventListener('pointermove', handleMouseMove, { passive: false });
      window.addEventListener('mouseup', handleMouseUp);
      window.addEventListener('pointerup', handleMouseUp);
      window.addEventListener('pointercancel', handleMouseUp); // Handle touch cancellation
    }

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('pointermove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('pointerup', handleMouseUp);
      window.removeEventListener('pointercancel', handleMouseUp);
    };
  }, [isDragging, range]);

  const handleMouseDown = (e) => {
    e.preventDefault();
    e.stopPropagation(); // Prevent event bubbling
    
    setIsDragging(true);
    initialValueRef.current = faderValue;
    initialMouseYRef.current = e.clientY;
  };

  const faderPosition = ((faderValue - range[0]) / (range[1] - range[0])) * 100;

  const faderColor = generateColor(param.index);

  return (
    <div 
      className={`param-fader ${useRotatedLabels ? 'rotated-layout' : ''}`} 
      onMouseDown={handleMouseDown}
      onPointerDown={handleMouseDown}
      style={{ 
        '--fader-scale': `${faderPosition / 100}`,
        touchAction: 'none',
        cursor: isDragging ? 'grabbing' : 'grab'
      }}
    >
      {isDragging && (
        <div 
          className="fader-value-tooltip"
          style={{ 
            '--fader-color': faderColor
          }}
        >
          {formatValue(faderValue, units)}
        </div>
      )}
      <div className="fader-track" ref={faderTrackRef}>
        <div
          className={`fader-thumb ${isDragging ? 'dragging' : ''}`}
          style={{ 
            '--fader-color': faderColor
          }}
        />
      </div>
      <div 
        className={`fader-label ${isDragging ? 'dragging' : ''}`}
        style={{ 
          '--fader-color': faderColor
        }}
      >
        {toTitleCase(name)}
      </div>
    </div>
  );
};

export default ParamFader;