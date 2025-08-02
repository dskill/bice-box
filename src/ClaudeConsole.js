import React, { useState, useEffect, useRef, useCallback } from 'react';
import './ClaudeConsole.css';

const ClaudeConsole = ({ 
  isOpen, 
  onOpen,
  onClose, 
  isRecording, 
  onRecordingStart, 
  onRecordingEnd,
  devMode
}) => {
  const [claudeOutput, setClaudeOutput] = useState('');
  const [claudeInput, setClaudeInput] = useState('');
  const [isClaudeResponding, setIsClaudeResponding] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  // Using optimized --continue approach, no toggle needed
  const outputRef = useRef(null);
  const lastOutputLength = useRef(0);
  const hasDraggedBeyondThresholdRef = useRef(false);
  const initialYRef = useRef(null);
  const initialXRef = useRef(null);
  const initialScrollTopRef = useRef(null);
  const lastUpdateTimeRef = useRef(0);
  const DRAG_THRESHOLD = 15;

  const electron = window.electron;

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
      
      // Check if Claude finished responding (cost info or error indicates end)
      if ((newContent.includes('💰 Cost:') || newContent.includes('❌ Error:')) && isClaudeResponding) {
        setIsClaudeResponding(false);
      }
    }
    lastOutputLength.current = currentLength;
  }, [claudeOutput, isClaudeResponding]);

  const handleClaudeResponse = useCallback((event, data) => {
    setClaudeOutput(prev => prev + data);
  }, []); // Empty dependency array ensures this function is created only once.

  // Listen for Claude responses
  useEffect(() => {
    if (electron) {
      electron.ipcRenderer.on('claude-response', handleClaudeResponse);

      return () => {
        electron.ipcRenderer.removeAllListeners('claude-response');
      };
    }
  }, [electron, handleClaudeResponse]);

  const handleSendToClaude = (e) => {
    e.preventDefault();
    // Prevent submission if user has dragged beyond threshold
    if (hasDraggedBeyondThresholdRef.current) {
      return;
    }
    
    if (claudeInput.trim() && electron) {
      const message = claudeInput.trim();
      setIsClaudeResponding(true);
      electron.ipcRenderer.send('send-to-claude', message);
      setClaudeInput('');
    }
  };

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
    
    if (electron && isClaudeResponding) {
      setIsClaudeResponding(false);
      electron.ipcRenderer.send('cancel-claude');
    }
  };

  const handleResetClaude = () => {
    // Prevent reset if user has dragged beyond threshold
    if (hasDraggedBeyondThresholdRef.current) {
      return;
    }
    
    if (electron && !isClaudeResponding) {
      // Clear the output display
      setClaudeOutput('');
      
      // Send reset command to backend
      electron.ipcRenderer.send('reset-claude-session');
    }
  };

  // Removed toggle functionality - using optimized --continue approach

  if (!devMode) {
    return null;
  }

  return (
    <div className="claude-ui-container">
      {isOpen ? (
        // Show Hold to Talk button when console is open
        <button
          className={`claude-button ${isRecording ? 'recording' : ''}`}
          onMouseDown={onRecordingStart}
          onMouseUp={onRecordingEnd}
          onMouseLeave={onRecordingEnd}
          onTouchStart={onRecordingStart}
          onTouchEnd={onRecordingEnd}
          disabled={isClaudeResponding}
        >
          {isRecording ? 'Listening...' : isClaudeResponding ? 'AI is responding...' : 'Hold to Talk'}
        </button>
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
          <div className="claude-console-header">
            {isClaudeResponding && (
              <div className="claude-status-indicator">
                <span className="claude-thinking-dots">●●●</span>
                <span>AI is responding...</span>
                <button 
                  className="claude-cancel-button"
                  onClick={handleCancelClaude}
                  title="Cancel current request"
                >
                  Cancel
                </button>
              </div>
            )}
            {!isClaudeResponding && (
              <div className="claude-controls">
                <button 
                  className="claude-reset-button"
                  onClick={handleResetClaude}
                  title="Start a new conversation (clear history)"
                >
                  Reset
                </button>
              </div>
            )}
            {/* Using optimized --continue approach - no toggle needed */}
          </div>
          
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
          
          <form onSubmit={handleSendToClaude} className="claude-input-form">
            <input
              type="text"
              className="claude-input"
              value={claudeInput}
              onChange={(e) => setClaudeInput(e.target.value)}
              placeholder="Type to AI..."
              autoFocus
              disabled={isClaudeResponding}
            />
            <button 
              type="submit" 
              className="claude-send-button"
              disabled={isClaudeResponding || !claudeInput.trim()}
            >
              {isClaudeResponding ? '...' : 'Send'}
            </button>
          </form>
        </div>
      )}
    </div>
  );
};

export default ClaudeConsole; 