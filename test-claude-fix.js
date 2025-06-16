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

// Run the test
testClaudeWithJustCommand().catch(console.error); 