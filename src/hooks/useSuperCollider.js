import { useEffect, useCallback } from 'react';

const { ipcRenderer } = window.electron || {};

export default function useSuperCollider() {
  useEffect(() => {
    if (!ipcRenderer) {
      console.warn('Electron IPC not available. Some features may not work.');
      return;
    }

    const handleSclangOutput = (event, message) => {
      //console.log('SuperCollider output:', message);
      // Handle the output as needed
    };

    const handleSclangError = (event, message) => {
      console.error('SuperCollider error:', message);
      // Handle the error as needed
    };

    ipcRenderer.on('sclang-output', handleSclangOutput);
    ipcRenderer.on('sclang-error', handleSclangError);

    return () => {
      ipcRenderer.removeListener('sclang-output', handleSclangOutput);
      ipcRenderer.removeListener('sclang-error', handleSclangError);
    };
  }, []);

  const sendCode = useCallback((code) => {
    if (ipcRenderer) {
      ipcRenderer.send('send-to-supercollider', code);
    } else {
      console.warn('Cannot send code to SuperCollider: Electron IPC not available');
    }
  }, []);

  return { sendCode };
}
