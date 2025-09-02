import React, { useState, useEffect, useRef } from 'react';
import { generateColor } from './theme';
import './ParamFader.css';

// ParamFader component for audio effect parameters

// Throttle helper function with trailing edge execution
const throttle = (func, limit) => {
  let inThrottle;
  let lastArgs;
  let lastThis;
  
  return function(...args) {
    lastArgs = args;
    lastThis = this;
    
    if (!inThrottle) {
      func.apply(this, args);
      inThrottle = true;
      
      setTimeout(() => {
        inThrottle = false;
        // Execute the last call that came in during the throttle period
        if (lastArgs) {
          func.apply(lastThis, lastArgs);
          lastArgs = null;
          lastThis = null;
        }
      }, limit);
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
  const [isActive, setIsActive] = useState(false);
  const activeTimeoutRef = useRef(null);

  // Throttled version of dispatching unified param action
  const throttledDispatchParam = throttle((paramName, paramValue) => {
    if (window.electron && window.electron.ipcRenderer) {
      window.electron.ipcRenderer.send('effects/actions:set_effect_parameters', { params: { [paramName]: paramValue } });
    }
  }, 50);

  // Throttled version of parent callback to prevent excessive calls during dragging
  const throttledOnParamChangeRef = useRef(null);
  useEffect(() => {
    throttledOnParamChangeRef.current = throttle((paramName, paramValue) => {
      onParamChange(paramName, paramValue);
    }, 50);
  }, [onParamChange]);

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
  // Always update to show SuperCollider's authoritative value, even while dragging
  useEffect(() => {
    if (value !== currentValueRef.current) {
      // External parameter value change received
      currentValueRef.current = value;
      setFaderValue(value);

      // Visually highlight this fader briefly to indicate external control
      setIsActive(true);
      if (activeTimeoutRef.current) clearTimeout(activeTimeoutRef.current);
      activeTimeoutRef.current = setTimeout(() => setIsActive(false), 400);
    }
  }, [value, isDragging, name]);

  // SuperCollider Single Source of Truth Architecture:
  // - UI sends parameter changes to SuperCollider via mouse interactions
  // - SuperCollider broadcasts authoritative values back to UI
  // - UI always displays SuperCollider's values, never its own local state

  useEffect(() => {
    const handleMouseMove = (e) => {
      if (!isDragging) return;
      
      const now = performance.now();
      if (now - lastUpdateTime.current < 50) return; // 20fps throttle
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
        // Send parameter change to SuperCollider (single source of truth)
        // UI position will update when SuperCollider broadcasts back
        currentValueRef.current = newValue;
        throttledDispatchParam(name, newValue);
        if (throttledOnParamChangeRef.current) {
          throttledOnParamChangeRef.current(name, newValue);
        }
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

  // Cleanup highlight timer on unmount
  useEffect(() => {
    return () => {
      if (activeTimeoutRef.current) clearTimeout(activeTimeoutRef.current);
    };
  }, []);

  const faderPosition = ((faderValue - range[0]) / (range[1] - range[0])) * 100;

  const faderColor = generateColor(param.index);

  const isHighlighted = isDragging || isActive;

  return (
    <div 
      className={`param-fader ${useRotatedLabels ? 'rotated-layout' : ''}`} 
      onMouseDown={handleMouseDown}
      onPointerDown={handleMouseDown}
      style={{ 
        '--fader-scale': `${faderPosition / 100}`,
        touchAction: 'none',
        cursor: isHighlighted ? 'grabbing' : 'grab'
      }}
    >
      {isHighlighted && (
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
          className={`fader-thumb ${isHighlighted ? 'dragging' : ''}`}
          style={{ 
            '--fader-color': faderColor
          }}
        />
      </div>
      <div 
        className={`fader-label ${isHighlighted ? 'dragging' : ''}`}
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