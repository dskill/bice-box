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
  const outputRef = useRef(null);
  const lastOutputLength = useRef(0);

  const electron = window.electron;

  // Touch scrolling handler for Raspberry Pi compatibility
  useEffect(() => {
    const container = outputRef.current;
    if (!container) return;

    let startY = 0;
    let lastY = 0;
    let isDragging = false;
    let pointerId = null;

    const handlePointerStart = (e) => {
      // Only handle touch/pen input, not mouse
      if (e.pointerType === 'mouse') return;
      
      console.log('ClaudeConsole: Pointer start detected', e.pointerType);
      startY = e.clientY;
      lastY = startY;
      isDragging = true;
      pointerId = e.pointerId;
      
      // Capture pointer events
      container.setPointerCapture(e.pointerId);
      e.preventDefault();
    };

    const handlePointerMove = (e) => {
      if (!isDragging || e.pointerId !== pointerId) return;
      
      console.log('ClaudeConsole: Pointer move detected', e.clientY);
      e.preventDefault();
      
      const currentY = e.clientY;
      const deltaY = lastY - currentY;
      
      // Scroll the container
      container.scrollTop += deltaY;
      lastY = currentY;
    };

    const handlePointerEnd = (e) => {
      if (e.pointerId !== pointerId) return;
      
      console.log('ClaudeConsole: Pointer end detected');
      isDragging = false;
      pointerId = null;
      
      // Release pointer capture
      if (container.hasPointerCapture(e.pointerId)) {
        container.releasePointerCapture(e.pointerId);
      }
    };

    // Add pointer event listeners
    container.addEventListener('pointerdown', handlePointerStart);
    container.addEventListener('pointermove', handlePointerMove);
    container.addEventListener('pointerup', handlePointerEnd);
    container.addEventListener('pointercancel', handlePointerEnd);

    // Cleanup
    return () => {
      container.removeEventListener('pointerdown', handlePointerStart);
      container.removeEventListener('pointermove', handlePointerMove);
      container.removeEventListener('pointerup', handlePointerEnd);
      container.removeEventListener('pointercancel', handlePointerEnd);
    };
  }, []);

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