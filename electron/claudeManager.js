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
        
        // AbortController for proper cancellation
        this.currentAbortController = null;
        
        // Auto-start streaming process
        this.startStreamingProcess();
    }

    setMainWindow(mainWindow) {
        this.mainWindow = mainWindow;
    }

    hasActiveSession() {
        return this.hasHadConversation;
    }

    // Find Node.js binary in various locations
    async findNodeBinary() {
        const homeDir = process.env.HOME;
        const fs = require('fs');
        const { execSync } = require('child_process');
        
        // Common Node.js installation paths
        const searchPaths = [];
        
        // NVM paths (check multiple versions)
        if (homeDir) {
            const nvmNodeDir = path.join(homeDir, '.nvm/versions/node');
            try {
                if (fs.existsSync(nvmNodeDir)) {
                    const versions = fs.readdirSync(nvmNodeDir);
                    searchPaths.push(...versions.map(version => 
                        path.join(nvmNodeDir, version, 'bin/node')
                    ).filter(nodePath => {
                        try {
                            return fs.existsSync(nodePath);
                        } catch (e) {
                            return false;
                        }
                    }));
                }
            } catch (e) {
                console.log('NVM directory not accessible:', e.message);
            }
        }
        
        // Add standard system paths
        searchPaths.push(
            // Standard system paths
            '/usr/local/bin/node',
            '/usr/bin/node',
            '/opt/homebrew/bin/node'
        );
        
        // PATH-based detection
        if (process.env.PATH) {
            searchPaths.push(...process.env.PATH.split(path.delimiter).map(p => path.join(p, 'node')));
        }

        console.log('Searching for Node.js binary in these locations:', searchPaths);

        // Collect all working Node.js versions first
        const workingNodes = [];
        
        for (const nodePath of searchPaths) {
            try {
                if (fs.existsSync(nodePath)) {
                    // Test if the node binary actually works
                    const version = execSync(`"${nodePath}" --version`, { encoding: 'utf8', timeout: 5000 }).trim();
                    console.log(`Found working Node.js at ${nodePath} (${version})`);
                    
                    // Parse version number for comparison
                    const versionMatch = version.match(/v(\d+)\.(\d+)\.(\d+)/);
                    if (versionMatch) {
                        const [, major, minor, patch] = versionMatch.map(Number);
                        workingNodes.push({
                            path: nodePath,
                            version,
                            major,
                            minor,
                            patch,
                            binDir: path.dirname(nodePath)
                        });
                    }
                }
            } catch (error) {
                console.log(`Node.js at ${nodePath} failed test:`, error.message);
            }
        }
        
        if (workingNodes.length === 0) {
            throw new Error('No working Node.js installations found');
        }
        
        // Sort by version (newest first), prioritizing Node.js 16+ for Claude CLI compatibility
        workingNodes.sort((a, b) => {
            // Prioritize Node 16+ for Claude CLI compatibility
            if (a.major >= 16 && b.major < 16) return -1;
            if (b.major >= 16 && a.major < 16) return 1;
            
            // Then sort by version (newest first)
            if (a.major !== b.major) return b.major - a.major;
            if (a.minor !== b.minor) return b.minor - a.minor;
            return b.patch - a.patch;
        });
        
        const selectedNode = workingNodes[0];
        console.log(`Selected Node.js ${selectedNode.version} from ${selectedNode.path} (prioritizing Node 16+ for Claude CLI)`);
        console.log(`Available versions: ${workingNodes.map(n => n.version).join(', ')}`);
        
        return selectedNode.binDir;
    }

    // Start a streaming claude-code process using official streaming JSON input
    async startStreamingProcess() {
        if (this.streamingProcess) {
            console.log('Streaming Claude process already running');
            return;
        }

        console.log('Starting streaming Claude process with official streaming JSON input...');
        console.log('Current environment variables:');
        console.log('  HOME:', process.env.HOME);
        console.log('  NVM_BIN:', process.env.NVM_BIN);
        console.log('  PATH (first 200 chars):', process.env.PATH?.substring(0, 200));
        
        try {
            // Find Node.js binary first
            const nodeBinPath = await this.findNodeBinary();
            console.log(`Using Node.js from: ${nodeBinPath}`);
            
            const homeDir = process.env.HOME;
            const nvmBinPath = process.env.NVM_BIN || nodeBinPath;
            const claudeCliPath = homeDir ? path.join(homeDir, '.claude', 'local', 'node_modules', '.bin') : null;

            const extendedPath = [
                nodeBinPath, // Add the found Node.js path first
                process.env.PATH,
                nvmBinPath,
                claudeCliPath,
                homeDir ? path.join(homeDir, '.local', 'bin') : null,
                '/usr/local/bin',
            ].filter(Boolean).join(path.delimiter);

            console.log('Extended PATH for Claude process:', extendedPath);

            const cleanEnv = {
                ...process.env,
                PATH: extendedPath,
                ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
                NODE_OPTIONS: '',
                // Ensure NVM variables are set if available
                NVM_BIN: nvmBinPath,
                NVM_PATH: process.env.NVM_PATH,
                NODE_PATH: process.env.NODE_PATH
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
            console.log(`Working directory: ${this.effectsRepoPath}`);
            console.log(`Environment PATH: ${cleanEnv.PATH}`);

            this.streamingProcess = spawn(fullCommand, [], {
                stdio: ['pipe', 'pipe', 'pipe'],
                cwd: this.effectsRepoPath,
                env: cleanEnv,
                shell: true
            });
            
            console.log(`Claude process spawned with PID: ${this.streamingProcess.pid}`);

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
                const errorOutput = data.toString();
                console.log(`Streaming Claude stderr: ${errorOutput}`);
                
                // Also send error output to UI for debugging
                this.sendToRenderer(`\n🔍 Debug - Claude stderr: ${errorOutput}\n`);
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
            this.sendToRenderer('\n🚀 Streaming Claude process started\n');
            
        } catch (error) {
            console.error('Failed to start streaming Claude process:', error);
            this.streamingProcess = null;
            this.isStreamingProcessReady = false;
            this.sendToRenderer(`\n❌ Failed to start Claude process: ${error.message}\n`);
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
                this.currentAbortController = null; // Clear the abort controller
                
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
            // Create an AbortController for this specific request
            const abortController = new AbortController();
            
            const request = {
                message,
                resolve,
                reject,
                timestamp: Date.now(),
                abortController
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
        
        // Set the current abort controller from the request
        this.currentAbortController = this.currentStreamingRequest.abortController;
        
        // Check if the request was already aborted before processing
        if (this.currentAbortController.signal.aborted) {
            console.log('Request was already aborted, skipping...');
            this.currentStreamingRequest.reject(new Error('Request was cancelled before processing'));
            this.currentStreamingRequest = null;
            this.currentAbortController = null;
            this.processNextStreamingRequest();
            return;
        }
        
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
            
            // Include session_id for conversation continuity (if we have one)
            if (this.currentSessionId) {
                userMessage.session_id = this.currentSessionId;
                console.log(`Including session ID for continuity: ${this.currentSessionId}`);
            }
            
            const inputData = JSON.stringify(userMessage) + '\n';
            this.streamingProcess.stdin.write(inputData);
            
            console.log(`Sent message to streaming process: ${this.currentStreamingRequest.message}`);
            
        } catch (error) {
            console.error('Error sending message to streaming process:', error);
            this.currentStreamingRequest.reject(error);
            this.currentStreamingRequest = null;
            this.currentAbortController = null;
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
        
        // Reject all queued requests and clean up their AbortControllers
        this.streamingProcessQueue.forEach(request => {
            request.reject(new Error('Streaming process failed'));
            // Note: AbortControllers will be garbage collected with the request objects
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
        this.currentAbortController = null;
    }

    // Cancel current Claude request using proper AbortController
    async cancelCurrentRequest() {
        console.log('Cancelling current Claude request...');
        
        if (!this.currentAbortController) {
            console.log('No active request to cancel');
            this.sendToRenderer('\n⚠️ No active request to cancel\n');
            return;
        }

        try {
            // Use AbortController to properly cancel the request
            console.log('Aborting current request using AbortController...');
            this.currentAbortController.abort('User cancelled the request');
            
            // Clear the current controller reference
            this.currentAbortController = null;
            
            // Reject the current request
            if (this.currentStreamingRequest) {
                this.currentStreamingRequest.reject(new Error('Request cancelled by user'));
                this.currentStreamingRequest = null;
            }
            
            // Clear the queue of pending requests  
            this.streamingProcessQueue = [];
            
            this.sendToRenderer('\n🛑 Request cancelled\n');
            
            // Process next request in queue if any
            setTimeout(() => {
                this.processNextStreamingRequest();
            }, 100);
            
        } catch (error) {
            console.error('Error during cancellation:', error);
            this.sendToRenderer('\n❌ Error cancelling request\n');
        }
    }



    // Stop streaming process gracefully
    stopStreamingProcess() {
        if (this.streamingProcess) {
            console.log('Stopping streaming Claude process gracefully...');
            
            try {
                // First, try to close stdin gracefully
                if (this.streamingProcess.stdin && !this.streamingProcess.stdin.destroyed) {
                    this.streamingProcess.stdin.end();
                }
                
                // Give the process a moment to finish gracefully
                setTimeout(() => {
                    if (this.streamingProcess && !this.streamingProcess.killed) {
                        console.log('Process still running, sending SIGTERM...');
                        this.streamingProcess.kill('SIGTERM');
                        
                        // Last resort: SIGKILL after timeout
                        setTimeout(() => {
                            if (this.streamingProcess && !this.streamingProcess.killed) {
                                console.log('Process still running, sending SIGKILL...');
                                this.streamingProcess.kill('SIGKILL');
                            }
                        }, 2000);
                    }
                }, 500);
                
            } catch (error) {
                console.error('Error during graceful shutdown:', error);
                // Fallback to SIGTERM if graceful shutdown fails
                if (this.streamingProcess && !this.streamingProcess.killed) {
                    this.streamingProcess.kill('SIGTERM');
                }
            }
            
            this.cleanupStreamingProcess();
        }
    }

    // Main sendMessage method - uses optimized shell command with --continue
    async sendMessage(message) {
        return this.sendMessageWithStreamingProcess(message);  // single path
    }

    handleStreamMessage(message) {
        console.log(`Stream message type: ${message.type}, subtype: ${message.subtype || 'N/A'}`);
        
        // Skip processing if the request was aborted
        if (this.currentAbortController && this.currentAbortController.signal.aborted) {
            console.log('Skipping message processing - request was aborted');
            return;
        }
        
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
        console.log('Resetting Claude session - starting fresh conversation');
        
        // Send reset notification to user
        this.sendToRenderer('\n🔄 Starting new conversation...\n');
        
        // Clear session state
        this.currentSessionId = null;
        this.hasHadConversation = false;
        this.currentAbortController = null;
        
        // Cancel any ongoing SDK request
        if (this.abortController) {
            this.abortController.abort();
            this.abortController = null;
        }
        
        // Clear streaming process queues and restart
        this.streamingProcessQueue = [];
        this.currentStreamingRequest = null;
        
        // Restart streaming process to clear session state (equivalent to /clear in claude-code CLI)
        this.stopStreamingProcess();
        setTimeout(() => {
            this.startStreamingProcess();
            // Notify when ready
            setTimeout(() => {
                this.sendToRenderer('✨ New conversation started! Previous context cleared.\n\n');
            }, 500);
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
            
            await this.sendMessage(message);
            
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
        
        // Cancel current request if any
        if (this.currentAbortController) {
            this.currentAbortController.abort('Application shutting down');
            this.currentAbortController = null;
        }
        
        // Stop streaming process
        if (this.streamingProcess) {
            this.stopStreamingProcess();
        }
        
        // Cancel any ongoing SDK request
        if (this.abortController) {
            this.abortController.abort();
            this.abortController = null;
        }
        
        // Clear queues and abort any pending requests
        this.streamingProcessQueue.forEach(request => {
            if (request.abortController) {
                request.abortController.abort('Application shutting down');
            }
            request.reject(new Error('Application shutting down'));
        });
        this.streamingProcessQueue = [];
        this.currentStreamingRequest = null;
    }
}

module.exports = ClaudeManager;