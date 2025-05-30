import React, { useState, useEffect, useRef, useCallback } from 'react';
import useSuperCollider from './hooks/useSuperCollider';
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

const ParamFader = ({ param, onParamChange }) => {
  const { name, value, range } = param;
  const { sendCode } = useSuperCollider();
  const [faderValue, setFaderValue] = useState(value);
  const [isDragging, setIsDragging] = useState(false);
  const currentValueRef = useRef(value);
  const initialValueRef = useRef(null);
  const initialMouseYRef = useRef(null);
  const lastUpdateTime = useRef(0);

  // Throttled version of sendCode
  const throttledSendCode = useCallback(
    throttle((code) => sendCode(code), 16), // ~60fps
    [sendCode]
  );

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
      onParamChange(name, faderValue);
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
      const code = `~effect.set(\\${name}, ${faderValue})`;
      throttledSendCode(code);
      onParamChange(name, faderValue);
    }
  }, [faderValue, name, throttledSendCode, onParamChange]);

  useEffect(() => {
    const handleMouseMove = (e) => {
      if (!isDragging) return;
      
      const now = performance.now();
      if (now - lastUpdateTime.current < 16) return; // 60fps throttle
      lastUpdateTime.current = now;

      const deltaY = (e.clientY - initialMouseYRef.current) / window.innerHeight;
      const valueRange = range[1] - range[0];
      const newValue = Math.max(range[0], Math.min(range[1],
        initialValueRef.current + -(deltaY * valueRange)
      ));

      if (Math.abs(newValue - currentValueRef.current) > 0.001) {
        setFaderValue(newValue);
      }
    };

    const handleMouseUp = (e) => {
      console.log('Mouse up event:', e); // Add logging
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
    console.log('Mouse down event:', e);
    setIsDragging(true);
    initialValueRef.current = faderValue;
    initialMouseYRef.current = e.clientY;
  };

  const faderPosition = ((faderValue - range[0]) / (range[1] - range[0])) * 100;

  const faderColor = generateColor(param.index);

  return (
    <div 
      className="param-fader" 
      onMouseDown={handleMouseDown}
      onPointerDown={handleMouseDown}
      style={{ 
        touchAction: 'none',
        cursor: isDragging ? 'grabbing' : 'grab'
      }}
    >
      <div className="fader-track">
        <div
          className={`fader-thumb ${isDragging ? 'dragging' : ''}`}
          style={{ 
            '--fader-scale': `${faderPosition / 100}`,
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