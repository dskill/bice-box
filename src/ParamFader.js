import React, { useState, useEffect, useRef } from 'react';
import useSuperCollider from './hooks/useSuperCollider';
import './ParamFader.css';

const ParamFader = ({ synthName, param, faderId }) => {
  const { name, value, range } = param;
  const { sendCode } = useSuperCollider();
  const [faderValue, setFaderValue] = useState(value);
  const [isDragging, setIsDragging] = useState(false);
  const faderRef = useRef(null);
  const touchIdRef = useRef(null);

  useEffect(() => {
    setFaderValue(value);
    // Send initial value to SuperCollider after a delay
    // this gives the synth some time to init
    // TODO: don't actually switch the UI to the new effect until
    // after the super collider synth is loaded
    // but that's a lot of finnicky work to make happen
    // so let's just use a delay
    const timer = setTimeout(() => {
      sendCode(`~effect.set(\\${name}, ${value})`);
    }, 100); // 500ms delay, adjust as needed

    return () => clearTimeout(timer);
  }, [value, name, sendCode]);

  const handleStart = (event) => {
    event.preventDefault();
    if (event.touches && touchIdRef.current !== null) return; // Already tracking a touch
    setIsDragging(true);
    if (event.touches) {
      touchIdRef.current = event.touches[0].identifier;
    }
    handleMove(event);
  };

  const handleMove = (event) => {
    if (!isDragging) return;
    let clientY;
    if (event.touches) {
      const touch = Array.from(event.touches).find(t => t.identifier === touchIdRef.current);
      if (!touch) return;
      clientY = touch.clientY;
    } else {
      clientY = event.clientY;
    }
    updateFaderValue(clientY);
  };

  const updateFaderValue = (clientY) => {
    const faderRect = faderRef.current.getBoundingClientRect();
    const newValue = 1 - Math.max(0, Math.min(1, (clientY - faderRect.top) / faderRect.height));
    const scaledValue = range[0] + newValue * (range[1] - range[0]);
    setFaderValue(scaledValue);
    sendCode(`~effect.set(\\${name}, ${scaledValue})`);
  };

  const handleEnd = (event) => {
    if (event.changedTouches) {
      const endedTouch = Array.from(event.changedTouches).find(t => t.identifier === touchIdRef.current);
      if (!endedTouch) return;
    }
    setIsDragging(false);
    touchIdRef.current = null;
  };

  useEffect(() => {
    const handleMoveGlobal = (e) => {
      if (e.touches) {
        const touch = Array.from(e.touches).find(t => t.identifier === touchIdRef.current);
        if (touch) {
          updateFaderValue(touch.clientY);
        }
      } else {
        handleMove(e);
      }
    };

    const handleEndGlobal = (e) => handleEnd(e);

    if (isDragging) {
      document.addEventListener('mousemove', handleMoveGlobal);
      document.addEventListener('mouseup', handleEndGlobal);
      document.addEventListener('touchmove', handleMoveGlobal, { passive: false });
      document.addEventListener('touchend', handleEndGlobal);
      document.addEventListener('touchcancel', handleEndGlobal);
    }

    return () => {
      document.removeEventListener('mousemove', handleMoveGlobal);
      document.removeEventListener('mouseup', handleEndGlobal);
      document.removeEventListener('touchmove', handleMoveGlobal);
      document.removeEventListener('touchend', handleEndGlobal);
      document.removeEventListener('touchcancel', handleEndGlobal);
    };
  }, [isDragging]);

  const faderPosition = ((faderValue - range[0]) / (range[1] - range[0])) * 100;

  return (
    <div className="param-fader" ref={faderRef}>
      <div
        className="fader-track"
        onMouseDown={handleStart}
        onTouchStart={handleStart}
      >
        <div
          className={`fader-thumb ${isDragging ? 'dragging' : ''}`}
          style={{ bottom: `${faderPosition}%` }}
        />
      </div>
      <div className={`fader-label ${isDragging ? 'dragging' : ''}`}>{name}</div>
    </div>
  );
};

export default ParamFader;