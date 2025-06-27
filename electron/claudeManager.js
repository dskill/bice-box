const { spawn } = require('child_process');
const path = require('path');

class ClaudeManager {
    constructor(effectsRepoPath) {
        this.effectsRepoPath = effectsRepoPath;
        this.currentSessionId = null;
        this.mainWindow = null;
    }

    setMainWindow(mainWindow) {
        this.mainWindow = mainWindow;
    }

    hasActiveSession() {
        return !!this.currentSessionId;
    }

    async sendMessage(message) {
        console.log(`Sending message to Claude SDK: ${message}`);
        
        const claudeCommand = 'claude';
        
        // Escape for POSIX shells by replacing every ' with '\'' and wrapping in ''
        const escapedMessage = `'${message.replace(/'/g, "'\\''")}'`;

        const commandParts = [
            claudeCommand,
            '-p',
            escapedMessage,
            '--output-format',
            'stream-json',
            '--verbose'
        ];

        if (this.currentSessionId) {
            commandParts.push('--resume', this.currentSessionId);
        }

        const fullCommand = commandParts.join(' ');

        console.log(`Executing: ${fullCommand}`);
        console.log(`Working directory: ${this.effectsRepoPath}`);
        
        const homeDir = process.env.HOME;
        const nvmBinPath = process.env.NVM_BIN;

        const extendedPath = [
            process.env.PATH,
            nvmBinPath, // Add NVM's binary path if available
            homeDir ? path.join(homeDir, '.local', 'bin') : null,
            '/usr/local/bin',
        ].filter(Boolean).join(path.delimiter);

        // Create clean environment with explicit values
        const cleanEnv = {
            ...process.env,
            PATH: extendedPath,
            ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
            NODE_OPTIONS: ''
        };

        return new Promise((resolve, reject) => {
            const claudeProcess = spawn(fullCommand, [], {
                stdio: ['ignore', 'pipe', 'pipe'],
                cwd: this.effectsRepoPath,
                env: cleanEnv,
                shell: true
            });

            let buffer = '';
            let stderr = '';
            let resultMessage = null;
            let hasError = false;

            // 2 minute timeout for complex requests
            const timeout = setTimeout(() => {
                if (!claudeProcess.killed) {
                    console.log('Claude process timeout, killing...');
                    claudeProcess.kill('SIGTERM');
                    reject(new Error('Claude process timed out after 120 seconds'));
                }
            }, 120000);

            claudeProcess.stdout.on('data', (data) => {
                buffer += data.toString();
                
                // Process complete JSON lines
                const lines = buffer.split('\n');
                buffer = lines.pop() || ''; // Keep incomplete line in buffer
                
                for (const line of lines) {
                    if (line.trim()) {
                        try {
                            const message = JSON.parse(line);
                            this.handleStreamMessage(message);
                            
                            // Store result message for final processing
                            if (message.type === 'result') {
                                resultMessage = message;
                            }
                        } catch (parseError) {
                            console.warn('Failed to parse JSON line:', line.substring(0, 100));
                        }
                    }
                }
            });
            
            claudeProcess.stderr.on('data', (data) => {
                const chunk = data.toString();
                console.log(`Claude stderr chunk: ${chunk}`);
                stderr += chunk;
            });
            
            claudeProcess.on('close', (code) => {
                clearTimeout(timeout);
                console.log(`Claude process closed with code: ${code}`);
                console.log(`Full stderr: ${stderr}`);
                
                if (code === 0 && resultMessage) {
                    // Store the session ID for future requests
                    if (resultMessage.session_id) {
                        this.currentSessionId = resultMessage.session_id;
                        console.log(`Stored session ID: ${this.currentSessionId}`);
                    }
                    
                    // Send final metadata
                    if (resultMessage.total_cost_usd) {
                        this.sendToRenderer(`\n💰 Cost: $${resultMessage.total_cost_usd.toFixed(4)} | Duration: ${resultMessage.duration_ms}ms | Turns: ${resultMessage.num_turns}\n`);
                    }
                    
                    resolve(resultMessage);
                } else {
                    console.error(`Claude process failed with code ${code}`);
                    console.error('stderr:', stderr);
                    reject(new Error(`Claude failed with code ${code}: ${stderr}`));
                }
            });
            
            claudeProcess.on('error', (error) => {
                console.error('Failed to spawn Claude process:', error);
                reject(error);
            });
        });
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
                const content = message.message?.content?.[0];
                if (content?.type === 'text' && content.text) {
                    // Stream the assistant's text response in real-time
                    this.sendToRenderer(content.text);
                } else if (content?.type === 'tool_use') {
                    this.sendToRenderer(`\n🔧 Using tool: ${content.name}\n`);
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
}

module.exports = ClaudeManager;