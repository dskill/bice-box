const express = require('express');
const { WebSocketServer } = require('ws');
const path = require('path');
const fs = require('fs');

const PORT = 31337;
let httpServerInstance = null;
let wss = null;

// Simple MCP server without SDK transport complexity
function startHttpServer(getState) {
    if (httpServerInstance) {
        console.log('HTTP server is already running.');
        return;
    }

    const app = express();
    app.use(express.json());
    
    // Add CORS headers for MCP requests
    app.use('/mcp', (req, res, next) => {
        res.header('Access-Control-Allow-Origin', '*');
        res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
        if (req.method === 'OPTIONS') {
            res.status(200).end();
            return;
        }
        next();
    });

    // Serve static files for the remote visualizer client
    // In development, serve from the source public directory
    // In production, serve from the build directory or app resources
    let publicPath;
    if (process.env.NODE_ENV === 'development') {
        publicPath = path.join(__dirname, '..', 'public');
    } else {
        // In packaged app, try multiple possible locations
        const possiblePaths = [
            path.join(__dirname, '..', 'public'),  // Standard location
            path.join(__dirname, '..', 'build'),   // Build directory
            path.join(process.resourcesPath, 'public'), // App resources
            path.join(process.resourcesPath, 'app', 'public'), // App resources subfolder
        ];
        
        // Find the first path that exists
        publicPath = possiblePaths.find(p => {
            try {
                fs.accessSync(p);
                return true;
            } catch {
                return false;
            }
        }) || possiblePaths[0]; // Fallback to first path
    }
    
    console.log(`[HTTP Server] Serving static files from: ${publicPath}`);
    app.use(express.static(publicPath));

    // Handle MCP requests
    app.post('/mcp', async (req, res) => {
        console.log(`--- [MCP] Received POST request on /mcp ---`);
        console.log('[MCP] Request Body:', JSON.stringify(req.body, null, 2));
        
        const { jsonrpc, method, params, id } = req.body;
        const isNotification = id === undefined;

        try {
            // Validate JSON-RPC format
            if (jsonrpc !== '2.0') {
                if (isNotification) return res.status(204).send();
                return res.json({
                    jsonrpc: '2.0',
                    error: { code: -32600, message: 'Invalid Request' },
                    id: id
                });
            }

            let result;
            
            switch (method) {
                case 'initialize':
                    result = {
                        protocolVersion: '2024-11-05',
                        capabilities: {
                            tools: {},
                            authentication: {
                                type: 'none'
                            }
                        },
                        serverInfo: {
                            name: 'bice-box-tools',
                            version: '0.1.0'
                        }
                    };
                    break;
                    
                case 'tools/list':
                    console.log('[MCP] tools/list requested');
                    result = {
                        tools: [
                            {
                                name: 'get_current_effect',
                                description: 'Get the currently active audio effect and visualizer, including their parameters.',
                                inputSchema: {
                                    type: 'object',
                                    properties: {}
                                }
                            },
                            {
                                name: 'list_effects',
                                description: 'List all available audio effect presets.',
                                inputSchema: {
                                    type: 'object',
                                    properties: {}
                                }
                            },
                            {
                                name: 'list_visualizers',
                                description: 'List all available standalone visualizers (p5.js sketches and GLSL shaders).',
                                inputSchema: {
                                    type: 'object',
                                    properties: {}
                                }
                            },
                            {
                                name: 'set_current_effect',
                                description: 'Switch to a different audio effect by name.',
                                inputSchema: {
                                    type: 'object',
                                    properties: {
                                        effectName: {
                                            type: 'string',
                                            description: 'Name of the effect to switch to.'
                                        }
                                    },
                                    required: ['effectName']
                                }
                            },
                            {
                                name: 'set_effect_parameters',
                                description: 'Set multiple parameters for the current effect at once. This only affects the live values for the current session. If the user wants to change the default values, you must edit the corresponding .sc file.',
                                inputSchema: {
                                    type: 'object',
                                    properties: {
                                        params: {
                                            type: 'object',
                                            description: 'Object with parameter names as keys and values as numbers.',
                                            additionalProperties: {
                                                type: 'number'
                                            }
                                        }
                                    },
                                    required: ['params']
                                }
                            },
                            {
                                name: 'set_visualizer',
                                description: 'Switch to a different visualizer by name.',
                                inputSchema: {
                                    type: 'object',
                                    properties: {
                                        visualizerName: {
                                            type: 'string',
                                            description: 'Name of the visualizer to switch to.'
                                        }
                                    },
                                    required: ['visualizerName']
                                }
                            },
                            {
                                name: 'create_or_update_audio_effect',
                                description: 'The preferred way to create or update audio effects. Use this instead of writing .sc files directly. Automatically tests compilation and provides detailed error feedback. No permission needed - this is the standard method for creating effects.',
                                inputSchema: {
                                    type: 'object',
                                    properties: {
                                        effectName: {
                                            type: 'string',
                                            description: 'Name of the effect (without .sc extension)'
                                        },
                                        scCode: {
                                            type: 'string',
                                            description: 'SuperCollider code for the effect'
                                        },
                                        makeActive: {
                                            type: 'boolean',
                                            description: 'Whether to make this the active effect after creation (default: false)'
                                        }
                                    },
                                    required: ['effectName', 'scCode']
                                }
                            },
                            {
                                name: 'test_supercollider_code',
                                description: 'Test SuperCollider code compilation without saving any files. Use freely during development to validate syntax before finalizing. No permission needed.',
                                inputSchema: {
                                    type: 'object',
                                    properties: {
                                        scCode: {
                                            type: 'string',
                                            description: 'SuperCollider code to test'
                                        }
                                    },
                                    required: ['scCode']
                                }
                            }
                        ]
                    };
                    break;
                    
                case 'tools/call':
                    console.log(`[MCP] tools/call invoked for tool: ${params.name}`);
                    result = await handleToolCall(params, getState);
                    console.log(`[MCP] tools/call completed for tool: ${params.name}, success: ${!result.isError}`);
                    break;
                
                case 'notifications/initialized':
                    // This is a notification, so we don't send a response
                    console.log('[MCP] Client initialized successfully');
                    if (isNotification) return res.status(204).send();
                    return res.json({
                        jsonrpc: '2.0',
                        result: {},
                        id: id
                    });
                    
                default:
                    if (isNotification) return res.status(204).send();
                    return res.json({
                        jsonrpc: '2.0',
                        error: { code: -32601, message: 'Method not found' },
                        id: id
                    });
            }
            
            if (isNotification) {
                return res.status(204).send();
            }
            
            res.json({
                jsonrpc: '2.0',
                result: result,
                id: id
            });
            
            console.log('[MCP] Request handled successfully.');
        } catch (error) {
            console.error('Error handling MCP POST request:', error);
            if (isNotification) return res.status(204).send();

            res.json({
                jsonrpc: '2.0',
                error: { code: -32603, message: 'Internal server error' },
                id: id
            });
        }
    });

    // GET requests are for establishing a server-sent events (SSE) stream
    app.get('/mcp', (req, res) => {
        console.log(`--- [MCP] Received GET request on /mcp for SSE stream ---`);
        
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
        });
        res.write('\n'); // Initial newline to establish connection

        // Send a heartbeat every 10 seconds to keep the connection alive
        const heartbeatInterval = setInterval(() => {
            res.write(': heartbeat\n\n');
        }, 10000);

        req.on('close', () => {
            console.log('[MCP] SSE client disconnected.');
            clearInterval(heartbeatInterval);
            res.end();
        });
    });

    httpServerInstance = app.listen(PORT, () => {
        console.log(`Bice Box HTTP MCP server listening on port ${PORT}`);
        console.log(`MCP endpoint available at http://127.0.0.1:${PORT}/mcp`);
        console.log(`Remote visualizer available at http://127.0.0.1:${PORT}/remote/`);
    }).on('error', (error) => {
        console.error('Error starting HTTP server:', error);
        httpServerInstance = null;
    });

    // Setup WebSocket server
    wss = new WebSocketServer({ server: httpServerInstance });

    wss.on('connection', (ws) => {
        console.log('[WSS] Client connected');
        
        // Send current shader state to newly connected client
        sendCurrentShaderToClient(ws, getState);
        
        ws.on('close', () => {
            console.log('[WSS] Client disconnected');
        });
        ws.on('error', (error) => {
            console.error('[WSS] WebSocket error:', error);
        });
    });
}

function sendCurrentShaderToClient(ws, getState) {
    const WebSocket = require('ws');
    
    if (ws.readyState !== WebSocket.OPEN) {
        return;
    }
    
    try {
        const { loadVisualizerContent, getActiveVisualSourcePath, getCurrentEffectSnapshot } = getState;
        const currentEffect = getCurrentEffectSnapshot ? getCurrentEffectSnapshot() : null;
        
        // Try to get shader path from current effect first, then from active visual source
        let shaderPath = null;
        if (currentEffect && currentEffect.shaderPath) {
            shaderPath = currentEffect.shaderPath;
        } else if (getActiveVisualSourcePath) {
            const activeVisualPath = getActiveVisualSourcePath();
            if (activeVisualPath && activeVisualPath.includes('shaders/')) {
                shaderPath = activeVisualPath;
            }
        }
        
        if (!shaderPath) {
            console.log('[WSS] No current shader to send to new client');
            return;
        }
        
        console.log(`[WSS] Sending current shader to new client: ${shaderPath}`);
        
        // Load the shader content - pass the function itself, not the result
        const result = loadVisualizerContent(shaderPath, getState.getEffectsRepoPath);
        
        if (result.error) {
            console.error(`[WSS] Error loading shader content for new client: ${result.error}`);
            return;
        }
        
        // Only send if it's actually a shader (not p5.js)
        if (result.type !== 'shader') {
            console.log(`[WSS] Current visualizer is not a shader (${result.type}), not sending to remote client`);
            return;
        }
        
        // Send the shader to the specific client
        const message = {
            type: 'shaderUpdate',
            payload: {
                shaderPath: shaderPath,
                shaderContent: result.content
            }
        };
        
        ws.send(JSON.stringify(message));
        console.log(`[WSS] Sent current shader ${shaderPath} to new client`);
        
    } catch (error) {
        console.error('[WSS] Error sending current shader to new client:', error);
    }
}

function broadcast(message) {
    if (!wss) {
        console.error('[WSS] WebSocket server not initialized.');
        return;
    }

    const messageString = JSON.stringify(message);
    const WebSocket = require('ws');
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(messageString);
        }
    });
}

async function handleToolCall(params, getState) {
    const { name, arguments: args } = params;
    
    const {
        getSynths,
        getAvailableVisualizers,
        getCurrentEffectSnapshot,
        getActiveVisualizerSnapshot
    } = getState;
    
    switch (name) {
        case 'get_current_effect':
            try {
                const effect = getCurrentEffectSnapshot ? getCurrentEffectSnapshot() : null;
                const visualizer = getActiveVisualizerSnapshot ? getActiveVisualizerSnapshot() : null;
                
                // Combine effect and visualizer info
                const result = {
                    effect: effect,
                    visualizer: visualizer ? {
                        name: visualizer.name,
                        type: visualizer.type,
                        path: visualizer.path
                    } : null
                };
                
                return {
                    content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
                };
            } catch (error) {
                console.error('[MCP] Error in get_current_effect:', error);
                return {
                    content: [{ type: 'text', text: `Error getting current effect: ${error.message}` }],
                    isError: true
                };
            }
            
        case 'list_effects':
            try {
                const synthsArray = getSynths();
                if (!synthsArray || !Array.isArray(synthsArray)) {
                    return {
                        content: [{ type: 'text', text: 'Effects list not yet loaded. Please try again in a moment.' }]
                    };
                }
                
                const effectNames = synthsArray.map(s => s.name);
                return {
                    content: [{ type: 'text', text: JSON.stringify(effectNames, null, 2) }]
                };
            } catch (error) {
                console.error('[MCP] Error in list_effects:', error);
                return {
                    content: [{ type: 'text', text: `Error listing effects: ${error.message}` }],
                    isError: true
                };
            }
            
        case 'list_visualizers':
            try {
                const visualizers = getAvailableVisualizers();
                return {
                    content: [{ type: 'text', text: JSON.stringify(visualizers, null, 2) }]
                };
            } catch (error) {
                console.error('[MCP] Error in list_visualizers:', error);
                return {
                    content: [{ type: 'text', text: `Error listing visualizers: ${error.message}` }],
                    isError: true
                };
            }
            
        case 'set_current_effect':
            try {
                const { effectName } = args;
                const { setCurrentEffectAction } = getState;
                if (!setCurrentEffectAction) throw new Error('Unified action setCurrentEffectAction not available');
                const result = setCurrentEffectAction({ name: effectName });
                if (result && result.error) {
                    return { content: [{ type: 'text', text: result.error }], isError: true };
                }
                return {
                    content: [{ type: 'text', text: `Switched to effect: ${effectName}` }]
                };
            } catch (error) {
                console.error('[MCP] Error in set_current_effect:', error);
                return {
                    content: [{ type: 'text', text: `Error setting effect: ${error.message}` }],
                    isError: true
                };
            }
            
        case 'set_effect_parameters':
            try {
                const { params } = args;
                const { setEffectParametersAction } = getState;
                if (!setEffectParametersAction) throw new Error('Unified action setEffectParametersAction not available');
                const result = setEffectParametersAction({ params });
                const responseText = result && (result.invalid && Object.keys(result.invalid).length > 0)
                    ? `Updated parameters. Skipped invalid: ${JSON.stringify(result.invalid)}`
                    : `Updated parameters.`;
                return {
                    content: [{ type: 'text', text: responseText }]
                };
            } catch (error) {
                console.error('[MCP] Error in set_effect_parameters:', error);
                return {
                    content: [{ type: 'text', text: `Error setting parameters: ${error.message}` }],
                    isError: true
                };
            }
            
        case 'set_visualizer':
            try {
                const { visualizerName } = args;
                const { setCurrentVisualizerAction } = getState;
                if (!setCurrentVisualizerAction) throw new Error('Unified action setCurrentVisualizerAction not available');
                const result = setCurrentVisualizerAction({ name: visualizerName });
                if (result && result.error) {
                    return { content: [{ type: 'text', text: result.error }], isError: true };
                }
                return {
                    content: [{ type: 'text', text: `Switched to visualizer: ${visualizerName}` }]
                };
            } catch (error) {
                console.error('[MCP] Error in set_visualizer:', error);
                return {
                    content: [{ type: 'text', text: `Error setting visualizer: ${error.message}` }],
                    isError: true
                };
            }
            
        case 'create_or_update_audio_effect':
            try {
                console.log('[MCP] create_or_update_audio_effect called with:', {
                    effectName: args.effectName,
                    scCodeLength: args.scCode ? args.scCode.length : 0,
                    makeActive: args.makeActive
                });
                
                const { effectName, scCode, makeActive = false } = args;
                const { compileAndSaveEffect } = getState;
                
                if (!compileAndSaveEffect) {
                    console.error('[MCP] compileAndSaveEffect function not found in getState');
                    throw new Error('Effect compilation not available');
                }
                
                console.log('[MCP] Calling compileAndSaveEffect...');
                const result = await compileAndSaveEffect(effectName, scCode);
                console.log('[MCP] compileAndSaveEffect result:', result);
                
                if (result.success) {
                    let response = `Successfully created/updated effect: ${effectName}`;
                    
                    if (makeActive && result.success) {
                        const { setCurrentEffectAction } = getState;
                        if (setCurrentEffectAction) {
                            const switchResult = setCurrentEffectAction({ name: effectName });
                            if (switchResult.error) {
                                response += `\nWarning: Effect saved but could not activate: ${switchResult.error}`;
                            } else {
                                response += `\nEffect is now active`;
                            }
                        } else {
                            response += `\nWarning: Could not make effect active - action not available`;
                        }
                    }
                    
                    return {
                        content: [{ type: 'text', text: response }]
                    };
                } else {
                    return {
                        content: [{ 
                            type: 'text', 
                            text: `Failed to compile effect:\n${result.error}\n\nSuperCollider output:\n${result.scOutput || 'No output'}` 
                        }],
                        isError: true
                    };
                }
            } catch (error) {
                console.error('[MCP] Error in create_or_update_audio_effect:', error);
                return {
                    content: [{ type: 'text', text: `Error creating effect: ${error.message}` }],
                    isError: true
                };
            }
            
        case 'test_supercollider_code':
            try {
                const { scCode } = args;
                const { testSuperColliderCode } = getState;
                if (!testSuperColliderCode) throw new Error('SuperCollider code testing not available');
                
                const result = await testSuperColliderCode(scCode);
                
                if (result.success) {
                    return {
                        content: [{ type: 'text', text: 'SuperCollider code compiled successfully!\n\nNo syntax errors detected.' }]
                    };
                } else {
                    return {
                        content: [{ 
                            type: 'text', 
                            text: `SuperCollider compilation failed:\n${result.error}\n\nFull output:\n${result.output || 'No output'}` 
                        }],
                        isError: true
                    };
                }
            } catch (error) {
                console.error('[MCP] Error in test_supercollider_code:', error);
                return {
                    content: [{ type: 'text', text: `Error testing code: ${error.message}` }],
                    isError: true
                };
            }
            
        default:
            throw new Error(`Unknown tool: ${name}`);
    }
}

function stopHttpServer() {
    if (httpServerInstance) {
        httpServerInstance.close(() => {
            console.log('HTTP server stopped.');
            httpServerInstance = null;
        });
    }
    if (wss) {
        wss.close(() => {
            console.log('WebSocket server stopped.');
            wss = null;
        });
    }
}

module.exports = { startHttpServer, stopHttpServer, broadcast }; 