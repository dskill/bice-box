const { spawn } = require('child_process');
const path = require('path');

class ClaudeManager {
    constructor(effectsRepoPath) {
        this.effectsRepoPath = effectsRepoPath;
        this.currentSessionId = null;
        this.hasHadConversation = false; // Track if we've had any conversation for --continue
        this.mainWindow = null;
        this.abortController = null;
        
        // Streaming JSON input process management (official Claude Code feature)
        this.streamingProcess = null;
        this.isStreamingProcessReady = false;
        this.streamingProcessQueue = [];
        this.currentStreamingRequest = null;
        this.useStreamingProcess = true; // ✅ always use JSON-stream worker
        this.streamingProcessBuffer = '';
        this.streamingProcessInitialized = false;
        
        // Auto-start streaming process
        this.startStreamingProcess();
    }

    setMainWindow(mainWindow) {
        this.mainWindow = mainWindow;
    }

    hasActiveSession() {
        return this.hasHadConversation;
    }

    // Start a streaming claude-code process using official streaming JSON input
    async startStreamingProcess() {
        if (this.streamingProcess) {
            console.log('Streaming Claude process already running');
            return;
        }

        console.log('Starting streaming Claude process with official streaming JSON input...');
        
        const homeDir = process.env.HOME;
        const nvmBinPath = process.env.NVM_BIN;
        const claudeCliPath = homeDir ? path.join(homeDir, '.claude', 'local', 'node_modules', '.bin') : null;

        const extendedPath = [
            process.env.PATH,
            nvmBinPath,
            claudeCliPath,
            homeDir ? path.join(homeDir, '.local', 'bin') : null,
            '/usr/local/bin',
        ].filter(Boolean).join(path.delimiter);

        const cleanEnv = {
            ...process.env,
            PATH: extendedPath,
            ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
            NODE_OPTIONS: ''
        };

        // Start claude with streaming JSON input/output (official feature)
        const commandParts = [
            'claude',
            '-p',
            '--input-format=stream-json',
            '--output-format=stream-json',
            '--verbose'
        ];

        if (this.currentSessionId) {
            commandParts.push('--resume', this.currentSessionId);
        }

        const fullCommand = commandParts.join(' ');
        console.log(`Starting streaming process: ${fullCommand}`);

        try {
            this.streamingProcess = spawn(fullCommand, [], {
                stdio: ['pipe', 'pipe', 'pipe'],
                cwd: this.effectsRepoPath,
                env: cleanEnv,
                shell: true
            });

            this.streamingProcess.on('error', (error) => {
                console.error('Streaming Claude process error:', error);
                this.handleStreamingProcessError(error);
            });

            this.streamingProcess.on('close', (code) => {
                console.log(`Streaming Claude process closed with code: ${code}`);
                this.handleStreamingProcessClose(code);
            });

            this.streamingProcess.stdout.on('data', (data) => {
                this.handleStreamingProcessOutput(data);
            });

            this.streamingProcess.stderr.on('data', (data) => {
                console.log(`Streaming Claude stderr: ${data.toString()}`);
            });

            // Send an initial message to trigger initialization
            setTimeout(() => {
                if (this.streamingProcess && this.streamingProcess.stdin) {
                    console.log('Sending initialization message to streaming process...');
                    const initMessage = {
                        type: 'user',
                        message: {
                            role: 'user',
                            content: [
                                {
                                    type: 'text',
                                    text: 'Ready'
                                }
                            ]
                        }
                    };
                    this.streamingProcess.stdin.write(JSON.stringify(initMessage) + '\n');
                }
            }, 1000);

            // Wait for the process to be ready
            await this.waitForStreamingProcessReady();
            
            console.log('Streaming Claude process is ready');
            this.sendToRenderer('\n🚀 Streaming Claude process started - instant responses enabled!\n');
            
        } catch (error) {
            console.error('Failed to start streaming Claude process:', error);
            this.streamingProcess = null;
            this.isStreamingProcessReady = false;
        }
    }

    // Wait for the streaming process to be ready
    async waitForStreamingProcessReady() {
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Streaming process initialization timeout'));
            }, 30000); // 30 second timeout

            const checkReady = () => {
                if (this.streamingProcessInitialized) {
                    clearTimeout(timeout);
                    this.isStreamingProcessReady = true;
                    resolve();
                } else {
                    setTimeout(checkReady, 100);
                }
            };

            checkReady();
        });
    }

    // Handle output from streaming process
    handleStreamingProcessOutput(data) {
        this.streamingProcessBuffer += data.toString();
        
        // Process complete JSON lines
        const lines = this.streamingProcessBuffer.split('\n');
        this.streamingProcessBuffer = lines.pop() || '';
        
        for (const line of lines) {
            if (line.trim()) {
                try {
                    const message = JSON.parse(line);
                    this.handleStreamingMessage(message);
                } catch (parseError) {
                    console.warn('Failed to parse JSON line from streaming process:', line.substring(0, 100));
                }
            }
        }
    }

    // Handle stream messages from streaming process
    handleStreamingMessage(message) {
        // Mark process as initialized on first system message
        if (message.type === 'system' && message.subtype === 'init') {
            this.streamingProcessInitialized = true;
            console.log(`Streaming Claude process initialized with model: ${message.model}`);
            return;
        }

        // Skip displaying initialization messages to user
        if (message.type === 'result' && !this.streamingProcessInitialized) {
            this.streamingProcessInitialized = true;
            console.log(`Streaming Claude process initialized and ready for requests`);
            
            // Store session ID from initialization
            if (message.session_id) {
                this.currentSessionId = message.session_id;
                console.log(`Stored session ID from initialization: ${this.currentSessionId}`);
            }
            return; // Don't process this message further
        }

        // Handle the message like normal stream messages only if we have a real request
        if (this.currentStreamingRequest) {
            this.handleStreamMessage(message);
        }
        
        // Handle result messages
        if (message.type === 'result') {
            if (this.currentStreamingRequest) {
                // Store session ID for future requests
                if (message.session_id) {
                    this.currentSessionId = message.session_id;
                    console.log(`Stored session ID from streaming process: ${this.currentSessionId}`);
                }
                
                // Send final metadata
                if (message.total_cost_usd) {
                    this.sendToRenderer(`\n💰 Cost: $${message.total_cost_usd.toFixed(4)} | Duration: ${message.duration_ms}ms | Turns: ${message.num_turns}\n`);
                }
                
                // Resolve the current request
                this.currentStreamingRequest.resolve(message);
                this.currentStreamingRequest = null;
                
                // Process next request in queue
                this.processNextStreamingRequest();
            }
        }
    }

    // Send message to streaming process using official streaming JSON input format
    async sendMessageWithStreamingProcess(message) {
        if (!this.streamingProcess || !this.isStreamingProcessReady) {
            throw new Error('Streaming process not ready');
        }

        return new Promise((resolve, reject) => {
            const request = {
                message,
                resolve,
                reject,
                timestamp: Date.now()
            };

            // Add to queue
            this.streamingProcessQueue.push(request);
            
            // Process if not currently processing
            if (!this.currentStreamingRequest) {
                this.processNextStreamingRequest();
            }
        });
    }

    // Process the next request in the queue
    processNextStreamingRequest() {
        if (this.streamingProcessQueue.length === 0 || this.currentStreamingRequest) {
            return;
        }

        this.currentStreamingRequest = this.streamingProcessQueue.shift();
        
        try {
            // Send the message using official streaming JSON input format
            const userMessage = {
                type: 'user',
                message: {
                    role: 'user',
                    content: [
                        {
                            type: 'text',
                            text: this.currentStreamingRequest.message
                        }
                    ]
                }
            };
            
            const inputData = JSON.stringify(userMessage) + '\n';
            this.streamingProcess.stdin.write(inputData);
            
            console.log(`Sent message to streaming process: ${this.currentStreamingRequest.message}`);
            
            // Set timeout for the request
            setTimeout(() => {
                if (this.currentStreamingRequest) {
                    this.currentStreamingRequest.reject(new Error('Request timeout'));
                    this.currentStreamingRequest = null;
                    this.processNextStreamingRequest();
                }
            }, 120000); // 2 minute timeout
            
        } catch (error) {
            console.error('Error sending message to streaming process:', error);
            this.currentStreamingRequest.reject(error);
            this.currentStreamingRequest = null;
            this.processNextStreamingRequest();
        }
    }

    // Handle streaming process errors
    handleStreamingProcessError(error) {
        console.error('Streaming process error:', error);
        this.cleanupStreamingProcess();
        
        // Reject current request
        if (this.currentStreamingRequest) {
            this.currentStreamingRequest.reject(error);
            this.currentStreamingRequest = null;
        }
        
        // Reject all queued requests
        this.streamingProcessQueue.forEach(request => {
            request.reject(new Error('Streaming process failed'));
        });
        this.streamingProcessQueue = [];
        
        // Try to restart after a delay
        setTimeout(() => {
            this.startStreamingProcess();
        }, 5000);
    }

    // Handle streaming process close
    handleStreamingProcessClose(code) {
        console.log(`Streaming process closed with code: ${code}`);
        this.cleanupStreamingProcess();
        
        // Only restart if it wasn't intentionally stopped
        if (code !== 0) {
            setTimeout(() => {
                this.startStreamingProcess();
            }, 5000);
        }
    }

    // Clean up streaming process state
    cleanupStreamingProcess() {
        this.streamingProcess = null;
        this.isStreamingProcessReady = false;
        this.streamingProcessInitialized = false;
        this.streamingProcessBuffer = '';
    }

    // Stop streaming process
    stopStreamingProcess() {
        if (this.streamingProcess) {
            console.log('Stopping streaming Claude process...');
            this.streamingProcess.kill('SIGTERM');
            this.cleanupStreamingProcess();
        }
    }

    // Main sendMessage method - uses optimized shell command with --continue
    async sendMessage(message) {
        return this.sendMessageWithStreamingProcess(message);  // single path
    }

    // Method to get current implementation info
    getImplementationInfo() {
        const info = {
            currentImplementation: 'Streaming Process',
            canToggle: false,
            useStreamingProcess: this.useStreamingProcess,
            streamingProcessReady: this.isStreamingProcessReady,
            explanation: {
                streamingProcess: 'Uses Claude Code\'s official streaming JSON input for instant responses. Eliminates 20+ second warm-up times on slower devices.'
            },
            recommendation: 'Single streaming process worker for optimal performance and session continuity.'
        };
        return info;
    }

    handleStreamMessage(message) {
        console.log(`Stream message type: ${message.type}, subtype: ${message.subtype || 'N/A'}`);
        
        switch (message.type) {
            case 'system':
                if (message.subtype === 'init') {
                    console.log(`Claude session initialized with model: ${message.model}`);
                }
                break;
                
            case 'user':
                // User message - already displayed when we sent it
                break;
                
            case 'assistant':
                const delta = message.message?.delta;
                if (delta?.type === 'text_delta' && delta.text) {
                    this.sendToRenderer(delta.text);           // live tokens
                } else {
                    const full = message.message?.content?.[0];
                    if (full?.type === 'text' && full.text) {
                        this.sendToRenderer(full.text);        // fallback
                    } else if (full?.type === 'tool_use') {
                        this.sendToRenderer(`\n🔧 Using tool: ${full.name}\n`);
                    }
                }
                break;
                
            case 'result':
                if (message.is_error) {
                    this.sendToRenderer(`\n❌ Error: ${message.error || 'Unknown error'}\n`);
                }
                break;
                
            default:
                console.log(`Unhandled stream message type: ${message.type}`);
        }
    }

    resetSession() {
        console.log('Resetting Claude session');
        this.currentSessionId = null;
        this.hasHadConversation = false;
        
        // Cancel any ongoing SDK request
        if (this.abortController) {
            this.abortController.abort();
            this.abortController = null;
        }
        
        // Clear streaming process queues and restart
        this.streamingProcessQueue = [];
        this.currentStreamingRequest = null;
        
        // Restart streaming process to clear session state
        this.stopStreamingProcess();
        setTimeout(() => {
            this.startStreamingProcess();
        }, 1000);
    }

    // Send response to renderer if mainWindow is available
    sendToRenderer(message) {
        if (this.mainWindow && this.mainWindow.webContents) {
            this.mainWindow.webContents.send('claude-response', message);
        }
    }

    async handleFileError(filePath, errorMessage) {
        if (!this.hasActiveSession()) {
            console.log('Claude session not active, not sending compilation error report.');
            this.sendToRenderer(`\n[System] SuperCollider compilation failed for ${filePath}. Start a Claude session to get automated help.\n`);
            return;
        }

        const cleanedErrorMessage = errorMessage
            .split('\n')
            .filter(line => !line.includes('-> nil') && !line.includes('sc3>'))
            .join('\n')
            .trim();

        const prompt = `${cleanedErrorMessage}`;
        
        await this.handleMessage(prompt, '[System]');
    }

    async handleMessage(message, sender = 'You') {
        try {
            this.sendToRenderer(`\n${sender}: ${message}\n`);
            this.sendToRenderer('\nClaude: ');
            
            const response = await this.sendMessage(message);
            
            // Final newline after streaming is complete
            this.sendToRenderer('\n');
            
        } catch (error) {
            console.error('Error sending message to Claude:', error);
            this.sendToRenderer(`\n❌ Error: ${error.message}\n`);
        }
    }

    handleSessionReset() {
        this.resetSession();
        this.sendToRenderer('\n🔄 Session reset\n');
    }

    // Cleanup method to be called when app shuts down
    cleanup() {
        console.log('Cleaning up Claude Manager...');
        
        // Stop streaming process
        if (this.streamingProcess) {
            this.stopStreamingProcess();
        }
        
        // Cancel any ongoing SDK request
        if (this.abortController) {
            this.abortController.abort();
            this.abortController = null;
        }
        
        // Clear queues
        this.streamingProcessQueue = [];
        this.currentStreamingRequest = null;
    }
}

module.exports = ClaudeManager;