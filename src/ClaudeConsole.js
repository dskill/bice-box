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
  const outputRef = useRef(null);

  const electron = window.electron;

  // Auto-scroll to bottom when new output is added
  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [claudeOutput]);

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
      electron.ipcRenderer.send('send-to-claude', message);
      setClaudeInput('');
    }
  };

  const handleClearOutput = () => {
    setClaudeOutput('');
  };

  const handleResetSession = () => {
    if (electron) {
      electron.ipcRenderer.send('reset-claude-session');
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
        >
          {isRecording ? 'Listening...' : 'Hold to Talk'}
        </button>
      ) : (
        // Show Claude button when console is closed
        <button
          className="claude-button"
          onClick={onOpen}
        >
          Claude
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
            >
              🗑️ Clear
            </button>
            <button 
              className="claude-action-button" 
              onClick={handleResetSession}
              title="Start a new conversation"
            >
              🔄 Reset
            </button>
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
              placeholder="Type to Claude..."
              autoFocus
            />
            <button type="submit" className="claude-send-button">
              Send
            </button>
          </form>
        </div>
      )}
    </div>
  );
};

export default ClaudeConsole; 