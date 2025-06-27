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

  // Auto-scroll to bottom when new output is added
  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [claudeOutput]);

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

  const handleClearOutput = () => {
    setClaudeOutput('');
    setIsClaudeResponding(false);
    lastOutputLength.current = 0;
  };

  const handleResetSession = () => {
    if (electron) {
      electron.ipcRenderer.send('reset-claude-session');
    }
    setIsClaudeResponding(false);
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
            <button 
              className="claude-action-button" 
              onClick={handleClearOutput}
              title="Clear console output"
              disabled={isClaudeResponding}
            >
              🗑️ Clear
            </button>
            <button 
              className="claude-action-button" 
              onClick={handleResetSession}
              title="Start a new conversation"
              disabled={isClaudeResponding}
            >
              🔄 Reset
            </button>
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