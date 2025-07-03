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
  const [isDragging, setIsDragging] = useState(false);
  const outputRef = useRef(null);
  const lastOutputLength = useRef(0);
  const initialYRef = useRef(null);
  const initialScrollTopRef = useRef(null);

  const electron = window.electron;

  // Touch scrolling handler for Raspberry Pi compatibility - matching ParamFader pattern
  useEffect(() => {
    const handlePointerMove = (e) => {
      if (!isDragging || !outputRef.current) return;
      
      console.log('ClaudeConsole: Pointer move detected', e.clientY);
      e.preventDefault();
      
      const deltaY = e.clientY - initialYRef.current;
      const newScrollTop = initialScrollTopRef.current - deltaY;
      
      // Scroll the container
      outputRef.current.scrollTop = newScrollTop;
    };

    const handlePointerUp = () => {
      console.log('ClaudeConsole: Pointer end detected');
      setIsDragging(false);
      initialYRef.current = null;
      initialScrollTopRef.current = null;
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
    console.log('ClaudeConsole: handlePointerDown called', {
      pointerType: e.pointerType,
      pointerId: e.pointerId,
      clientX: e.clientX,
      clientY: e.clientY,
      target: e.target?.className,
      currentTarget: e.currentTarget?.className
    });
    
    // Process all pointer events - on Pi, touch shows up as 'mouse'
    console.log('ClaudeConsole: Processing pointer down event');
    e.preventDefault();
    e.stopPropagation();
    
    setIsDragging(true);
    initialYRef.current = e.clientY;
    initialScrollTopRef.current = outputRef.current?.scrollTop || 0;
    
    console.log('ClaudeConsole: State updated - isDragging should be true');
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
    if (claudeInput.trim() && electron) {
      const message = claudeInput.trim();
      setIsClaudeResponding(true);
      electron.ipcRenderer.send('send-to-claude', message);
      setClaudeInput('');
    }
  };

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
        <button className="claude-console-close" onClick={onClose}>
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
              </div>
            )}
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