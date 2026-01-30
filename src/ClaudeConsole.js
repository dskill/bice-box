import React, { useState, useEffect, useRef, useCallback } from 'react';
import ipcProxy from './ipcProxy';
import './ClaudeConsole.css';

// Detect if we're in remote mode (browser, not Electron)
const isRemoteMode = !window.electron;

const ClaudeConsole = ({
  isOpen,
  onOpen,
  onClose,
  isRecording,
  onRecordingStart,
  onRecordingEnd,
  devMode,
  // Add props to sync responding state
  isResponding,
  onRespondingChange
}) => {
  const [claudeOutput, setClaudeOutput] = useState('');
  // Use prop if available, otherwise local state (for backward compatibility if needed)
  const [localIsClaudeResponding, setLocalIsClaudeResponding] = useState(false);
  const isClaudeResponding = isResponding !== undefined ? isResponding : localIsClaudeResponding;
  const setIsClaudeResponding = onRespondingChange || setLocalIsClaudeResponding;

  const [isDragging, setIsDragging] = useState(false);
  const [textInput, setTextInput] = useState('');
  const inputRef = useRef(null);
  // Using optimized --continue approach, no toggle needed
  const outputRef = useRef(null);
  const lastOutputLength = useRef(0);
  const hasDraggedBeyondThresholdRef = useRef(false);
  const initialYRef = useRef(null);
  const initialXRef = useRef(null);
  const initialScrollTopRef = useRef(null);
  const lastUpdateTimeRef = useRef(0);
  const DRAG_THRESHOLD = 15;

  // Touch scrolling handler for Raspberry Pi compatibility - matching ParamFader pattern
  useEffect(() => {
    const handlePointerMove = (e) => {
      if (!isDragging || !outputRef.current) {
        return;
      }
      
      // Throttle updates to 60fps like ParamFader
      const now = performance.now();
      if (now - lastUpdateTimeRef.current < 16) return;
      lastUpdateTimeRef.current = now;
      
      e.preventDefault();
      
      const deltaY = e.clientY - initialYRef.current;
      const deltaX = e.clientX - initialXRef.current;
      const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
      
      // Check if we've moved beyond the drag threshold (only set once)
      if (distance > DRAG_THRESHOLD && !hasDraggedBeyondThresholdRef.current) {
        hasDraggedBeyondThresholdRef.current = true;
      }
      
      const newScrollTop = initialScrollTopRef.current - deltaY;
      
      // Use requestAnimationFrame for smooth scrolling
      requestAnimationFrame(() => {
        if (outputRef.current) {
          outputRef.current.scrollTop = newScrollTop;
        }
      });
    };

    const handlePointerUp = () => {
      setIsDragging(false);
      initialYRef.current = null;
      initialXRef.current = null;
      initialScrollTopRef.current = null;
      
      // Reset drag threshold flag after a short delay to allow click prevention
      setTimeout(() => {
        hasDraggedBeyondThresholdRef.current = false;
      }, 100);
    };

    if (isDragging) {
      // Add listeners to window like ParamFader does
      window.addEventListener('pointermove', handlePointerMove, { passive: false });
      window.addEventListener('pointerup', handlePointerUp);
      window.addEventListener('pointercancel', handlePointerUp);
    }

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
    };
  }, [isDragging]);

  const handlePointerDown = (e) => {
    // Process all pointer events - on Pi, touch shows up as 'mouse'
    e.preventDefault();
    e.stopPropagation();
    
    const scrollTop = outputRef.current?.scrollTop || 0;
    
    setIsDragging(true);
    hasDraggedBeyondThresholdRef.current = false;
    initialYRef.current = e.clientY;
    initialXRef.current = e.clientX;
    initialScrollTopRef.current = scrollTop;
    lastUpdateTimeRef.current = 0; // Reset throttle timer
  };

  // Auto-scroll to bottom when new output is added
  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [claudeOutput]);

  // Scroll to bottom when console is opened
  useEffect(() => {
    if (isOpen && outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [isOpen]);

  // Track when Claude starts and stops responding
  useEffect(() => {
    const currentLength = claudeOutput.length;
    if (currentLength > lastOutputLength.current) {
      // New content added
      const newContent = claudeOutput.slice(lastOutputLength.current);
      
      // Check if Claude just started responding
      if (newContent.includes('\nClaude: ') && !isClaudeResponding) {
        setIsClaudeResponding(true);
      }
      
      // Check if Claude finished responding (duration info or error indicates end)
      if ((newContent.includes('⏱️ Duration:') || newContent.includes('❌ Error:')) && isClaudeResponding) {
        setIsClaudeResponding(false);
      }
    }
    lastOutputLength.current = currentLength;
  }, [claudeOutput, isClaudeResponding]);

  const handleClaudeResponse = useCallback((event, data) => {
    setClaudeOutput(prev => prev + data);
  }, []); // Empty dependency array ensures this function is created only once.

  // Listen for Claude responses and session resets
  useEffect(() => {
    const unsubscribeResponse = ipcProxy.on('claude-response', handleClaudeResponse);

    // Listen for session reset events to clear the output
    const handleSessionReset = () => {
      setClaudeOutput('');
    };
    const unsubscribeReset = ipcProxy.on('claude-session-reset', handleSessionReset);

    return () => {
      if (typeof unsubscribeResponse === 'function') {
        unsubscribeResponse();
      } else {
        ipcProxy.removeAllListeners('claude-response');
      }
      if (typeof unsubscribeReset === 'function') {
        unsubscribeReset();
      } else {
        ipcProxy.removeAllListeners('claude-session-reset');
      }
    };
  }, [handleClaudeResponse]);

  // handleSendToClaude removed - now using floating controls

  const handleCloseClick = () => {
    // Prevent close if user has dragged beyond threshold
    if (hasDraggedBeyondThresholdRef.current) {
      return;
    }
    onClose();
  };

  const handleCancelClaude = () => {
    // Prevent cancel if user has dragged beyond threshold
    if (hasDraggedBeyondThresholdRef.current) {
      return;
    }

    if (isClaudeResponding) {
      setIsClaudeResponding(false);
      ipcProxy.send('cancel-claude');
    }
  };

  // handleResetClaude moved to EffectManagement component

  // Handle text input submission (for remote mode)
  const handleTextSubmit = (e) => {
    e.preventDefault();
    if (!textInput.trim() || isClaudeResponding) return;

    ipcProxy.send('send-to-claude', textInput.trim());
    setTextInput('');
  };

  // Focus input when console opens in remote mode
  useEffect(() => {
    if (isOpen && isRemoteMode && inputRef.current) {
      // Small delay to ensure the input is rendered
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  if (!devMode) {
    return null;
  }

  return (
    <div className="claude-ui-container">
      {isOpen ? (
        // In remote mode, show a smaller toggle button; on Pi, show Hold to Talk
        isRemoteMode ? (
          <button
            className={`claude-button ${isClaudeResponding ? 'thinking' : ''}`}
            onClick={isClaudeResponding ? handleCancelClaude : onClose}
          >
            {isClaudeResponding ? 'Thinking...' : 'Vibe'}
          </button>
        ) : (
          <button
            className={`claude-button ${isRecording ? 'recording' : ''} ${isClaudeResponding ? 'thinking' : ''}`}
            onMouseDown={isClaudeResponding ? undefined : onRecordingStart}
            onMouseUp={isClaudeResponding ? undefined : onRecordingEnd}
            onMouseLeave={isClaudeResponding ? undefined : onRecordingEnd}
            onTouchStart={isClaudeResponding ? undefined : onRecordingStart}
            onTouchEnd={isClaudeResponding ? undefined : onRecordingEnd}
            onClick={isClaudeResponding ? handleCancelClaude : undefined}
            disabled={false}
          >
            {isRecording ? 'Listening...' : isClaudeResponding ? 'Thinking...' : 'Hold to Talk'}
          </button>
        )
      ) : (
        // Show Claude button when console is closed
        <button
          className="claude-button"
          onClick={onOpen}
        >
          Vibe
        </button>
      )}

      {isOpen && (
        <button className="claude-console-close" onClick={handleCloseClick}>
          ×
        </button>
      )}

      {isOpen && (
        <div className="claude-console">
          <pre
            className="claude-output"
            ref={outputRef}
            onPointerDown={handlePointerDown}
            style={{
              touchAction: 'none', // Match ParamFader
              cursor: isDragging ? 'grabbing' : 'default'
            }}
          >
            {claudeOutput}
          </pre>

          {/* Text input for remote mode (phone) */}
          {isRemoteMode && (
            <form className="claude-input-form" onSubmit={handleTextSubmit}>
              <input
                ref={inputRef}
                type="text"
                className="claude-input"
                value={textInput}
                onChange={(e) => setTextInput(e.target.value)}
                placeholder="Type a message..."
                disabled={isClaudeResponding}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
              />
              <button
                type="submit"
                className="claude-send-button"
                disabled={isClaudeResponding || !textInput.trim()}
              >
                Send
              </button>
            </form>
          )}
        </div>
      )}
    </div>
  );
};

export default ClaudeConsole; 