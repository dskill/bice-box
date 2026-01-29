/**
 * IPC Proxy - Unified interface for Electron IPC and WebSocket communication
 *
 * When running in Electron, uses window.electron.ipcRenderer directly.
 * When running in a browser (remote phone control), uses WebSocket to proxy
 * IPC messages to the Electron main process.
 */

class IPCProxy {
  constructor() {
    this.isElectron = !!window.electron;
    this.ws = null;
    this.wsUrl = null;
    this.listeners = new Map(); // channel -> Set of callbacks
    this.invokeCallbacks = new Map(); // requestId -> { resolve, reject }
    this.invokeCounter = 0;
    this.connectionStatus = 'disconnected';
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 10;
    this.reconnectDelay = 1000;
    this.pendingMessages = [];
    this.statusListeners = new Set();
  }

  /**
   * Connect to WebSocket server (only used in browser mode)
   */
  connect(wsUrl) {
    if (this.isElectron) {
      console.log('[ipcProxy] Running in Electron, WebSocket not needed');
      this.connectionStatus = 'connected';
      this.notifyStatusListeners();
      return Promise.resolve();
    }

    // Use the same host and port as the page was served from
    const port = window.location.port || '31337';
    this.wsUrl = wsUrl || `ws://${window.location.hostname}:${port}`;

    return new Promise((resolve, reject) => {
      this.connectionStatus = 'connecting';
      this.notifyStatusListeners();

      try {
        this.ws = new WebSocket(this.wsUrl);

        this.ws.onopen = () => {
          this.connectionStatus = 'connected';
          this.reconnectAttempts = 0;
          this.notifyStatusListeners();

          // Send any pending messages
          while (this.pendingMessages.length > 0) {
            const msg = this.pendingMessages.shift();
            this.ws.send(JSON.stringify(msg));
          }

          resolve();
        };

        this.ws.onmessage = (event) => {
          this.handleMessage(event.data);
        };

        this.ws.onclose = () => {
          this.connectionStatus = 'disconnected';
          this.notifyStatusListeners();
          this.scheduleReconnect();
        };

        this.ws.onerror = (error) => {
          this.connectionStatus = 'error';
          this.notifyStatusListeners();
          reject(error);
        };

      } catch (error) {
        console.error('[ipcProxy] Failed to create WebSocket:', error);
        this.connectionStatus = 'error';
        this.notifyStatusListeners();
        reject(error);
      }
    });
  }

  /**
   * Schedule a reconnection attempt
   */
  scheduleReconnect() {
    if (this.isElectron) return;
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('[ipcProxy] Max reconnect attempts reached');
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(1.5, this.reconnectAttempts - 1);
    console.log(`[ipcProxy] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);

    setTimeout(() => {
      if (this.connectionStatus === 'disconnected') {
        this.connect(this.wsUrl).catch(() => {
          // Error handling already done in connect()
        });
      }
    }, delay);
  }

  /**
   * Handle incoming WebSocket messages
   */
  handleMessage(data) {
    try {
      const message = JSON.parse(data);

      switch (message.type) {
        case 'ipc-event':
          // Incoming event from main process (broadcast)
          this.dispatchEvent(message.channel, message.data);
          break;

        case 'ipc-response':
          // Response to an invoke call
          const callback = this.invokeCallbacks.get(message.requestId);
          if (callback) {
            this.invokeCallbacks.delete(message.requestId);
            if (message.error) {
              callback.reject(new Error(message.error));
            } else {
              callback.resolve(message.result);
            }
          }
          break;

        case 'audioData':
        case 'shaderUpdate':
          // Pass through visualizer messages to listeners
          this.dispatchEvent(message.type, message.payload);
          break;

        default:
          // Dispatch as generic event
          if (message.channel) {
            this.dispatchEvent(message.channel, message.data);
          }
      }
    } catch (error) {
      console.error('[ipcProxy] Error parsing message:', error);
    }
  }

  /**
   * Dispatch an event to registered listeners
   */
  dispatchEvent(channel, data) {
    const callbacks = this.listeners.get(channel);
    if (callbacks) {
      callbacks.forEach(callback => {
        try {
          // Match Electron IPC signature: (event, ...args)
          callback({}, data);
        } catch (error) {
          console.error(`[ipcProxy] Error in listener for ${channel}:`, error);
        }
      });
    }
  }

  /**
   * Send a message (fire and forget)
   */
  send(channel, data) {
    if (this.isElectron) {
      window.electron.ipcRenderer.send(channel, data);
      return;
    }

    const message = {
      type: 'ipc-send',
      channel,
      data
    };

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    } else {
      // Queue message for when connection is established
      this.pendingMessages.push(message);
    }
  }

  /**
   * Wait for WebSocket connection to be established
   */
  waitForConnection(timeout = 10000) {
    if (this.isElectron) return Promise.resolve();
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return Promise.resolve();

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.statusListeners.delete(listener);
        reject(new Error('Connection timeout'));
      }, timeout);

      const listener = (status) => {
        if (status === 'connected') {
          clearTimeout(timeoutId);
          this.statusListeners.delete(listener);
          resolve();
        }
      };
      this.statusListeners.add(listener);
    });
  }

  /**
   * Invoke a method and wait for response
   */
  async invoke(channel, ...args) {
    if (this.isElectron) {
      return window.electron.ipcRenderer.invoke(channel, ...args);
    }

    // Wait for connection if not connected yet
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      await this.waitForConnection();
    }

    return new Promise((resolve, reject) => {
      const requestId = ++this.invokeCounter;

      this.invokeCallbacks.set(requestId, { resolve, reject });

      const message = {
        type: 'ipc-invoke',
        channel,
        args,
        requestId
      };

      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify(message));
      } else {
        this.invokeCallbacks.delete(requestId);
        reject(new Error('WebSocket not connected'));
      }

      // Timeout after 30 seconds
      setTimeout(() => {
        if (this.invokeCallbacks.has(requestId)) {
          this.invokeCallbacks.delete(requestId);
          reject(new Error(`Invoke timeout for ${channel}`));
        }
      }, 30000);
    });
  }

  /**
   * Register an event listener
   */
  on(channel, callback) {
    if (this.isElectron) {
      return window.electron.ipcRenderer.on(channel, callback);
    }

    if (!this.listeners.has(channel)) {
      this.listeners.set(channel, new Set());
    }
    this.listeners.get(channel).add(callback);

    // Return unsubscribe function (matching Electron API)
    return () => this.removeListener(channel, callback);
  }

  /**
   * Register a one-time event listener
   */
  once(channel, callback) {
    if (this.isElectron) {
      window.electron.ipcRenderer.once(channel, callback);
      return;
    }

    const wrappedCallback = (event, data) => {
      this.removeListener(channel, wrappedCallback);
      callback(event, data);
    };

    this.on(channel, wrappedCallback);
  }

  /**
   * Remove an event listener
   */
  removeListener(channel, callback) {
    if (this.isElectron) {
      window.electron.ipcRenderer.removeListener(channel, callback);
      return;
    }

    const callbacks = this.listeners.get(channel);
    if (callbacks) {
      callbacks.delete(callback);
      if (callbacks.size === 0) {
        this.listeners.delete(channel);
      }
    }
  }

  /**
   * Remove all listeners for a channel
   */
  removeAllListeners(channel) {
    if (this.isElectron) {
      window.electron.ipcRenderer.removeAllListeners(channel);
      return;
    }

    this.listeners.delete(channel);
  }

  /**
   * Get OpenAI API key (special case used by Whisper)
   */
  async getOpenAIKey() {
    if (this.isElectron) {
      return window.electron.ipcRenderer.getOpenAIKey();
    }
    return this.invoke('get-openai-key');
  }

  /**
   * Subscribe to connection status changes
   */
  onStatusChange(callback) {
    this.statusListeners.add(callback);
    // Immediately call with current status
    callback(this.connectionStatus);

    return () => {
      this.statusListeners.delete(callback);
    };
  }

  /**
   * Notify all status listeners
   */
  notifyStatusListeners() {
    this.statusListeners.forEach(callback => {
      try {
        callback(this.connectionStatus);
      } catch (error) {
        console.error('[ipcProxy] Error in status listener:', error);
      }
    });
  }

  /**
   * Get current connection status
   */
  getConnectionStatus() {
    return this.connectionStatus;
  }

  /**
   * Check if we're running in Electron
   */
  isRunningInElectron() {
    return this.isElectron;
  }
}

// Create singleton instance
const ipcProxy = new IPCProxy();

// Auto-connect for browser mode
if (!ipcProxy.isRunningInElectron()) {
  // Connect when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      ipcProxy.connect().catch(error => {
        console.error('[ipcProxy] Initial connection failed:', error);
      });
    });
  } else {
    ipcProxy.connect().catch(error => {
      console.error('[ipcProxy] Initial connection failed:', error);
    });
  }
}

export default ipcProxy;
