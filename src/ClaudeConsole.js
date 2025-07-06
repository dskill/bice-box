import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
import './ClaudeConsole.css';

const ClaudeConsole = ({ 
  isOpen, 
  onOpen,
  onClose, 
  isRecording, 
  onRecordingStart, 
  onRecordingEnd,
  devMode,
  conversationState,
  onConversationStateChange
}) => {
  const terminalRef = useRef(null);
  const terminal = useRef(null);
  const fitAddon = useRef(null);
  const [isLoading, setIsLoading] = useState(false);
  const [terminalId] = useState('claude-terminal');

  const electron = window.electron;

  const closeTerminal = useCallback(() => {
    if (terminal.current) {
      console.log('ClaudeConsole: Closing terminal UI.');
      fitAddon.current.dispose();
      terminal.current.dispose();
      terminal.current = null;
      fitAddon.current = null;
    }
    if (electron) {
      electron.ipcRenderer.send('terminal-destroy', { id: terminalId });
    }
    onClose();
  }, [terminalId, electron, onClose]);

  const destroyTerminal = useCallback(() => {
    if (terminal.current && electron) {
      electron.ipcRenderer.send('terminal-destroy', { id: terminalId });
    }
    if (terminal.current) {
      terminal.current.dispose();
      terminal.current = null;
    }
  }, [terminalId, electron]);

  // Initialize terminal when component mounts and is open
  const initializeTerminal = useCallback(() => {
    if (!terminalRef.current || terminal.current) return;

    console.log('ClaudeConsole: Initializing terminal instance.');
    setIsLoading(true);

    // Create terminal instance
    terminal.current = new Terminal({
      cursorBlink: true,
      theme: {
        background: '#1a1a1a',
        foreground: '#ffffff',
        cursor: '#ffffff',
        selection: '#ffffff40',
        black: '#000000',
        red: '#ff5555',
        green: '#50fa7b',
        yellow: '#f1fa8c',
        blue: '#bd93f9',
        magenta: '#ff79c6',
        cyan: '#8be9fd',
        white: '#bfbfbf',
        brightBlack: '#4d4d4d',
        brightRed: '#ff6e67',
        brightGreen: '#5af78e',
        brightYellow: '#f4f99d',
        brightBlue: '#caa9fa',
        brightMagenta: '#ff92d0',
        brightCyan: '#9aedfe',
        brightWhite: '#e6e6e6'
      },
      fontSize: 14,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      convertEol: true,
      scrollback: 1000,
      tabStopWidth: 4,
      allowProposedApi: true
    });

    // Load addons
    fitAddon.current = new FitAddon();
    terminal.current.loadAddon(fitAddon.current);
    terminal.current.loadAddon(new WebLinksAddon());

    // Open terminal in the DOM
    terminal.current.open(terminalRef.current);
    fitAddon.current.fit();

    // Handle terminal input - send directly to backend without local echo
    terminal.current.onData((data) => {
      if (electron) {
        // Send input directly to backend PTY
        electron.ipcRenderer.send('terminal-data', {
          id: terminalId,
          data: data
        });
      }
    });

    // Handle resize
    terminal.current.onResize(({ cols, rows }) => {
      if (electron) {
        electron.ipcRenderer.send('terminal-resize', { id: terminalId, cols, rows });
      }
    });

    // Create backend terminal process
    if (electron) {
      electron.ipcRenderer.send('terminal-create', {
        id: terminalId,
        cols: terminal.current.cols,
        rows: terminal.current.rows,
      });
    }
    
    setIsLoading(false);
    terminal.current.focus();

  }, [terminalId, electron]);

  // Effect to create/destroy terminal based on isOpen state
  useEffect(() => {
    if (isOpen && !terminal.current) {
      console.log('ClaudeConsole: Creating new terminal instance.');
      initializeTerminal();
    } else if (!isOpen && terminal.current) {
      console.log('ClaudeConsole: Destroying terminal instance.');
      destroyTerminal();
    }
  }, [isOpen, initializeTerminal, destroyTerminal]);

  // Setup IPC listeners once on component mount
  useEffect(() => {
    if (!electron) return;

    const handleOutput = (event, { id, data }) => {
      if (id === terminalId && terminal.current) {
        terminal.current.write(data);
      }
    };

    const handleClosed = (event, { id }) => {
      if (id === terminalId) {
        closeTerminal();
      }
    };

    electron.ipcRenderer.on('terminal-output', handleOutput);
    electron.ipcRenderer.on('terminal-closed', handleClosed);

    return () => {
      electron.ipcRenderer.removeListener('terminal-output', handleOutput);
      electron.ipcRenderer.removeListener('terminal-closed', handleClosed);
    };
  }, [terminalId, electron, closeTerminal]);

  // Handle window resize
  useEffect(() => {
    const handleResize = () => {
      if (fitAddon.current) {
        fitAddon.current.fit();
      }
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  const handleCloseClick = () => {
    onClose();
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
          disabled={isLoading}
        >
          {isRecording ? 'Listening...' : isLoading ? 'Loading...' : 'Hold to Talk'}
        </button>
      ) : (
        // Show Claude button when console is closed
        <button
          className="claude-button"
          onClick={onOpen}
        >
          Terminal
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
            <span className="claude-console-title">Terminal</span>
            {isLoading && (
              <div className="claude-status-indicator">
                <span className="claude-thinking-dots">●●●</span>
                <span>Loading...</span>
              </div>
            )}
          </div>
          
          <div 
            className="claude-terminal"
            ref={terminalRef}
            style={{
              width: '100%',
              height: '100%',
              backgroundColor: '#1a1a1a'
            }}
          />
        </div>
      )}
    </div>
  );
};

export default ClaudeConsole; 