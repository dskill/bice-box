class RemoteVisualizerClient {
    constructor() {
        this.ws = null;
        this.toy = null;
        this.canvas = null;
        this.isConnected = false;
        this.currentShader = null;
        
        // RMS tracking (matching VisualizationCanvas.js)
        this.iRMSTime = 0; // Accumulated RMS time
        
        // Auto-detect host and port from current page URL
        this.detectConnectionInfo();
        
        this.initializeUI();
        this.initializeShaderToy();
    }
    
    detectConnectionInfo() {
        // Get the host from the current page URL
        this.host = window.location.hostname || 'localhost';
        this.port = '31337'; // Fixed port for WebSocket server
        
        console.log(`[RemoteClient] Auto-detected connection: ${this.host}:${this.port}`);
    }
    
    initializeUI() {
        // Get UI elements
        this.connectBtn = document.getElementById('connect-btn');
        this.connectOverlay = document.getElementById('connect-overlay');
        this.statusMessage = document.getElementById('status-message');
        this.targetAddress = document.getElementById('target-address');
        
        // Display the target connection address
        this.targetAddress.textContent = `ws://${this.host}:${this.port}`;
        
        // Set up event listeners
        this.connectBtn.addEventListener('click', () => this.connect());
        
        // Handle window resize
        window.addEventListener('resize', () => this.handleWindowResize());
    }
    
    initializeShaderToy() {
        this.canvas = document.getElementById('visualizer-canvas');
        
        // Set initial canvas size to full screen
        this.resizeCanvas();
        
        // Initialize ShaderToyLite with canvas ID, not the canvas element
        // eslint-disable-next-line no-undef
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
    }
    
    connect() {
        if (this.isConnected) return;
        
        const wsUrl = `ws://${this.host}:${this.port}`;
        this.updateStatusMessage('Connecting...', 'connecting');
        this.connectBtn.disabled = true;
        
        try {
            this.ws = new WebSocket(wsUrl);
            
            this.ws.onopen = () => {
                this.isConnected = true;
                this.hideConnectOverlay();
                
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
                this.updateStatusMessage('Connection error', 'error');
                this.handleDisconnect();
            };
            
        } catch (error) {
            console.error('[RemoteClient] Failed to create WebSocket:', error);
            this.updateStatusMessage('Failed to connect', 'error');
            this.connectBtn.disabled = false;
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
        
        this.showConnectOverlay();
        this.updateStatusMessage('Disconnected - Click Connect to reconnect', 'error');
        this.connectBtn.disabled = false;
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
        
        // Reuse audio texture buffer to avoid allocations
        if (!this.audioTextureData) {
            this.audioTextureData = new Uint8Array(1024 * 2 * 4);
        }
        const audioTextureData = this.audioTextureData;
        const combinedData = payload.combinedData;
        
        // Extract RMS values first (no array allocation needed)
        const rmsMultiplier = 1.0; // Same as VisualizationCanvas.js
        const rmsInput = combinedData.length > 2048 ? combinedData[2048] * rmsMultiplier : 0;
        const rmsOutput = combinedData.length > 2049 ? combinedData[2049] * rmsMultiplier : 0;
        
        // Fill row 0 with FFT data (frequency spectrum) - no array allocation
        for (let i = 0; i < 1024; i++) {
            let fftMagnitude = 0;
            
            // Access FFT data directly from combinedData (indices 1024-2047)
            const fftIndex = 1024 + i;
            if (fftIndex < combinedData.length) {
                // FFT data contains pre-computed magnitudes with logarithmic scaling applied
                fftMagnitude = combinedData[fftIndex] || 0;
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
        
        // Fill row 1 with waveform data (time domain) - no array allocation
        for (let i = 0; i < 1024; i++) {
            // Access waveform data directly from combinedData (indices 0-1023)
            const waveformValue = i < combinedData.length ? combinedData[i] : 0;
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
        
        // Update RMS uniforms (matching VisualizationCanvas.js logic)
        if (this.toy) {
            // Set RMS input and output values
            if (this.toy.setRMSInput) {
                this.toy.setRMSInput(rmsInput);
            }
            if (this.toy.setRMSOutput) {
                this.toy.setRMSOutput(rmsOutput);
            }
            
            // Update and set iRMSTime (matching VisualizationCanvas.js)
            // magic number to get it closer to iTime roughly
            this.iRMSTime += rmsOutput * 0.025; // Accumulate rmsOutput
            if (this.toy.setRmsTime) {
                this.toy.setRmsTime(this.iRMSTime);
            }
        }
    }
    
    handleShaderUpdate(payload) {
        console.log('[RemoteClient] Shader update received:', payload.shaderPath);
        
        if (!payload.shaderContent) {
            console.warn('[RemoteClient] No shader content in update');
            return;
        }
        
        try {
            // Properly clean up the current shader before loading a new one
            this.cleanupCurrentShader();
            
            if (typeof payload.shaderContent === 'string') {
                // Single-pass shader
                this.loadSinglePassShader(payload.shaderContent, payload.shaderPath);
            } else if (typeof payload.shaderContent === 'object') {
                // Multi-pass shader
                this.loadMultiPassShader(payload.shaderContent, payload.shaderPath);
            }
            
            this.currentShader = payload.shaderPath;
            console.log(`[RemoteClient] Loaded shader: ${payload.shaderPath}`);
            
        } catch (error) {
            console.error('[RemoteClient] Error loading shader:', error);
            console.error(`[RemoteClient] Error loading shader: ${payload.shaderPath}`);
        }
    }
    
    cleanupCurrentShader() {
        if (this.toy) {
            console.log('[RemoteClient] Cleaning up current shader resources');
            
            // Pause the current shader
            this.toy.pause();
            
            // Force WebGL context cleanup if available
            if (this.toy.gl) {
                const gl = this.toy.gl;
                
                // Clear any bound textures and framebuffers
                gl.bindTexture(gl.TEXTURE_2D, null);
                gl.bindFramebuffer(gl.FRAMEBUFFER, null);
                gl.bindRenderbuffer(gl.RENDERBUFFER, null);
                
                // Clear the canvas
                gl.clear(gl.COLOR_BUFFER_BIT);
                
                // Force a flush to ensure cleanup
                gl.flush();
            }
            
            // Reset the ShaderToyLite instance by recreating it
            // This ensures all shader programs and resources are properly cleaned up
            const canvasId = this.canvas.id;
            
            // eslint-disable-next-line no-undef
            this.toy = new ShaderToyLite(canvasId);
            
            console.log('[RemoteClient] ShaderToyLite instance recreated for clean state');
        }
    }
    
    loadSinglePassShader(shaderSource, shaderPath) {
        // Always use full resolution on remote devices (ignore Pi scaling factor)
        const resolutionScale = 1.0;
        this.updateCanvasSize(resolutionScale);
        
        this.toy.setImage({ source: shaderSource });
        this.toy.play();
        
        console.log('[RemoteClient] Single-pass shader loaded at full resolution:', shaderPath);
    }
    
    loadMultiPassShader(shaderConfig, shaderPath) {
        // Always use full resolution on remote devices (ignore Pi scaling factor)
        const resolutionScale = 1.0;
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
        
        console.log('[RemoteClient] Multi-pass shader loaded at full resolution:', shaderPath);
    }
    
    getResolutionScaleFromMetadata(shaderSource) {
        const resolutionMatch = shaderSource.match(/\/\/\s*resolution:\s*([0-9.]+)/);
        return resolutionMatch ? parseFloat(resolutionMatch[1]) : 1.0;
    }
    
    updateCanvasSize(resolutionScale) {
        // Use CSS dimensions instead of device pixels to avoid Retina scaling issues
        const baseWidth = document.documentElement.clientWidth;
        const baseHeight = document.documentElement.clientHeight;
        
        const newWidth = Math.floor(baseWidth * resolutionScale);
        const newHeight = Math.floor(baseHeight * resolutionScale);
        
        console.log(`[RemoteClient] Setting canvas size: ${newWidth}x${newHeight} (scale: ${resolutionScale})`);
        
        this.canvas.width = newWidth;
        this.canvas.height = newHeight;
        
        // Update ShaderToyLite with new dimensions
        if (this.toy && this.toy.resize) {
            this.toy.resize(newWidth, newHeight);
        }
    }
    
    updateStatusMessage(message, type = '') {
        this.statusMessage.textContent = message;
        this.statusMessage.className = type ? `status-${type}` : '';
    }

    showConnectOverlay() {
        this.connectOverlay.classList.remove('hidden');
    }

    hideConnectOverlay() {
        this.connectOverlay.classList.add('hidden');
    }

    resizeCanvas() {
        if (this.canvas) {
            // Use CSS dimensions to avoid Retina scaling issues
            this.canvas.width = document.documentElement.clientWidth;
            this.canvas.height = document.documentElement.clientHeight;
            console.log(`[RemoteClient] Canvas resized to: ${this.canvas.width}x${this.canvas.height}`);
        }
    }

    handleWindowResize() {
        this.resizeCanvas();
        
        // Refresh the shader to handle the new canvas size
        if (this.toy && this.currentShader) {
            // ShaderToyLite should automatically handle canvas resize,
            // but we can trigger a refresh if needed
            console.log('[RemoteClient] Window resized, canvas updated');
        }
    }
}

// Initialize the client when the page loads
document.addEventListener('DOMContentLoaded', () => {
    console.log('[RemoteClient] Initializing remote visualizer client');
    new RemoteVisualizerClient();
}); 