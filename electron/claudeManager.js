const { spawn } = require('child_process');

class ClaudeManager {
    constructor(effectsRepoPath) {
        this.effectsRepoPath = effectsRepoPath;
        this.currentSessionId = null;
        this.mainWindow = null;
    }

    setMainWindow(mainWindow) {
        this.mainWindow = mainWindow;
    }

    async sendMessage(message) {
        console.log(`Sending message to Claude SDK: ${message}`);
        
        const claudeCommand = 'claude';
        const escapedMessage = message.replace(/"/g, '\\"');
        
        const args = [
            '-p', 
            `"${escapedMessage}"`,
            '--output-format', 
            'json'
        ];

        if (this.currentSessionId) {
            args.push('--resume', this.currentSessionId);
        }

        console.log(`Executing: ${claudeCommand} ${args.join(' ')}`);
        console.log(`Working directory: ${this.effectsRepoPath}`);
        
        // Create clean environment with explicit values
        const cleanEnv = {
            ...process.env,
            ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
            NODE_OPTIONS: ''
        };

        return new Promise((resolve, reject) => {
            const claudeProcess = spawn(claudeCommand, args, {
                stdio: ['ignore', 'pipe', 'pipe'],
                cwd: this.effectsRepoPath,
                env: cleanEnv,
                shell: '/bin/zsh'
            });

            let stdout = '';
            let stderr = '';

            // 2 minute timeout for complex requests
            const timeout = setTimeout(() => {
                if (!claudeProcess.killed) {
                    console.log('Claude process timeout, killing...');
                    claudeProcess.kill('SIGTERM');
                    reject(new Error('Claude process timed out after 120 seconds'));
                }
            }, 120000);

            claudeProcess.stdout.on('data', (data) => {
                const chunk = data.toString();
                console.log(`Claude stdout chunk: ${chunk}`);
                stdout += chunk;
            });
            
            claudeProcess.stderr.on('data', (data) => {
                const chunk = data.toString();
                console.log(`Claude stderr chunk: ${chunk}`);
                stderr += chunk;
            });
            
            claudeProcess.on('close', (code) => {
                clearTimeout(timeout);
                console.log(`Claude process closed with code: ${code}`);
                console.log(`Full stdout: ${stdout}`);
                console.log(`Full stderr: ${stderr}`);
                
                if (code === 0) {
                    try {
                        const response = JSON.parse(stdout);
                        console.log(`Parsed response:`, response);
                        
                        // Store the session ID for future requests
                        if (response.session_id) {
                            this.currentSessionId = response.session_id;
                            console.log(`Stored session ID: ${this.currentSessionId}`);
                        }
                        resolve(response);
                    } catch (error) {
                        console.error('Failed to parse Claude response JSON:', error);
                        console.error('Raw stdout:', stdout);
                        reject(new Error(`Failed to parse response: ${error.message}`));
                    }
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

    async handleMessage(message) {
        try {
            this.sendToRenderer(`\nYou: ${message}\n`);
            this.sendToRenderer('Claude is thinking...\n');
            
            const response = await this.sendMessage(message);
            
            // Send the main response
            this.sendToRenderer(`\nClaude: ${response.result}\n`);
            
            // Send metadata if available
            if (response.cost_usd) {
                this.sendToRenderer(`\n💰 Cost: $${response.cost_usd.toFixed(4)} | Duration: ${response.duration_ms}ms | Turns: ${response.num_turns}\n`);
            }
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