# Claude Code Integration for Bice-Box Guitar Pedal

## Overview

This document outlines the architecture for integrating Claude Code as an AI assistant within the bice-box guitar pedal. Users will be able to speak voice commands to create new effects, modify existing ones, save presets, and manage the effects repository.

## Architecture

### High-Level Flow

```
User Voice → Whisper → Text → Spawn Claude Code → MCP Tools → App State Changes → TTS Feedback
```

1. **User initiates AI session**: Voice activation or button press
2. **Electron spawns Claude Code subprocess** for the session
3. **Claude Code connects to MCP server** and waits for commands
4. **User speaks**: "Create a warm vintage delay"
5. **Whisper transcribes** and sends text to Claude Code via MCP
6. **Claude Code creates effects** (writes files directly) and uses MCP tools to validate/control app
7. **Electron app executes tools** and returns results to Claude Code  
8. **Claude Code sends text feedback**: "I've created your vintage delay effect"
9. **User continues**: "Now make it more spacious" → Loop back to step 6
10. **Session ends**: User says "that's all" or timeout → Claude Code exits

### Process Architecture

```
┌─────────────────────┐    Voice Input    ┌─────────────────────┐
│                     │ ────────────────→ │                     │
│      User           │                   │   Electron App      │
│   (Guitarist)       │ ←──────────────── │   (Guitar Pedal)    │
│                     │   Audio Feedback  │                     │
└─────────────────────┘                   └─────────────────────┘
                                                    │
                                                    │ spawn
                                                    ▼
                                          ┌─────────────────────┐
                                          │                     │
                                          │   Claude Code       │
                                          │   (subprocess)      │
                                          │                     │
                                          └─────────────────────┘
                                                    │
                                                    │ MCP Protocol
                                                    ▼
                                          ┌─────────────────────┐
                                          │                     │
                                          │   MCP Server        │
                                          │ (within Electron)   │
                                          │                     │
                                          └─────────────────────┘
```

## Implementation Components

### 1. Voice Recognition (Whisper)

- **Integration**: OpenAI Whisper API called from the Electron app
- **Trigger**: Push-to-talk button or voice activation
- **Output**: Transcribed text sent to Claude Code spawner

### 2. Claude Code Subprocess Spawning

**Location**: `electron/main.js`

```javascript
let activeClaudeProcess = null;

function startClaudeSession() {
  if (activeClaudeProcess) {
    console.log('Claude session already active');
    return activeClaudeProcess;
  }

  activeClaudeProcess = spawn('claude-code', [
    '--prompt', `You are an AI assistant for a guitar effects pedal called bice-box. Connect to the MCP server at localhost:8080 to interact with the app. Stay connected and handle multiple user requests until the session ends. You have full access to the effects repository for creating/modifying effects.`,
    '--mcp-server', 'localhost:8080',
    '--session-mode' // Keep running until explicitly ended
  ], {
    cwd: getEffectsRepoPath(), // Start in bice-box-effects directory
    stdio: ['inherit', 'pipe', 'pipe']
  });

  activeClaudeProcess.stdout.on('data', (data) => {
    console.log(`Claude: ${data}`);
    mainWindow.webContents.send('claude-response', data.toString());
  });

  activeClaudeProcess.on('close', (code) => {
    console.log(`Claude session ended with code ${code}`);
    activeClaudeProcess = null;
    mainWindow.webContents.send('claude-session-ended', { code, success: code === 0 });
  });

  return activeClaudeProcess;
}

function endClaudeSession() {
  if (activeClaudeProcess) {
    activeClaudeProcess.kill('SIGTERM');
    activeClaudeProcess = null;
  }
}

function sendToClaudeSession(message) {
  if (activeClaudeProcess) {
    // Send message to Claude via MCP
    // This would be handled by the MCP server routing
    return true;
  }
  return false;
}
```

### 3. MCP Server

**Integration**: Embedded within the Electron main process

#### Tools Exposed to Claude Code

| Tool | Purpose | Parameters | Returns |
|------|---------|------------|---------|
| `load_effect` | Switch app to specific effect | `{name: string}` | `{success: boolean, error?: string}` |
| `validate_sc_code` | Compile SuperCollider code | `{code: string, tempFileName?: string}` | `{success: boolean, error?: string, output?: string}` |
| `save_preset` | Save current parameters as preset | `{name: string, params: object}` | `{success: boolean, filePath?: string}` |
| `set_parameters` | Update effect parameters | `{params: {[key: string]: number}}` | `{success: boolean}` |
| `reload_effects_list` | Refresh effects after file changes | `{}` | `{effects: string[]}` |

#### Resources Exposed to Claude Code

| Resource | Purpose | Data Format |
|----------|---------|-------------|
| `app://current_state` | Current effect, parameters, sources | `{audioSource: string, visualSource: string, parameters: object, devMode: boolean}` |
| `app://effects_list` | Available effects from synths array | `{effects: [{name: string, scFilePath: string}]}` |
| `app://compilation_errors` | Recent SuperCollider errors | `{errors: [{file: string, error: string, timestamp: Date}]}` |
| `app://app_health` | System status | `{scReady: boolean, oscConnected: boolean, errors: string[]}` |

### 4. Text Feedback via UI

- **Integration**: Text popups/notifications in the Electron app UI
- **Triggers**: 
  - Task completion: "I've created your vintage delay effect"
  - Errors: "I encountered an error while creating the effect"  
  - Progress updates: "Compiling your new effect..."

## Usage Examples

### Multi-Turn Conversation Session

**User**: *[Activates AI session]* "Hey, I need help with some effects"

**Claude**: "I'm ready to help you with your guitar effects. What would you like to create or modify?"

**User**: "Create a lush reverb effect"

**Claude Code Process**:
1. Connect to MCP server
2. Read current audio effect instructions via filesystem
3. Generate SuperCollider code for lush reverb
4. Call `validate_sc_code` tool
5. If errors, fix and retry
6. Write file directly to `bice-box-effects/audio/lush_reverb.sc` 
7. Call `reload_effects_list` tool
8. Call `load_effect` with new effect name
9. Wait for next user command (stay running)

**User Feedback**: "I've created a lush reverb effect and loaded it for you. What would you like to do next?"

### Modifying Parameters

**User**: "Make the delay more spacious"

**Claude Code Process**:
1. Call `app://current_state` resource to see current effect
2. Analyze current parameters
3. Call `set_parameters` with adjusted values (e.g., increase feedback, room size)
4. Wait for next user command

**User Feedback**: "I've made the delay more spacious. Try it out!"

### Saving a Preset

**User**: "Save this as my lead tone"

**Claude Code Process**:
1. Call `app://current_state` resource to get current parameters
2. Call `save_preset` tool with name "lead_tone"
3. Wait for next user command

**User Feedback**: "I've saved your current settings as 'lead tone'. What else can I help you with?"

**User**: "That's all for now, thanks!"

**Claude**: "You're welcome! I'll end our session now. Just activate me again when you need help with effects."

*[Claude Code process exits]*

## Implementation Considerations

### Error Handling

- **Compilation Errors**: Automatically fed back to Claude Code for self-correction
- **Network Issues**: Graceful fallback when Claude API unavailable
- **Subprocess Timeouts**: Kill Claude Code if it runs too long
- **Invalid Commands**: Clear error messages via UI popups

### Performance

- **Session Management**: Keep Claude Code running during user session to avoid startup overhead
- **Memory Usage**: Single Claude Code process per session, exits when session ends
- **Concurrent Commands**: Queue voice commands within active session
- **Session Timeouts**: Auto-end sessions after inactivity to free resources

### Security

- **File System**: Claude Code has filesystem access to effects repository only
- **Network**: Only allow MCP connection to localhost
- **Git Operations**: Claude Code can run git directly (has repo access)

### User Experience

- **Visual Feedback**: Show Claude Code progress on pedal display
- **Text Feedback**: UI popups/notifications with clear messaging
- **Interruption**: Allow user to cancel Claude Code operations
- **Status**: Clear indication when Claude Code is working

## File Structure Changes

```
bice-box/
├── claude-code-implementation.md     # This file
├── electron/
│   ├── main.js                      # Add MCP server + Claude Code spawning
│   ├── mcpServer.js                 # New: MCP server implementation
│   └── claudeSpawner.js             # New: Claude Code subprocess management
├── src/
│   ├── VoiceInterface.js            # New: Whisper integration + TTS
│   └── App.js                       # Add voice UI components
└── package.json                     # Add MCP dependencies
```

## Next Steps

1. **Install MCP dependencies** in package.json
2. **Implement MCP server** in electron/mcpServer.js
3. **Add Claude Code spawning** logic to main.js
4. **Integrate Whisper** for voice recognition
6. **Create voice UI** components
7. **Test end-to-end** workflow
8. **Add error handling** and edge cases
9. **Optimize performance** and user experience