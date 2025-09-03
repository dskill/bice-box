import React, { useEffect, useRef, useCallback } from 'react';
import { generateColor } from './theme';
import './ParamFader.css';

// High-performance ParamFader using direct DOM manipulation
// Eliminates React re-renders for optimal Raspberry Pi performance

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
  
  // Refs for direct DOM manipulation - NO React state!
  const faderThumbRef = useRef(null);
  const faderTrackRef = useRef(null);
  const faderLabelRef = useRef(null);
  const tooltipRef = useRef(null);
  
  // Essential refs for mouse handling and state tracking
  const currentValueRef = useRef(value);
  const isDraggingRef = useRef(false);
  const initialValueRef = useRef(null);
  const initialMouseYRef = useRef(null);
  const lastUpdateTime = useRef(0);
  const activeTimeoutRef = useRef(null);
  const dragStartTimeRef = useRef(0);
  const faderContainerRef = useRef(null);
  const isActiveRef = useRef(false);

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

  // Direct DOM manipulation functions - bypasses React entirely!
  const updateSliderPosition = useCallback((newValue) => {
    if (!faderContainerRef.current) return;
    
    const percentage = ((newValue - range[0]) / (range[1] - range[0])) * 100;
    const clampedPercentage = Math.max(0, Math.min(100, percentage));
    
    // Update the CSS variable for the vertical scale on the container
    faderContainerRef.current.style.setProperty('--fader-scale', clampedPercentage / 100);
    
    // Update tooltip value if it's visible
    if (tooltipRef.current && (isDraggingRef.current || isActiveRef.current)) {
      tooltipRef.current.textContent = formatValue(newValue, units);
    }
    
    currentValueRef.current = newValue;
  }, [range, units]);

  const setActiveState = useCallback((isActive) => {
    if (!faderThumbRef.current || !faderLabelRef.current || !tooltipRef.current) return;
    
    // Don't interfere with dragging state
    if (isDraggingRef.current) return;
    
    isActiveRef.current = isActive;
    
    if (isActive) {
      faderThumbRef.current.classList.add('dragging');
      faderLabelRef.current.classList.add('dragging');
      tooltipRef.current.style.display = 'block';
      
      if (activeTimeoutRef.current) clearTimeout(activeTimeoutRef.current);
      activeTimeoutRef.current = setTimeout(() => {
        // Don't remove if we started dragging in the meantime
        if (!isDraggingRef.current) {
          isActiveRef.current = false;
          if (faderThumbRef.current) faderThumbRef.current.classList.remove('dragging');
          if (faderLabelRef.current) faderLabelRef.current.classList.remove('dragging');
          if (tooltipRef.current) tooltipRef.current.style.display = 'none';
        }
      }, 400);
    } else {
      isActiveRef.current = false;
      faderThumbRef.current.classList.remove('dragging');
      faderLabelRef.current.classList.remove('dragging');
      tooltipRef.current.style.display = 'none';
    }
  }, []);

  // Throttled version of dispatching unified param action
  const throttledDispatchParam = throttle((paramName, paramValue) => {
    if (window.electron && window.electron.ipcRenderer) {
      window.electron.ipcRenderer.send('effects/actions:set_effect_parameters', { params: { [paramName]: paramValue } });
    }
  }, 50); // 50ms throttle for SuperCollider Single Source of Truth

  // Throttled version of onParamChange callback
  const throttledOnParamChangeRef = useRef(
    throttle((paramName, paramValue) => {
      if (onParamChange) {
        onParamChange(paramName, paramValue);
      }
    }, 50) // 50ms throttle to match SuperCollider broadcast rate
  );

  // Update the throttled function when onParamChange changes
  useEffect(() => {
    throttledOnParamChangeRef.current = throttle((paramName, paramValue) => {
      if (onParamChange) {
        onParamChange(paramName, paramValue);
      }
    }, 50);
  }, [onParamChange]);

  // Handle external parameter updates from SuperCollider
  // Uses direct DOM manipulation instead of React state
  useEffect(() => {
    if (value !== currentValueRef.current) {
      // External parameter value change received
      updateSliderPosition(value);
      
      // Only highlight if we're not currently dragging
      if (!isDraggingRef.current) {
        // Visually highlight this fader briefly to indicate external control
        setActiveState(true);
      }
    }
  }, [value, updateSliderPosition, setActiveState]);

  // Mouse event handlers - setup once on mount, never change
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    const handleMouseMove = (e) => {
      if (!isDraggingRef.current) return;
      
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
        // UI will update when SC broadcasts the value back
        throttledDispatchParam(name, newValue);
        throttledOnParamChangeRef.current(name, newValue);
      }
    };

    const handleMouseUp = () => {
      if (isDraggingRef.current) {
        isDraggingRef.current = false;
        
        // Reset cursor on the container
        if (faderContainerRef.current) {
          faderContainerRef.current.style.cursor = 'grab';
        }
        
        // Remove dragging state
        if (faderThumbRef.current && faderLabelRef.current) {
          faderThumbRef.current.classList.remove('dragging');
          faderLabelRef.current.classList.remove('dragging');
          if (tooltipRef.current) {
            tooltipRef.current.style.display = 'none';
          }
        }
      }
    };

    // Add global pointer event listeners (works for both mouse and touch)
    document.addEventListener('pointermove', handleMouseMove);
    document.addEventListener('pointerup', handleMouseUp);

    return () => {
      document.removeEventListener('pointermove', handleMouseMove);
      document.removeEventListener('pointerup', handleMouseUp);
    };
  }, [name, range, throttledDispatchParam]); // Dependencies for event handlers

  // Mouse down handler for fader
  const handleMouseDown = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    
    isDraggingRef.current = true;
    initialValueRef.current = currentValueRef.current;
    initialMouseYRef.current = e.clientY;
    dragStartTimeRef.current = performance.now();
    
    // Update cursor on the container element
    if (faderContainerRef.current) {
      faderContainerRef.current.style.cursor = 'grabbing';
    }
    
    // Clear any active timeout that might interfere
    if (activeTimeoutRef.current) {
      clearTimeout(activeTimeoutRef.current);
      activeTimeoutRef.current = null;
    }
    
    // Show dragging state immediately and keep it
    if (faderThumbRef.current && faderLabelRef.current) {
      faderThumbRef.current.classList.add('dragging');
      faderLabelRef.current.classList.add('dragging');
      if (tooltipRef.current) {
        tooltipRef.current.style.display = 'block';
        // Tooltip value will be updated when SC broadcasts back
      }
    }
  }, []);

  // Initialize slider position on mount and when value changes
  useEffect(() => {
    updateSliderPosition(value);
  }, [value, updateSliderPosition]);

  // Generate color for the fader (use param.index if available for consistency)
  const faderColor = generateColor(param.index !== undefined ? param.index : name);
  
  // Initial percentage for first render only
  const initialPercentage = ((value - range[0]) / (range[1] - range[0])) * 100;

  // Component renders ONCE and never again!
  return (
    <div 
      ref={faderContainerRef}
      className={`param-fader ${useRotatedLabels ? 'rotated-layout' : ''}`}
      onMouseDown={handleMouseDown}
      onPointerDown={handleMouseDown}
      style={{ 
        '--fader-scale': `${initialPercentage / 100}`,
        touchAction: 'none',
        cursor: 'grab'
      }}
    >
      <div 
        ref={tooltipRef}
        className="fader-value-tooltip"
        style={{ 
          '--fader-color': faderColor,
          display: 'none'  // Initially hidden
        }}
      >
        {formatValue(value, units)}
      </div>
      
      <div className="fader-track" ref={faderTrackRef}>
        <div
          ref={faderThumbRef}
          className="fader-thumb"
          style={{ 
            '--fader-color': faderColor
          }}
        />
      </div>
      
      <div 
        ref={faderLabelRef}
        className="fader-label"
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