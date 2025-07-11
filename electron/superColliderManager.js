const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

// Array to store all available synths/effects
let synths = [];
let currentEffect = null;
let sclang;
let serverBooted = false;

function getCurrentEffect() {
    return currentEffect;
}

function setCurrentEffect(effect) {
    currentEffect = effect;
    console.log('Current effect set to:', effect ? effect.name : 'None');
}

function loadEffectsList(mainWindow, getEffectsRepoPath, getEffectsPath) {
    console.log('Loading audio effects from SC files...');
    const audioEffectsPath = path.join(getEffectsRepoPath(), 'audio');
    
    // Clear the existing synths array
    synths.length = 0;

    try {
        const scFiles = fs.readdirSync(audioEffectsPath).filter(file => file.endsWith('.sc'));
        console.log(`Found ${scFiles.length} SC files in audio directory`);

        // Add new audio effects to the array
        scFiles.forEach(file => {
            const scFilePath = path.join('audio', file); // Relative path for consistency
            const effectName = path.basename(file, '.sc'); // Use filename as effect name
            
            const audioEffect = {
                name: effectName,
                scFilePath: scFilePath,
                params: {}, // Will be populated when SC file is loaded and specs are requested
                isAudioEffect: true // Flag to distinguish from old JSON-based effects
            };
            
            console.log(`Added audio effect: ${effectName} -> ${scFilePath}`);
            synths.push(audioEffect);
        });

        // Sort effects alphabetically by name
        synths.sort((a, b) => a.name.localeCompare(b.name));

        // Move "bypass" to the front if it exists
        const bypassIndex = synths.findIndex(effect => effect.name === "bypass");
        if (bypassIndex !== -1) {
            const bypass = synths.splice(bypassIndex, 1)[0];
            synths.unshift(bypass);
        }

        console.log(`Loaded ${synths.length} audio effects:`, synths.map(s => s.name));

        // Notify renderer about updated effects
        if (mainWindow && mainWindow.webContents) {
            mainWindow.webContents.send('effects-data', synths);
        }

        return synths;
    } catch (error) {
        console.error('Error loading audio effects:', error);
        return [];
    }
}

function loadMultiPassShader(shaderBasePath, effectsRepoPath) {
    // Extract base name from the path (e.g., "shaders/oscilloscope" -> "oscilloscope")
    const baseName = path.basename(shaderBasePath);
    const shaderDir = path.join(effectsRepoPath, path.dirname(shaderBasePath));
    
    console.log(`Scanning for multi-pass shader files with base name: ${baseName} in ${shaderDir}`);
    
    const multiPassConfig = {};
    
    // Define the passes to look for
    const passes = [
        { key: 'common', suffix: '_common.glsl' },
        { key: 'bufferA', suffix: '_bufferA.glsl' },
        { key: 'bufferB', suffix: '_bufferB.glsl' },
        { key: 'bufferC', suffix: '_bufferC.glsl' },
        { key: 'bufferD', suffix: '_bufferD.glsl' },
        { key: 'image', suffix: '_image.glsl' }
    ];
    
    // Scan for each pass
    for (const pass of passes) {
        const fileName = baseName + pass.suffix;
        const fullPath = path.join(shaderDir, fileName);
        
        if (fs.existsSync(fullPath)) {
            try {
                const source = fs.readFileSync(fullPath, 'utf-8');
                multiPassConfig[pass.key] = source; // Store the GLSL source directly
                console.log(`Found ${pass.key} pass: ${fileName}`);
            } catch (error) {
                console.error(`Error reading ${pass.key} pass file ${fullPath}:`, error);
                multiPassConfig[pass.key] = `// Error loading ${pass.key} pass`;
            }
        }
    }
    
    // Validate that we have at least an image pass
    if (!multiPassConfig.image) {
        throw new Error(`Multi-pass shader ${baseName} must have an image pass (${baseName}_image.glsl)`);
    }
    
    console.log(`Loaded multi-pass shader with passes: ${Object.keys(multiPassConfig).join(', ')}`);
    return multiPassConfig;
}

function loadP5SketchSync(sketchPath, getEffectsRepoPath) {
    try {
        const effectsPath = getEffectsRepoPath();
        const fullPath = path.join(effectsPath, sketchPath);

        if (!fs.existsSync(fullPath)) {
            console.error(`Sketch file not found: ${fullPath}`);
            return null;
        }

        const content = fs.readFileSync(fullPath, 'utf-8');
        return content;
    } catch (error) {
        console.error(`Error loading p5 sketch: ${error}`);
        return null;
    }
}

function loadVisualizerContent(visualizerPath, getEffectsRepoPath) {
    /**
     * Shared utility function to load visualizer content and determine type
     * Used for manual visualizer selection from the UI
     * For auto-loading from SC file comments, see parseAndLoadShaderFromComment()
     * Returns: { type: 'p5'|'shader', content: string|object, error?: string }
     */
    try {
        // Validate input path
        if (!visualizerPath || typeof visualizerPath !== 'string' || visualizerPath.trim().length === 0) {
            return { type: 'unknown', content: null, error: 'Visualizer path is empty or invalid' };
        }

        const trimmedPath = visualizerPath.trim();
        
        if (trimmedPath.toLowerCase().endsWith('.js')) {
            // Load p5 sketch
            const content = loadP5SketchSync(trimmedPath, getEffectsRepoPath);
            if (content) {
                // Validate content is not empty
                if (content.trim().length === 0) {
                    return { type: 'p5', content: null, error: `P5 sketch file "${trimmedPath}" is empty` };
                }
                return { type: 'p5', content };
            } else {
                return { type: 'p5', content: null, error: `Failed to load p5 sketch: ${trimmedPath}. File may not exist or is not readable.` };
            }
        } else if (trimmedPath.toLowerCase().endsWith('.glsl')) {
            // Single-pass shader
            const fullShaderPath = path.join(getEffectsRepoPath(), trimmedPath);
            if (fs.existsSync(fullShaderPath)) {
                const content = fs.readFileSync(fullShaderPath, 'utf-8');
                if (!content || content.trim().length === 0) {
                    return { type: 'shader', content: null, error: `Shader file "${trimmedPath}" is empty or contains only whitespace` };
                }
                return { type: 'shader', content };
            } else {
                return { type: 'shader', content: null, error: `Shader file not found: ${trimmedPath}` };
            }
        } else {
            // Multi-pass shader (base name)
            try {
                const content = loadMultiPassShader(trimmedPath, getEffectsRepoPath());
                if (content && Object.keys(content).length > 0) {
                    // Validate that we have at least an image pass
                    if (!content.image) {
                        return { type: 'shader', content: null, error: `Multi-pass shader "${trimmedPath}" missing required image pass` };
                    }
                    return { type: 'shader', content };
                } else {
                    return { type: 'shader', content: null, error: `Failed to load multi-pass shader: ${trimmedPath}. Check that shader files exist and follow naming convention.` };
                }
            } catch (multiPassError) {
                return { type: 'shader', content: null, error: `Multi-pass shader error for "${trimmedPath}": ${multiPassError.message}` };
            }
        }
    } catch (error) {
        return { type: 'unknown', content: null, error: `Unexpected error loading visualizer "${visualizerPath}": ${error.message}` };
    }
}

function parseAndLoadShaderFromComment(scFileContent, getEffectsRepoPath, mainWindow, broadcastCallback = null) {
    /**
     * Parse SC file for shader comments and auto-load the specified shader
     * Expected comment format: //shader: shadername (assumes shaders/ path prefix)
     * Auto-detects single-pass vs multi-pass shaders
     */
    const shaderMatch = scFileContent.match(/\/\/\s*shader:\s*(.+)/i);
    
    if (!shaderMatch) {
        return; // No shader comment found - this is not an error
    }

    const shaderName = shaderMatch[1].trim();
    console.log(`Found shader comment in SC file: ${shaderName}`);
    
    // Validate shader name
    if (!shaderName || shaderName.length === 0) {
        const errorMsg = 'Shader comment found but shader name is empty';
        console.error(errorMsg);
        if (mainWindow && mainWindow.webContents) {
            mainWindow.webContents.send('shader-loading-error', {
                shaderName: '(empty)',
                errorMessage: errorMsg
            });
        }
        return;
    }

    // Validate shader name contains only safe characters
    if (!/^[a-zA-Z0-9_-]+$/.test(shaderName)) {
        const errorMsg = `Invalid shader name "${shaderName}". Only letters, numbers, hyphens, and underscores are allowed.`;
        console.error(errorMsg);
        if (mainWindow && mainWindow.webContents) {
            mainWindow.webContents.send('shader-loading-error', {
                shaderName: shaderName,
                errorMessage: errorMsg
            });
        }
        return;
    }
    
    if (!mainWindow || !mainWindow.webContents) {
        console.warn('MainWindow not available for shader auto-loading');
        return;
    }

    try {
        const effectsRepoPath = getEffectsRepoPath();
        const shadersDir = path.join(effectsRepoPath, 'shaders');
        
        // Validate that the shaders directory exists
        if (!fs.existsSync(shadersDir)) {
            const errorMsg = `Shaders directory not found: ${shadersDir}`;
            console.error(errorMsg);
            mainWindow.webContents.send('shader-loading-error', {
                shaderName: shaderName,
                errorMessage: errorMsg
            });
            return;
        }
        
        // Check for multi-pass shader first (look for _image.glsl file)
        const multiPassImageFile = path.join(shadersDir, `${shaderName}_image.glsl`);
        const singlePassFile = path.join(shadersDir, `${shaderName}.glsl`);
        
        let shaderPath, shaderContent, shaderType;
        
        if (fs.existsSync(multiPassImageFile)) {
            // Multi-pass shader detected
            shaderPath = `shaders/${shaderName}`; // Base name for multi-pass
            try {
                shaderContent = loadMultiPassShader(shaderPath, effectsRepoPath);
                shaderType = 'multi-pass';
                console.log(`Successfully loaded multi-pass shader: ${shaderName}`);
            } catch (error) {
                const errorMsg = `Failed to load multi-pass shader "${shaderName}": ${error.message}`;
                console.error(errorMsg);
                mainWindow.webContents.send('shader-loading-error', {
                    shaderName: shaderName,
                    errorMessage: errorMsg
                });
                return;
            }
        } else if (fs.existsSync(singlePassFile)) {
            // Single-pass shader detected
            shaderPath = `shaders/${shaderName}.glsl`;
            try {
                shaderContent = fs.readFileSync(singlePassFile, 'utf-8');
                shaderType = 'single-pass';
                console.log(`Successfully loaded single-pass shader: ${shaderName}`);
                
                // Validate that the shader content is not empty
                if (!shaderContent || shaderContent.trim().length === 0) {
                    const errorMsg = `Shader file "${shaderName}.glsl" is empty or contains only whitespace`;
                    console.error(errorMsg);
                    mainWindow.webContents.send('shader-loading-error', {
                        shaderName: shaderName,
                        errorMessage: errorMsg
                    });
                    return;
                }
            } catch (error) {
                const errorMsg = `Failed to read single-pass shader file "${shaderName}.glsl": ${error.message}`;
                console.error(errorMsg);
                mainWindow.webContents.send('shader-loading-error', {
                    shaderName: shaderName,
                    errorMessage: errorMsg
                });
                return;
            }
        } else {
            // No shader files found - provide detailed feedback
            const checkedFiles = [
                `${shaderName}_image.glsl (multi-pass)`,
                `${shaderName}.glsl (single-pass)`
            ];
            const errorMsg = `Shader "${shaderName}" not found. Checked for: ${checkedFiles.join(', ')} in ${shadersDir}`;
            console.warn(errorMsg);
            mainWindow.webContents.send('shader-loading-error', {
                shaderName: shaderName,
                errorMessage: errorMsg
            });
            return;
        }

        // Successfully loaded shader content
        if (shaderContent) {
            const shaderData = {
                type: 'shader',
                path: shaderPath,
                content: shaderContent
            };
            mainWindow.webContents.send('auto-visualizer-loaded', shaderData);
            console.log(`Auto-loaded ${shaderType} shader: ${shaderName} -> ${shaderPath}`);
            
            // Also broadcast to remote visualizer clients
            if (broadcastCallback) {
                broadcastCallback({
                    type: 'shaderUpdate',
                    payload: {
                        shaderPath: shaderPath,
                        shaderContent: shaderContent
                    }
                });
                console.log(`Broadcasted auto-loaded shader to remote clients: ${shaderPath}`);
            }
        } else {
            const errorMsg = `Shader "${shaderName}" loaded but content is null or undefined`;
            console.error(errorMsg);
            mainWindow.webContents.send('shader-loading-error', {
                shaderName: shaderName,
                errorMessage: errorMsg
            });
        }
        
    } catch (error) {
        const errorMsg = `Unexpected error loading shader "${shaderName}": ${error.message}`;
        console.error(errorMsg, error);
        if (mainWindow && mainWindow.webContents) {
            mainWindow.webContents.send('shader-loading-error', {
                shaderName: shaderName,
                errorMessage: errorMsg
            });
        }
    }
}

function loadScFile(filePath, getEffectsRepoPath, mainWindow, broadcastCallback = null) {
    // Check if filePath is already absolute. If not, join with effects repo path.
    const scFilePath = path.isAbsolute(filePath) ? filePath : path.join(getEffectsRepoPath(), filePath);
    console.log(`Loading SC file: ${scFilePath}`); // Path will now be correct for temp files too

    // Read the SC file content to look for shader comments
    try {
        const scFileContent = fs.readFileSync(scFilePath, 'utf-8');
        parseAndLoadShaderFromComment(scFileContent, getEffectsRepoPath, mainWindow, broadcastCallback);
    } catch (readError) {
        console.warn(`Could not read SC file for shader parsing: ${readError.message}`);
    }

    const scCommand = `("${scFilePath}").load;`;

    return sendCodeToSclang(scCommand)
        .then(result => {
            if (result.includes('ERROR:') || result.includes('has bad input')) {
                throw new Error(result.trim());
            }
            console.log('SC file load result:', result);
            return result;
        })
        .catch(error => {
            console.error('Error loading SC file:', error);
            if (mainWindow && mainWindow.webContents) {
                mainWindow.webContents.send('sc-compilation-error', {
                    file: filePath,
                    errorMessage: error.message || 'Unknown SuperCollider error'
                });
            }
            throw error;
        });
}

function getSclangPath() {
    const possiblePaths = [
        // Linux (including Raspberry Pi) paths
        '/usr/bin/sclang',
        '/usr/local/bin/sclang',
        '/opt/SuperCollider/bin/sclang',
        // macOS path
        '/Applications/SuperCollider.app/Contents/MacOS/sclang'
    ];

    for (const path of possiblePaths) {
        if (fs.existsSync(path)) {
            return path;
        }
    }

    throw new Error('sclang not found in any of the expected paths');
}

function initializeSuperCollider(mainWindow, getEffectsRepoPath, loadEffectsCallback) {
    console.log('Initializing SuperCollider...');

    let sclangPath;
    try {
        sclangPath = getSclangPath();
    } catch (error) {
        console.error('Failed to get sclang path:', error);
        mainWindow.webContents.send('sc-compilation-error', {
            file: 'sclang',
            errorMessage: 'SuperCollider (sclang) not found in resources'
        });
        return;
    }

    console.log(`Using sclang from: ${sclangPath}`);

    try {
        sclang = spawn(sclangPath);
    } catch (error) {
        console.error('Failed to start SuperCollider:', error);
        mainWindow.webContents.send('sc-compilation-error', {
            file: 'sclang',
            errorMessage: 'Failed to start SuperCollider.'
        });
        return;
    }

    sclang.stdout.on('data', (data) => {
        const output = data.toString();
        const trimmedOutput = output.trim();

        // Filter out param changes
        const isParamChange = trimmedOutput.startsWith('-> Synth(') ||
                              trimmedOutput === 'sc3>';

        if (!isParamChange) {
            console.log(`SC stdout: ${trimmedOutput}`);
            mainWindow.webContents.send('sclang-output', output); // Send original output if not noisy
        }

        if (output.includes('Server booted successfully.')) {
            console.log('SuperCollider server is running');
            if (!serverBooted) {
                serverBooted = true; // Set the flag to prevent multiple notifications
                console.log('SuperCollider server is running');
                mainWindow.webContents.send('sc-ready');
                loadEffectsCallback();
            }
        }
    });

    sclang.stderr.on('data', (data) => {
        const errorOutput = data.toString();
        console.error(`SC stderr: ${errorOutput.trim()}`);
        mainWindow.webContents.send('sclang-error', errorOutput);
    });

    sclang.on('close', (code) => {
        console.log(`sclang process exited with code ${code}`);
        serverBooted = false;
    });

    bootSuperColliderServer(getEffectsRepoPath);
}

async function bootSuperColliderServer(getEffectsRepoPath) {
    const startupFilePath = path.join(getEffectsRepoPath(), '/utilities/init.sc');
    console.log(`Loading startup file from: ${startupFilePath}`);

    const scCommand = `("${startupFilePath}").load;`;

    sendCodeToSclang(scCommand)
        .then(result => console.log('Startup file loaded successfully:', result))
        .catch(error => console.error('Error loading startup file:', error));
}

function sendCodeToSclang(code) {
    return new Promise((resolve, reject) => {
        if (!sclang) {
            console.error('SuperCollider is not initialized');
            if (global.mainWindow) {
                global.mainWindow.webContents.send('sc-compilation-error', {
                    file: 'sclang',
                    errorMessage: 'SuperCollider is not initialized'
                });
            }
            reject('SuperCollider is not initialized');
            return;
        }
        if (!code || code === "") {
            console.log('Received empty or null code. Skipping SuperCollider execution.');
            resolve('No code to execute');
            return;
        }

        let sclangFriendlyFormatting = code.trim();
        sclangFriendlyFormatting += '\n';
        sclang.stdin.write(sclangFriendlyFormatting);

        // Set up a one-time listener for the sclang output
        sclang.stdout.once('data', (data) => {
            const output = data.toString();
            resolve(output);
        });

        // Set up error handling
        sclang.stderr.once('data', (data) => {
            console.error(`sclang stderr: ${data}`);
            reject(data.toString());
        });
    });
}

function isServerBooted() {
    return serverBooted;
}

async function killSuperCollider() {
    if (sclang) {
        try {
            console.log('Shutting down SuperCollider servers...');
            await sendCodeToSclang('Server.killAll;');
            console.log('SuperCollider servers killed successfully');

            // Kill the sclang process
            sclang.kill();
            console.log('sclang process terminated');
        } catch (error) {
            console.error('Error shutting down SuperCollider:', error);
        }
    }
}

module.exports = {
    synths,
    getCurrentEffect,
    setCurrentEffect,
    initializeSuperCollider,
    sendCodeToSclang,
    isServerBooted,
    killSuperCollider,
    loadEffectsList,
    loadP5SketchSync,
    loadScFile,
    loadMultiPassShader,
    loadVisualizerContent
};