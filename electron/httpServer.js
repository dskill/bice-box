const express = require('express');
const z = require('zod');

const PORT = 31337;
let httpServerInstance = null;

// Simple MCP server without SDK transport complexity
function startHttpServer(getState) {
    if (httpServerInstance) {
        console.log('HTTP server is already running.');
        return;
    }

    const app = express();
    app.use(express.json());

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
                            tools: {}
                        },
                        serverInfo: {
                            name: 'bice-box-tools',
                            version: '0.1.0'
                        }
                    };
                    break;
                    
                case 'tools/list':
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
                                description: 'Set multiple parameters for the current effect at once.',
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
                            }
                        ]
                    };
                    break;
                    
                case 'tools/call':
                    result = await handleToolCall(params, getState);
                    break;
                    
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
    }).on('error', (error) => {
        console.error('Error starting HTTP server:', error);
        httpServerInstance = null;
    });
}

async function handleToolCall(params, getState) {
    const { name, arguments: args } = params;
    
    const {
        getCurrentEffect,
        getSynths,
        getAvailableVisualizers,
        sendCodeToSclang,
        mainWindow
    } = getState;
    
    switch (name) {
        case 'get_current_effect':
            try {
                const effect = getCurrentEffect();
                return {
                    content: [{ type: 'text', text: JSON.stringify(effect, null, 2) }]
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
                const synthsArray = getSynths();
                const effect = synthsArray.find(s => s.name === effectName);
                
                if (!effect) {
                    return {
                        content: [{ type: 'text', text: `Effect '${effectName}' not found. Available effects: ${synthsArray.map(s => s.name).join(', ')}` }],
                        isError: true
                    };
                }

                console.log(`[MCP] Switching to effect: ${effectName} at path: ${effect.scFilePath}`);
                
                // Load the SC file and set the current effect
                const { loadScFileAndRequestSpecs, setCurrentEffect } = getState;
                if (loadScFileAndRequestSpecs && setCurrentEffect) {
                    await loadScFileAndRequestSpecs(effect.scFilePath);
                    
                    // Update the current effect state
                    setCurrentEffect(effect);
                    console.log(`[MCP] Set current effect to: ${effectName}`);
                    
                    // Notify the React frontend about the effect change
                    if (mainWindow && mainWindow.webContents) {
                        console.log(`[MCP] Notifying frontend about effect change to: ${effectName}`);
                        
                        // First, update the current audio source in the frontend
                        mainWindow.webContents.send('mcp-audio-source-changed', effect.scFilePath);
                        
                        // Then send the effect update
                        mainWindow.webContents.send('effect-updated', effect);
                    }
                } else {
                    console.error('[MCP] loadScFileAndRequestSpecs or setCurrentEffect function not available');
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
                const currentEffect = getCurrentEffect();
                if (!currentEffect) {
                    return {
                        content: [{ type: 'text', text: 'No effect is currently active.' }],
                        isError: true
                    };
                }

                // Send parameter updates to SuperCollider
                for (const [paramName, value] of Object.entries(params)) {
                    if (sendCodeToSclang) {
                        await sendCodeToSclang(`~${currentEffect.name}.set(\\${paramName}, ${value});`);
                    }
                }

                // Update the synths array and notify frontend
                const synthsArray = getSynths();
                const effectIndex = synthsArray.findIndex(s => s.name === currentEffect.name);
                if (effectIndex !== -1) {
                    // Update the params in the synths array
                    Object.assign(synthsArray[effectIndex].params || {}, params);
                    
                    // Notify the React frontend about the parameter changes
                    if (mainWindow && mainWindow.webContents) {
                        console.log(`[MCP] Notifying frontend about parameter changes for: ${currentEffect.name}`);
                        mainWindow.webContents.send('effect-updated', synthsArray[effectIndex]);
                    }
                }
                
                return {
                    content: [{ type: 'text', text: `Updated parameters for ${currentEffect.name}: ${JSON.stringify(params, null, 2)}` }]
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
                const visualizers = getAvailableVisualizers();
                const visualizer = visualizers.find(v => v.name === visualizerName);
                
                if (!visualizer) {
                    return {
                        content: [{ type: 'text', text: `Visualizer '${visualizerName}' not found. Available visualizers: ${visualizers.map(v => v.name).join(', ')}` }],
                        isError: true
                    };
                }

                console.log(`[MCP] Switching to visualizer: ${visualizerName} at path: ${visualizer.path}`);
                
                // Load the visualizer content and send it to the frontend
                try {
                    const { loadVisualizerContent, getEffectsRepoPath, setActiveVisualSourcePath } = getState;
                    if (loadVisualizerContent && getEffectsRepoPath) {
                        const result = loadVisualizerContent(visualizer.path, getEffectsRepoPath());
                        
                        if (result && !result.error) {
                            // Set the backend state
                            if (setActiveVisualSourcePath) {
                                setActiveVisualSourcePath(visualizer.path);
                            }
                            
                            // Send the visualizer data to the frontend using existing IPC patterns
                            if (mainWindow && mainWindow.webContents) {
                                console.log(`[MCP] Sending visualizer content to frontend: ${visualizerName} (type: ${result.type})`);
                                
                                // Use the existing auto-visualizer-loaded message that App.js already handles
                                mainWindow.webContents.send('auto-visualizer-loaded', {
                                    type: result.type,
                                    path: visualizer.path,
                                    content: result.content
                                });
                            }
                        } else {
                            console.error(`[MCP] Error loading visualizer content: ${result.error}`);
                        }
                    } else {
                        console.error('[MCP] loadVisualizerContent or getEffectsRepoPath function not available');
                    }
                } catch (error) {
                    console.error(`[MCP] Error in visualizer switching:`, error);
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
}

module.exports = { startHttpServer, stopHttpServer }; 