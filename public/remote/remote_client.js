class RemoteVisualizerClient {
    constructor() {
        this.ws = null;
        this.toy = null;
        this.canvas = null;
        this.isConnected = false;
        this.currentShader = null;
        
        this.initializeUI();
        this.initializeShaderToy();
    }
    
    initializeUI() {
        // Get UI elements
        this.hostInput = document.getElementById('host-input');
        this.portInput = document.getElementById('port-input');
        this.connectBtn = document.getElementById('connect-btn');
        this.disconnectBtn = document.getElementById('disconnect-btn');
        this.statusDiv = document.getElementById('status');
        this.shaderInfo = document.getElementById('shader-info');
        this.connectionInfo = document.getElementById('connection-info');
        
        // Set up event listeners
        this.connectBtn.addEventListener('click', () => this.connect());
        this.disconnectBtn.addEventListener('click', () => this.disconnect());
        
        // Allow Enter key to connect
        this.hostInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.connect();
        });
        this.portInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.connect();
        });
    }
    
    initializeShaderToy() {
        this.canvas = document.getElementById('visualizer-canvas');
        
        // Initialize ShaderToyLite with canvas ID, not the canvas element
        this.toy = new ShaderToyLite('visualizer-canvas');
        
        // Set up a default shader to show the canvas is working
        const defaultShader = `
            void mainImage( out vec4 fragColor, in vec2 fragCoord ) {
                vec2 uv = fragCoord/iResolution.xy;
                float t = iTime * 0.5;
                vec3 col = 0.5 + 0.5*cos(t + uv.xyx + vec3(0,2,4));
                fragColor = vec4(col, 1.0);
            }
        `;
        
        this.toy.setImage({ source: defaultShader });
        this.toy.play();
        
        this.updateShaderInfo('Default shader (waiting for connection)');
    }
    
    connect() {
        if (this.isConnected) return;
        
        const host = this.hostInput.value.trim();
        const port = this.portInput.value.trim();
        
        if (!host || !port) {
            this.updateStatus('Please enter both host IP and port', 'disconnected');
            return;
        }
        
        const wsUrl = `ws://${host}:${port}`;
        this.updateStatus('Connecting...', 'connecting');
        this.updateConnectionInfo(`Connecting to ${wsUrl}`);
        
        try {
            this.ws = new WebSocket(wsUrl);
            
            this.ws.onopen = () => {
                this.isConnected = true;
                this.updateStatus(`Connected to ${host}:${port}`, 'connected');
                this.updateConnectionInfo(`Connected to ${wsUrl}`);
                this.connectBtn.disabled = true;
                this.disconnectBtn.disabled = false;
                this.hostInput.disabled = true;
                this.portInput.disabled = true;
                
                console.log('[RemoteClient] WebSocket connected');
            };
            
            this.ws.onmessage = (event) => {
                this.handleMessage(event.data);
            };
            
            this.ws.onclose = () => {
                this.handleDisconnect();
                console.log('[RemoteClient] WebSocket disconnected');
            };
            
            this.ws.onerror = (error) => {
                console.error('[RemoteClient] WebSocket error:', error);
                this.updateStatus('Connection error', 'disconnected');
                this.handleDisconnect();
            };
            
        } catch (error) {
            console.error('[RemoteClient] Failed to create WebSocket:', error);
            this.updateStatus('Failed to connect', 'disconnected');
            this.updateConnectionInfo('Connection failed');
        }
    }
    
    disconnect() {
        if (this.ws) {
            this.ws.close();
        }
        this.handleDisconnect();
    }
    
    handleDisconnect() {
        this.isConnected = false;
        this.ws = null;
        
        this.updateStatus('Disconnected', 'disconnected');
        this.updateConnectionInfo('Disconnected');
        
        this.connectBtn.disabled = false;
        this.disconnectBtn.disabled = true;
        this.hostInput.disabled = false;
        this.portInput.disabled = false;
    }
    
    handleMessage(data) {
        try {
            const message = JSON.parse(data);
            console.log('[RemoteClient] Received message:', message.type);
            
            switch (message.type) {
                case 'audioData':
                    this.handleAudioData(message.payload);
                    break;
                case 'shaderUpdate':
                    this.handleShaderUpdate(message.payload);
                    break;
                default:
                    console.warn('[RemoteClient] Unknown message type:', message.type);
            }
        } catch (error) {
            console.error('[RemoteClient] Error parsing message:', error);
        }
    }
    
    handleAudioData(payload) {
        if (!payload.combinedData || !Array.isArray(payload.combinedData)) {
            console.warn('[RemoteClient] Invalid audio data received');
            return;
        }
        
        // Prepare audio texture data (1024x2 RGBA)
        const audioTextureData = new Uint8Array(1024 * 2 * 4);
        const combinedData = payload.combinedData;
        
        // Extract data arrays (matching VisualizationCanvas.js logic)
        const waveformData = combinedData.slice(0, 1024);
        const fftData = combinedData.slice(1024, 2048);
        
        // Fill row 0 with FFT data (frequency spectrum) - matching VisualizationCanvas.js
        for (let i = 0; i < 1024; i++) {
            let fftMagnitude = 0;
            
            if (i < fftData.length && fftData.length > 0) {
                // FFT data contains pre-computed magnitudes with logarithmic scaling applied
                fftMagnitude = fftData[i] || 0;
            }
            
            // Normalize to 0-255 range for 8-bit texture (matching VisualizationCanvas.js)
            // Use the same magic number (100) as VisualizationCanvas.js
            const normalizedFFT = Math.max(0, Math.min(255, Math.round(fftMagnitude * 100)));
            
            const row0Index = i * 4; // Row 0, pixel i
            audioTextureData[row0Index + 0] = normalizedFFT; // R
            audioTextureData[row0Index + 1] = normalizedFFT; // G
            audioTextureData[row0Index + 2] = normalizedFFT; // B
            audioTextureData[row0Index + 3] = 255; // A (opaque)
        }
        
        // Fill row 1 with waveform data (time domain) - matching VisualizationCanvas.js
        for (let i = 0; i < 1024; i++) {
            const waveformValue = waveformData[i] !== undefined ? waveformData[i] : 0;
            // Normalize waveform data (assuming it's -1 to 1) to 0-255 for 8-bit texture
            // Use the same formula as VisualizationCanvas.js
            const normalizedWaveform = Math.max(0, Math.min(255, Math.round((waveformValue * 0.5 + 0.5) * 255)));
            
            const row1Index = (1024 + i) * 4; // Row 1, pixel i
            audioTextureData[row1Index + 0] = normalizedWaveform; // R
            audioTextureData[row1Index + 1] = normalizedWaveform; // G
            audioTextureData[row1Index + 2] = normalizedWaveform; // B
            audioTextureData[row1Index + 3] = 255; // A (opaque)
        }
        
        // Update ShaderToyLite audio texture
        if (this.toy && this.toy.updateAudioTexture) {
            this.toy.updateAudioTexture(audioTextureData, 1024, 2);
        }
    }
    
    handleShaderUpdate(payload) {
        console.log('[RemoteClient] Shader update received:', payload.shaderPath);
        
        if (!payload.shaderContent) {
            console.warn('[RemoteClient] No shader content in update');
            return;
        }
        
        try {
            // Pause current shader
            if (this.toy) {
                this.toy.pause();
            }
            
            if (typeof payload.shaderContent === 'string') {
                // Single-pass shader
                this.loadSinglePassShader(payload.shaderContent, payload.shaderPath);
            } else if (typeof payload.shaderContent === 'object') {
                // Multi-pass shader
                this.loadMultiPassShader(payload.shaderContent, payload.shaderPath);
            }
            
            this.currentShader = payload.shaderPath;
            this.updateShaderInfo(`Loaded: ${payload.shaderPath}`);
            
        } catch (error) {
            console.error('[RemoteClient] Error loading shader:', error);
            this.updateShaderInfo(`Error loading: ${payload.shaderPath}`);
        }
    }
    
    loadSinglePassShader(shaderSource, shaderPath) {
        // Check for resolution metadata
        const resolutionScale = this.getResolutionScaleFromMetadata(shaderSource);
        this.updateCanvasSize(resolutionScale);
        
        this.toy.setImage({ source: shaderSource });
        this.toy.play();
        
        console.log('[RemoteClient] Single-pass shader loaded:', shaderPath);
    }
    
    loadMultiPassShader(shaderConfig, shaderPath) {
        // Check for resolution metadata in the image shader
        const resolutionScale = shaderConfig.image ? 
            this.getResolutionScaleFromMetadata(shaderConfig.image) : 1.0;
        this.updateCanvasSize(resolutionScale);
        
        // Set up multi-pass configuration
        if (shaderConfig.common) {
            this.toy.setCommon(shaderConfig.common);
        }
        
        if (shaderConfig.bufferA) {
            this.toy.setBufferA({ source: shaderConfig.bufferA, iChannel0: "A" });
        }
        
        if (shaderConfig.bufferB) {
            this.toy.setBufferB({ source: shaderConfig.bufferB, iChannel0: "B" });
        }
        
        if (shaderConfig.bufferC) {
            this.toy.setBufferC({ source: shaderConfig.bufferC, iChannel0: "C" });
        }
        
        if (shaderConfig.bufferD) {
            this.toy.setBufferD({ source: shaderConfig.bufferD, iChannel0: "D" });
        }
        
        if (shaderConfig.image) {
            const imageConfig = { source: shaderConfig.image };
            
            // Set up channels for the image pass
            if (shaderConfig.bufferA) imageConfig.iChannel0 = "A";
            if (shaderConfig.bufferB) imageConfig.iChannel1 = "B";
            if (shaderConfig.bufferC) imageConfig.iChannel2 = "C";
            if (shaderConfig.bufferD) imageConfig.iChannel3 = "D";
            
            this.toy.setImage(imageConfig);
        }
        
        this.toy.play();
        
        console.log('[RemoteClient] Multi-pass shader loaded:', shaderPath);
    }
    
    getResolutionScaleFromMetadata(shaderSource) {
        const resolutionMatch = shaderSource.match(/\/\/\s*resolution:\s*([0-9.]+)/);
        return resolutionMatch ? parseFloat(resolutionMatch[1]) : 1.0;
    }
    
    updateCanvasSize(resolutionScale) {
        const baseWidth = 800;
        const baseHeight = 600;
        
        const newWidth = Math.floor(baseWidth * resolutionScale);
        const newHeight = Math.floor(baseHeight * resolutionScale);
        
        this.canvas.width = newWidth;
        this.canvas.height = newHeight;
        
        // Update ShaderToyLite with new dimensions
        if (this.toy && this.toy.resize) {
            this.toy.resize(newWidth, newHeight);
        }
    }
    
    updateStatus(message, className) {
        this.statusDiv.textContent = message;
        this.statusDiv.className = `status ${className}`;
    }
    
    updateShaderInfo(message) {
        this.shaderInfo.textContent = message;
    }
    
    updateConnectionInfo(message) {
        this.connectionInfo.textContent = message;
    }
}

// Initialize the client when the page loads
document.addEventListener('DOMContentLoaded', () => {
    console.log('[RemoteClient] Initializing remote visualizer client');
    new RemoteVisualizerClient();
}); 