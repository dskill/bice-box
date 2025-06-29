const express = require('express');
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const z = require('zod');

const PORT = 31337;
let httpServerInstance = null;

function createMcpServer(getState) {
    console.log('--- [MCP] Creating McpServer instance ---');
    const {
        getCurrentEffect,
        getSynths,
        getAvailableVisualizers,
        fs,
        path,
    } = getState;

    const server = new McpServer({
        name: 'bice-box-tools',
        version: '0.1.0'
    });

    console.log('[MCP] Server instance created, registering tools...');

    // Register tools using the correct registerTool API with Zod schemas
    server.registerTool(
        'test_simple',
        {
            title: 'Simple Test Tool',
            description: 'A simple test tool that returns a hardcoded string.',
            inputSchema: {}
        },
        async () => {
            console.log('[MCP] test_simple tool called');
            return {
                content: [{ type: 'text', text: 'Hello from test tool!' }]
            };
        }
    );

    server.registerTool(
        'get_current_effect',
        {
            title: 'Get Current Effect',
            description: 'Get the currently active audio/visual effect, including its parameters.',
            inputSchema: {}
        },
        async () => {
            const effect = getCurrentEffect();
            return {
                content: [{ type: 'text', text: JSON.stringify(effect, null, 2) }]
            };
        }
    );

    server.registerTool(
        'list_effects',
        {
            title: 'List Effects',
            description: 'List all available effect presets.',
            inputSchema: {}
        },
        async () => {
            try {
                console.log('[MCP] list_effects tool called');
                console.log('[MCP] getSynths type:', typeof getSynths);
                console.log('[MCP] getSynths:', getSynths);
                
                const synthsArray = getSynths();
                console.log('[MCP] synthsArray type:', typeof synthsArray);
                console.log('[MCP] synthsArray:', synthsArray);
                console.log('[MCP] synthsArray is Array:', Array.isArray(synthsArray));
                
                if (!synthsArray || !Array.isArray(synthsArray)) {
                    return {
                        content: [{ type: 'text', text: 'Effects list not yet loaded. Please try again in a moment.' }]
                    };
                }
                
                console.log('[MCP] About to call map on synthsArray');
                const effectNames = synthsArray.map(s => {
                    console.log('[MCP] Processing synth:', s);
                    return s.name;
                });
                console.log('[MCP] effectNames:', effectNames);
                
                return {
                    content: [{ type: 'text', text: JSON.stringify(effectNames, null, 2) }]
                };
            } catch (error) {
                console.error('[MCP] Error in list_effects:', error);
                console.error('[MCP] Error stack:', error.stack);
                return {
                    content: [{ type: 'text', text: `Error listing effects: ${error.message}` }],
                    isError: true
                };
            }
        }
    );

    server.registerTool(
        'list_visualizers',
        {
            title: 'List Visualizers',
            description: 'List all available standalone visualizers (p5.js sketches and GLSL shaders).',
            inputSchema: {}
        },
        async () => {
            const visualizers = getAvailableVisualizers();
            return {
                content: [{ type: 'text', text: JSON.stringify(visualizers, null, 2) }]
            };
        }
    );
    
    server.registerTool(
        'read_effect_file',
        {
            title: 'Read Effect File',
            description: 'Reads the content of a file from the bice-box-effects repository.',
            inputSchema: {
                filePath: z.string().describe('Relative path to the file within the bice-box-effects directory.')
            }
        },
        async ({ filePath }) => {
            try {
                const effectsRepoPath = path.join(process.env.HOME, 'bice-box-effects');
                const fullPath = path.resolve(effectsRepoPath, filePath);
                if (!fullPath.startsWith(effectsRepoPath)) {
                    throw new Error('Access denied: File path is outside the allowed directory.');
                }
                if (!fs.existsSync(fullPath)) {
                    return { 
                        content: [{ type: 'text', text: `Error: File not found at ${fullPath}` }], 
                        isError: true 
                    };
                }
                const fileContent = fs.readFileSync(fullPath, 'utf-8');
                return { content: [{ type: 'text', text: fileContent }] };
            } catch (error) {
                return { 
                    content: [{ type: 'text', text: `Error reading file: ${error.message}` }], 
                    isError: true 
                };
            }
        }
    );

    console.log('[MCP] Tools registered successfully.');
    return server;
}

function startHttpServer(getState) {
    if (httpServerInstance) {
        console.log('HTTP server is already running.');
        return;
    }

    const app = express();
    app.use(express.json());

    // This stateless approach is from the official MCP SDK documentation.
    // It creates a new server and transport for each request to ensure isolation.
    app.post('/mcp', async (req, res) => {
        console.log(`--- [MCP] Received POST request on /mcp ---`);
        console.log('[MCP] Request Body:', req.body);
        try {
            const server = createMcpServer(getState);
            const transport = new StreamableHTTPServerTransport({
                sessionIdGenerator: undefined,
            });
            
            // Clean up when the client disconnects
            res.on('close', () => {
                transport.close();
                server.close();
            });

            await server.connect(transport);
            await transport.handleRequest(req, res, req.body);
            console.log('[MCP] Request handled successfully.');
        } catch (error) {
            console.error('Error handling MCP POST request:', error);
            if (!res.headersSent) {
                res.status(500).json({
                    jsonrpc: '2.0',
                    error: { code: -32603, message: 'Internal server error' },
                    id: null,
                });
            }
        }
    });

    // Per documentation, GET and DELETE are not supported in stateless mode.
    const methodNotAllowedHandler = (req, res) => {
        res.status(405).json({
            jsonrpc: '2.0',
            error: { code: -32000, message: 'Method not allowed in stateless mode.' },
            id: null
        });
    };

    app.get('/mcp', methodNotAllowedHandler);
    app.delete('/mcp', methodNotAllowedHandler);

    httpServerInstance = app.listen(PORT, '127.0.0.1', () => {
        console.log(`Bice Box HTTP server listening on http://127.0.0.1:${PORT}`);
        console.log(`MCP endpoint available at http://127.0.0.1:${PORT}/mcp`);
    }).on('error', (error) => {
        console.error('Error starting HTTP server:', error);
        httpServerInstance = null;
    });
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