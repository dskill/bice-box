import { useEffect, useCallback } from 'react';

const { ipcRenderer } = window.electron || {};

export default function useSuperCollider() {
  useEffect(() => {
    if (!ipcRenderer) {
      console.warn('Electron IPC not available. Some features may not work.');
      return;
    }

    let removeOutputListener;
    let removeErrorListener;

    const handleSclangOutput = (message) => {
      //console.log('SuperCollider output:', message);
      // Handle the output as needed
    };

    const handleSclangError = (message) => {
      console.error('SuperCollider error:', message);
      // Handle the error as needed
    };

    removeOutputListener = ipcRenderer.on('sclang-output', handleSclangOutput);
    removeErrorListener = ipcRenderer.on('sclang-error', handleSclangError);

    return () => {
      if (removeOutputListener) removeOutputListener();
      if (removeErrorListener) removeErrorListener();
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
