#!/usr/bin/env node

// Test script to verify Claude CLI fixes work with just 'claude' command
const { spawn } = require('child_process');

async function testClaudeWithJustCommand() {
    console.log('=== Testing Claude CLI with just "claude" command ===');
    console.log('ANTHROPIC_API_KEY present:', !!process.env.ANTHROPIC_API_KEY);
    
    // Try just 'claude' instead of full path
    const claudeCommand = 'claude';

    // Create clean environment (keeping all other fixes)
    const cleanEnv = {
        ...process.env,
        ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
        NODE_OPTIONS: ''
    };

    const args = ['-p', 'hello', '--output-format', 'json'];

    console.log(`\nTesting: ${claudeCommand} ${args.join(' ')}`);

    const testProcess = spawn(claudeCommand, args, {
        stdio: ['ignore', 'pipe', 'pipe'], // Keep the stdio fix
        cwd: process.cwd(),
        env: cleanEnv, // Keep the clean env fix
        shell: '/bin/zsh' // Keep the explicit shell fix
    });

    let stdout = '';
    let stderr = '';

    testProcess.stdout.on('data', (data) => {
        const chunk = data.toString();
        console.log('stdout:', chunk);
        stdout += chunk;
    });

    testProcess.stderr.on('data', (data) => {
        const chunk = data.toString();
        console.log('stderr:', chunk);
        stderr += chunk;
    });

    testProcess.on('close', (code) => {
        console.log(`\nProcess closed with code: ${code}`);
        console.log('Full stdout:', stdout);
        console.log('Full stderr:', stderr);
        
        if (code === 0 && stdout) {
            try {
                const response = JSON.parse(stdout);
                console.log('\n✅ SUCCESS! Claude responded with JSON using just "claude" command:', response);
            } catch (parseError) {
                console.log('\n❌ PARSE ERROR:', parseError.message);
                console.log('Raw output:', stdout);
            }
        } else {
            console.log('\n❌ FAILED with exit code:', code);
            console.log('This suggests we need the full path or PATH is not set correctly');
        }
    });

    testProcess.on('error', (error) => {
        console.error('\n❌ SPAWN ERROR:', error);
        console.log('This suggests "claude" command is not found in PATH');
    });

    // Timeout
    setTimeout(() => {
        if (!testProcess.killed) {
            console.log('\n⏰ TIMEOUT - killing process');
            testProcess.kill('SIGTERM');
        }
    }, 30000);
}

async function testClaudeStreaming() {
    console.log('\n=== Testing Claude CLI with streaming support ===');
    console.log('ANTHROPIC_API_KEY present:', !!process.env.ANTHROPIC_API_KEY);
    
    const claudeCommand = 'claude';

    // Create clean environment
    const cleanEnv = {
        ...process.env,
        ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
        NODE_OPTIONS: ''
    };

    const args = ['-p', 'Write a simple hello world function in JavaScript', '--output-format', 'stream-json', '--verbose'];

    console.log(`\nTesting streaming: ${claudeCommand} ${args.join(' ')}`);

    const testProcess = spawn(claudeCommand, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        cwd: process.cwd(),
        env: cleanEnv,
        shell: '/bin/zsh'
    });

    let buffer = '';
    let messageCount = 0;
    let initMessage = null;
    let resultMessage = null;

    testProcess.stdout.on('data', (data) => {
        buffer += data.toString();
        
        // Process complete JSON lines
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // Keep incomplete line in buffer
        
        for (const line of lines) {
            if (line.trim()) {
                try {
                    const message = JSON.parse(line);
                    messageCount++;
                    
                    console.log(`\n📨 Message ${messageCount} (${message.type}):`, {
                        type: message.type,
                        subtype: message.subtype || 'N/A',
                        session_id: message.session_id
                    });
                    
                    if (message.type === 'system' && message.subtype === 'init') {
                        initMessage = message;
                        console.log('   🚀 Init - Model:', message.model, 'Tools:', message.tools?.length || 0);
                    } else if (message.type === 'user') {
                        console.log('   👤 User message content length:', message.message?.content?.[0]?.text?.length || 0);
                    } else if (message.type === 'assistant') {
                        const content = message.message?.content?.[0];
                        if (content?.type === 'text') {
                            console.log('   🤖 Assistant text length:', content.text?.length || 0);
                            console.log('   📝 Preview:', content.text?.substring(0, 100) + '...');
                        } else if (content?.type === 'tool_use') {
                            console.log('   🔧 Tool use:', content.name);
                        }
                    } else if (message.type === 'result') {
                        resultMessage = message;
                        console.log('   ✅ Result:', {
                            subtype: message.subtype,
                            duration_ms: message.duration_ms,
                            num_turns: message.num_turns,
                            total_cost_usd: message.total_cost_usd,
                            is_error: message.is_error
                        });
                    }
                } catch (parseError) {
                    console.log('   ❌ Failed to parse JSON line:', line.substring(0, 100));
                }
            }
        }
    });

    testProcess.stderr.on('data', (data) => {
        const chunk = data.toString();
        console.log('stderr:', chunk);
    });

    testProcess.on('close', (code) => {
        console.log(`\n🏁 Streaming test completed with code: ${code}`);
        console.log(`📊 Total messages received: ${messageCount}`);
        
        if (code === 0) {
            console.log('\n✅ STREAMING SUCCESS!');
            if (initMessage) {
                console.log('   - Received init message with session:', initMessage.session_id);
            }
            if (resultMessage) {
                console.log('   - Received result message:', resultMessage.subtype);
                console.log('   - Total cost: $' + (resultMessage.total_cost_usd || 0));
                console.log('   - Duration: ' + (resultMessage.duration_ms || 0) + 'ms');
            }
        } else {
            console.log('\n❌ STREAMING FAILED with exit code:', code);
        }
    });

    testProcess.on('error', (error) => {
        console.error('\n❌ STREAMING SPAWN ERROR:', error);
    });

    // Timeout for streaming test (longer since it's more complex)
    setTimeout(() => {
        if (!testProcess.killed) {
            console.log('\n⏰ STREAMING TIMEOUT - killing process');
            testProcess.kill('SIGTERM');
        }
    }, 60000);
}

// Run both tests
async function runAllTests() {
    try {
        await testClaudeWithJustCommand();
        
        // Wait a bit between tests
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        await testClaudeStreaming();
    } catch (error) {
        console.error('Test error:', error);
    }
}

runAllTests(); 