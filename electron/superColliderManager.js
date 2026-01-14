const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

// Array to store all available synths/effects
let synths = [];
let sclang;
let serverBooted = false;

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
            
            // Parse category from file comment
            let category = 'Uncategorized';
            try {
                const fullPath = path.join(audioEffectsPath, file);
                const content = fs.readFileSync(fullPath, 'utf-8');
                const categoryMatch = content.match(/\/\/\s*category:\s*(.+)/i);
                if (categoryMatch) {
                    category = categoryMatch[1].trim();
                }
            } catch (readError) {
                console.warn(`Could not read category from ${file}: ${readError.message}`);
            }
            
            const audioEffect = {
                name: effectName,
                scFilePath: scFilePath,
                category: category, // Add category field
                params: {}, // Will be populated when SC file is loaded and specs are requested
                isAudioEffect: true // Flag to distinguish from old JSON-based effects
            };
            
            // console.log(`Added audio effect: ${effectName} -> ${scFilePath}`); // Spam removed
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

function parseAndLoadVisualizerFromComment(scFileContent, getEffectsRepoPath, mainWindow, broadcastCallback = null) {
    /**
     * Parse SC file for visualizer comments and auto-load the specified visualizer
     * Supported comment formats:
     *   // shader: shadername   (loads from shaders/ directory)
     *   // p5: sketchname       (loads from visual/ directory)
     * Auto-detects single-pass vs multi-pass shaders
     */
    const shaderMatch = scFileContent.match(/\/\/\s*shader:\s*(.+)/i);
    const p5Match = scFileContent.match(/\/\/\s*p5:\s*(.+)/i);
    
    if (!shaderMatch && !p5Match) {
        return; // No visualizer comment found - this is not an error
    }

    // Determine which type of visualizer to load (shader takes precedence if both exist)
    const isP5 = !shaderMatch && p5Match;
    const visualizerName = isP5 ? p5Match[1].trim() : shaderMatch[1].trim();
    const commentType = isP5 ? 'p5' : 'shader';
    
    console.log(`Found ${commentType} comment in SC file: ${visualizerName}`);
    
    // Validate visualizer name
    if (!visualizerName || visualizerName.length === 0) {
        const errorMsg = `${commentType} comment found but name is empty`;
        console.error(errorMsg);
        if (mainWindow && mainWindow.webContents) {
            mainWindow.webContents.send('shader-loading-error', {
                shaderName: '(empty)',
                errorMessage: errorMsg
            });
        }
        return;
    }

    // Validate visualizer name contains only safe characters
    if (!/^[a-zA-Z0-9_-]+$/.test(visualizerName)) {
        const errorMsg = `Invalid ${commentType} name "${visualizerName}". Only letters, numbers, hyphens, and underscores are allowed.`;
        console.error(errorMsg);
        if (mainWindow && mainWindow.webContents) {
            mainWindow.webContents.send('shader-loading-error', {
                shaderName: visualizerName,
                errorMessage: errorMsg
            });
        }
        return;
    }
    
    if (!mainWindow || !mainWindow.webContents) {
        console.warn('MainWindow not available for visualizer auto-loading');
        return;
    }

    try {
        const effectsRepoPath = getEffectsRepoPath();
        
        if (isP5) {
            // Load p5.js visualizer from visual/ directory
            const visualDir = path.join(effectsRepoPath, 'visual');
            
            if (!fs.existsSync(visualDir)) {
                const errorMsg = `Visual directory not found: ${visualDir}`;
                console.error(errorMsg);
                mainWindow.webContents.send('shader-loading-error', {
                    shaderName: visualizerName,
                    errorMessage: errorMsg
                });
                return;
            }
            
            const p5FilePath = path.join(visualDir, `${visualizerName}.js`);
            
            if (!fs.existsSync(p5FilePath)) {
                const errorMsg = `P5 visualizer "${visualizerName}" not found. Checked for: ${visualizerName}.js in ${visualDir}`;
                console.warn(errorMsg);
                mainWindow.webContents.send('shader-loading-error', {
                    shaderName: visualizerName,
                    errorMessage: errorMsg
                });
                return;
            }
            
            try {
                const p5Content = fs.readFileSync(p5FilePath, 'utf-8');
                
                if (!p5Content || p5Content.trim().length === 0) {
                    const errorMsg = `P5 file "${visualizerName}.js" is empty or contains only whitespace`;
                    console.error(errorMsg);
                    mainWindow.webContents.send('shader-loading-error', {
                        shaderName: visualizerName,
                        errorMessage: errorMsg
                    });
                    return;
                }
                
                const p5Path = `visual/${visualizerName}.js`;
                const p5Data = {
                    type: 'p5',
                    path: p5Path,
                    content: p5Content
                };
                mainWindow.webContents.send('auto-visualizer-loaded', p5Data);
                console.log(`Auto-loaded p5 visualizer: ${visualizerName} -> ${p5Path}`);
                
                // Note: p5 visualizers are not broadcast to remote clients (they only support shaders)
                
            } catch (error) {
                const errorMsg = `Failed to read p5 file "${visualizerName}.js": ${error.message}`;
                console.error(errorMsg);
                mainWindow.webContents.send('shader-loading-error', {
                    shaderName: visualizerName,
                    errorMessage: errorMsg
                });
                return;
            }
        } else {
            // Load shader visualizer from shaders/ directory
            const shadersDir = path.join(effectsRepoPath, 'shaders');
            
            if (!fs.existsSync(shadersDir)) {
                const errorMsg = `Shaders directory not found: ${shadersDir}`;
                console.error(errorMsg);
                mainWindow.webContents.send('shader-loading-error', {
                    shaderName: visualizerName,
                    errorMessage: errorMsg
                });
                return;
            }
            
            // Check for multi-pass shader first (look for _image.glsl file)
            const multiPassImageFile = path.join(shadersDir, `${visualizerName}_image.glsl`);
            const singlePassFile = path.join(shadersDir, `${visualizerName}.glsl`);
            
            let shaderPath, shaderContent, shaderType;
            
            if (fs.existsSync(multiPassImageFile)) {
                // Multi-pass shader detected
                shaderPath = `shaders/${visualizerName}`; // Base name for multi-pass
                try {
                    shaderContent = loadMultiPassShader(shaderPath, effectsRepoPath);
                    shaderType = 'multi-pass';
                    console.log(`Successfully loaded multi-pass shader: ${visualizerName}`);
                } catch (error) {
                    const errorMsg = `Failed to load multi-pass shader "${visualizerName}": ${error.message}`;
                    console.error(errorMsg);
                    mainWindow.webContents.send('shader-loading-error', {
                        shaderName: visualizerName,
                        errorMessage: errorMsg
                    });
                    return;
                }
            } else if (fs.existsSync(singlePassFile)) {
                // Single-pass shader detected
                shaderPath = `shaders/${visualizerName}.glsl`;
                try {
                    shaderContent = fs.readFileSync(singlePassFile, 'utf-8');
                    shaderType = 'single-pass';
                    console.log(`Successfully loaded single-pass shader: ${visualizerName}`);
                    
                    // Validate that the shader content is not empty
                    if (!shaderContent || shaderContent.trim().length === 0) {
                        const errorMsg = `Shader file "${visualizerName}.glsl" is empty or contains only whitespace`;
                        console.error(errorMsg);
                        mainWindow.webContents.send('shader-loading-error', {
                            shaderName: visualizerName,
                            errorMessage: errorMsg
                        });
                        return;
                    }
                } catch (error) {
                    const errorMsg = `Failed to read single-pass shader file "${visualizerName}.glsl": ${error.message}`;
                    console.error(errorMsg);
                    mainWindow.webContents.send('shader-loading-error', {
                        shaderName: visualizerName,
                        errorMessage: errorMsg
                    });
                    return;
                }
            } else {
                // No shader files found - provide detailed feedback
                const checkedFiles = [
                    `${visualizerName}_image.glsl (multi-pass)`,
                    `${visualizerName}.glsl (single-pass)`
                ];
                const errorMsg = `Shader "${visualizerName}" not found. Checked for: ${checkedFiles.join(', ')} in ${shadersDir}`;
                console.warn(errorMsg);
                mainWindow.webContents.send('shader-loading-error', {
                    shaderName: visualizerName,
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
                console.log(`Auto-loaded ${shaderType} shader: ${visualizerName} -> ${shaderPath}`);
                
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
                const errorMsg = `Shader "${visualizerName}" loaded but content is null or undefined`;
                console.error(errorMsg);
                mainWindow.webContents.send('shader-loading-error', {
                    shaderName: visualizerName,
                    errorMessage: errorMsg
                });
            }
        }
        
    } catch (error) {
        const errorMsg = `Unexpected error loading ${commentType} "${visualizerName}": ${error.message}`;
        console.error(errorMsg, error);
        if (mainWindow && mainWindow.webContents) {
            mainWindow.webContents.send('shader-loading-error', {
                shaderName: visualizerName,
                errorMessage: errorMsg
            });
        }
    }
}

// Legacy alias for backward compatibility
function parseAndLoadShaderFromComment(scFileContent, getEffectsRepoPath, mainWindow, broadcastCallback = null) {
    return parseAndLoadVisualizerFromComment(scFileContent, getEffectsRepoPath, mainWindow, broadcastCallback);
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

// Safe compilation function that tests SC code before saving
async function compileAndSaveEffect(effectName, scCode, getEffectsRepoPath, activeAudioSourcePath) {
    console.log(`[compileAndSaveEffect] Called with effectName: ${effectName}, scCode length: ${scCode ? scCode.length : 0}`);
    
    const fs = require('fs');
    const path = require('path');
    const crypto = require('crypto');
    
    // Validate inputs
    if (!effectName || typeof effectName !== 'string') {
        console.error('[compileAndSaveEffect] Invalid effectName:', effectName);
        return {
            success: false,
            error: 'Invalid effect name provided',
            scOutput: null
        };
    }
    
    if (!scCode || typeof scCode !== 'string') {
        console.error('[compileAndSaveEffect] Invalid scCode:', typeof scCode);
        return {
            success: false,
            error: 'Invalid SuperCollider code provided',
            scOutput: null
        };
    }
    
    if (!getEffectsRepoPath || typeof getEffectsRepoPath !== 'function') {
        console.error('[compileAndSaveEffect] getEffectsRepoPath is not a function');
        return {
            success: false,
            error: 'Internal error: getEffectsRepoPath not available',
            scOutput: null
        };
    }
    
    // Generate a unique temp filename
    const tempId = crypto.randomBytes(8).toString('hex');
    const tempFileName = `temp_${tempId}_${effectName}.sc`;
    const audioPath = path.join(getEffectsRepoPath(), 'audio');
    const tempFilePath = path.join(audioPath, tempFileName);
    const finalFilePath = path.join(audioPath, `${effectName}.sc`);
    
    console.log(`[compileAndSaveEffect] Paths:`, {
        audioPath,
        tempFilePath,
        finalFilePath
    });
    
    try {
        // Ensure audio directory exists
        if (!fs.existsSync(audioPath)) {
            console.log(`[compileAndSaveEffect] Creating audio directory: ${audioPath}`);
            fs.mkdirSync(audioPath, { recursive: true });
        }
        
        // Step 1: Write to temp file
        console.log(`[compileAndSaveEffect] Writing temp file: ${tempFilePath}`);
        fs.writeFileSync(tempFilePath, scCode, 'utf-8');
        
        // Verify the file was written
        if (!fs.existsSync(tempFilePath)) {
            throw new Error(`Failed to write temp file: ${tempFilePath}`);
        }
        console.log(`[compileAndSaveEffect] Temp file written successfully, size: ${fs.statSync(tempFilePath).size} bytes`);
        
        // Step 2: Test compile the temp file
        console.log(`[compileAndSaveEffect] Testing compilation of: ${tempFileName}`);
        const compileResult = await testCompileScFile(tempFilePath);
        
        if (!compileResult.success) {
            // Compilation failed - clean up and return error
            console.error(`[compileAndSaveEffect] Compilation failed for ${effectName}`);
            try {
                fs.unlinkSync(tempFilePath);
            } catch (e) {
                console.warn(`Failed to delete temp file: ${tempFilePath}`);
            }
            return {
                success: false,
                error: compileResult.error,
                scOutput: compileResult.output
            };
        }
        
        // Step 3: Compilation succeeded - move to final location
        console.log(`[compileAndSaveEffect] Compilation successful, moving to: ${finalFilePath}`);
        
        // If file exists and is currently active, we need to be careful
        const isActive = activeAudioSourcePath && 
                        path.normalize(activeAudioSourcePath) === path.normalize(path.join('audio', `${effectName}.sc`));
        
        if (isActive) {
            console.log(`[compileAndSaveEffect] Effect ${effectName} is currently active - using atomic rename`);
        }
        
        // Use rename for atomic operation
        fs.renameSync(tempFilePath, finalFilePath);
        
        // Verify the final file exists
        if (!fs.existsSync(finalFilePath)) {
            throw new Error(`Failed to move file to final location: ${finalFilePath}`);
        }
        console.log(`[compileAndSaveEffect] File successfully written to: ${finalFilePath}, size: ${fs.statSync(finalFilePath).size} bytes`);
        
        // Step 4: Add to synths array if new
        const existingIndex = synths.findIndex(s => s.name === effectName);
        if (existingIndex === -1) {
            console.log(`[compileAndSaveEffect] Adding new effect ${effectName} to synths array`);
            const newEffect = {
                name: effectName,
                scFilePath: path.join('audio', `${effectName}.sc`),
                params: {},
                isAudioEffect: true
            };
            synths.push(newEffect);
            synths.sort((a, b) => a.name.localeCompare(b.name));
        }
        
        return {
            success: true,
            finalPath: finalFilePath
        };
        
    } catch (error) {
        console.error(`[compileAndSaveEffect] Unexpected error:`, error);
        // Try to clean up temp file
        try {
            if (fs.existsSync(tempFilePath)) {
                fs.unlinkSync(tempFilePath);
            }
        } catch (e) {
            console.warn(`Failed to delete temp file: ${tempFilePath}`);
        }
        return {
            success: false,
            error: `Unexpected error: ${error.message}`,
            scOutput: null
        };
    }
}

// Test compilation of SC file without side effects
async function testCompileScFile(filePath) {
    return new Promise((resolve) => {
        if (!sclang) {
            resolve({
                success: false,
                error: 'SuperCollider is not initialized',
                output: null
            });
            return;
        }
        
        // Use a unique marker for each compilation test
        const uniqueMarker = `COMPILE_TEST_${Date.now()}_${Math.random().toString(36).substring(7)}`;
        
        // Load the file and optionally create a test synth to catch runtime failures
        // Extract effect name from the temp file name
        const effectName = path.basename(filePath, '.sc').replace(/^temp_[a-f0-9]+_/, '');
        
        // Load the file, then try to create a test synth to catch runtime errors
        // We'll send multiple commands and collect all output
        const scCommand = `("${filePath}").load; fork { s.sync; Synth("${effectName}", [\\in_bus, 999, \\out, 999]); ("${uniqueMarker}:LOADED").postln; };`;
        
        let output = '';
        let errorOutput = '';
        
        // Set up temporary listeners
        const stdoutHandler = (data) => {
            output += data.toString();
        };
        
        const stderrHandler = (data) => {
            errorOutput += data.toString();
        };
        
        sclang.stdout.on('data', stdoutHandler);
        sclang.stderr.on('data', stderrHandler);
        
        // Send the test command
        sclang.stdin.write(scCommand + '\n');
        
        // Give the synth a moment to crash if it's going to
        // This helps catch runtime errors that happen immediately after instantiation
        setTimeout(() => {
            // Just a delay to allow errors to accumulate
        }, 500);
        
        // Wait for response with timeout
        setTimeout(() => {
            // Remove temporary listeners
            sclang.stdout.removeListener('data', stdoutHandler);
            sclang.stderr.removeListener('data', stderrHandler);
            
            const fullOutput = output + errorOutput;
            
            // Check if we have any ERROR in the output BEFORE looking for success marker
            // Note: "FAILURE IN SERVER /n_free" is harmless - it just means there was no synth to free
            // We only care about /n_set failures which indicate the synth crashed
            const hasError = fullOutput.includes('ERROR:') || 
                           fullOutput.includes('Parse error') ||
                           fullOutput.includes('syntax error') ||
                           fullOutput.includes('FAILURE IN SERVER /s_new') ||  // Synth creation failed
                           fullOutput.includes('FAILURE IN SERVER /n_set') ||  // Synth crashed after creation
                           fullOutput.includes('exceeded number of interconnect buffers') || // SynthDef too complex
                           fullOutput.includes('exception in GraphDef_Load');  // Failed to load SynthDef
            
            // Look for our marker showing the file was loaded
            const hasLoadedMarker = fullOutput.includes(`${uniqueMarker}:LOADED`);
            
            if (hasError) {
                // If there's an error, compilation failed regardless of marker
                console.log('[testCompileScFile] Compilation failed - ERROR found in output');
                
                // Extract the error message with specific handling for known critical errors
                let errorMsg = 'Compilation error';
                
                // Check for specific critical errors first
                if (fullOutput.includes('exceeded number of interconnect buffers')) {
                    errorMsg = 'ERROR: SynthDef too complex - Exceeded SuperCollider interconnect buffer limit. Try simplifying the effect or reducing the number of parallel processing chains.';
                } else if (fullOutput.includes('exception in GraphDef_Load')) {
                    errorMsg = 'ERROR: Failed to load SynthDef - The effect definition could not be loaded by the server.';
                } else if (fullOutput.includes('FAILURE IN SERVER /n_set')) {
                    errorMsg = 'ERROR: Runtime failure - Synth crashed immediately after creation (likely invalid UGen arguments).';
                } else if (fullOutput.includes('FAILURE IN SERVER /s_new')) {
                    errorMsg = 'ERROR: Failed to create synth instance.';
                } else {
                    // Try to extract generic error message
                    const errorMatch = fullOutput.match(/ERROR:\s*(.+?)(?=\n|$)/);
                    if (errorMatch) {
                        errorMsg = errorMatch[0];
                    } else if (fullOutput.includes('syntax error')) {
                        errorMsg = 'ERROR: Syntax error in SuperCollider code';
                    } else if (fullOutput.includes('Parse error')) {
                        errorMsg = 'ERROR: Parse error in SuperCollider code';
                    }
                }
                
                resolve({
                    success: false,
                    error: errorMsg,
                    output: fullOutput
                });
                return;
            } else if (hasLoadedMarker) {
                // No errors AND we have our loaded marker
                console.log('[testCompileScFile] Compilation successful (file loaded, no errors)');
                resolve({
                    success: true,
                    error: null,
                    output: fullOutput
                });
                return;
            }
            
            // FALLBACK: If we don't find our marker, something went wrong
            // This could mean SC crashed, timed out, or had a serious parsing error
            console.warn('[testCompileScFile] No unique compilation marker found in output');
            
            // Check for catastrophic errors that prevented our test from running
            const catastrophicErrorPatterns = [
                /ERROR:\s*(.+?)(?=\n|$)/,
                /Parse error/,
                /syntax error/,
                /unexpected end of file/
            ];
            
            let hasRealError = false;
            let errorMsg = 'Compilation test timeout - no response from SuperCollider';
            
            // Check if there's an obvious error that prevented our test from running
            for (const pattern of catastrophicErrorPatterns) {
                const match = fullOutput.match(pattern);
                if (match) {
                    hasRealError = true;
                    errorMsg = match[0] || match[1] || 'Compilation error detected';
                    break;
                }
            }
            
            // Return failure - we couldn't determine the compilation result
            resolve({
                success: false,
                error: hasRealError ? errorMsg : 'Compilation test timeout - no response from SuperCollider',
                output: fullOutput
            });
        }, 3000); // 3 second timeout to catch runtime errors
    });
}

// Test SC code without saving to file
async function testSuperColliderCode(scCode) {
    const fs = require('fs');
    const path = require('path');
    const crypto = require('crypto');
    const os = require('os');
    
    // Generate a temp file in system temp directory
    const tempId = crypto.randomBytes(8).toString('hex');
    const tempFileName = `test_${tempId}.sc`;
    const tempFilePath = path.join(os.tmpdir(), tempFileName);
    
    try {
        // Write code to temp file
        fs.writeFileSync(tempFilePath, scCode, 'utf-8');
        
        // Test compile
        const result = await testCompileScFile(tempFilePath);
        
        // Clean up temp file
        try {
            fs.unlinkSync(tempFilePath);
        } catch (e) {
            console.warn(`Failed to delete temp test file: ${tempFilePath}`);
        }
        
        return result;
    } catch (error) {
        // Clean up on error
        try {
            if (fs.existsSync(tempFilePath)) {
                fs.unlinkSync(tempFilePath);
            }
        } catch (e) {
            console.warn(`Failed to delete temp test file: ${tempFilePath}`);
        }
        
        return {
            success: false,
            error: `Failed to test code: ${error.message}`,
            output: null
        };
    }
}

module.exports = {
    synths,
    initializeSuperCollider,
    sendCodeToSclang,
    isServerBooted,
    killSuperCollider,
    loadEffectsList,
    loadP5SketchSync,
    loadScFile,
    loadMultiPassShader,
    loadVisualizerContent,
    compileAndSaveEffect,
    testSuperColliderCode
};