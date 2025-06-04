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

function loadScFile(filePath, getEffectsRepoPath, mainWindow) {
    // Check if filePath is already absolute. If not, join with effects repo path.
    const scFilePath = path.isAbsolute(filePath) ? filePath : path.join(getEffectsRepoPath(), filePath);
    console.log(`Loading SC file: ${scFilePath}`); // Path will now be correct for temp files too

    // Read the SC file content to look for visualizer comments
    try {
        const scFileContent = fs.readFileSync(scFilePath, 'utf-8');
        
        // Look for visualizer comment: //visualizer: path/to/visualizer.glsl or .js
        const visualizerMatch = scFileContent.match(/\/\/\s*visualizer:\s*(.+)/i);
        
        if (visualizerMatch) {
            const visualizerPath = visualizerMatch[1].trim();
            console.log(`Found visualizer comment in SC file: ${visualizerPath}`);
            
            // Load and send the visualizer content
            if (mainWindow && mainWindow.webContents) {
                try {
                    if (visualizerPath.toLowerCase().endsWith('.js')) {
                        // Load p5 sketch
                        const sketchContent = loadP5SketchSync(visualizerPath, getEffectsRepoPath);
                        if (sketchContent) {
                            mainWindow.webContents.send('auto-visualizer-loaded', {
                                type: 'p5',
                                path: visualizerPath,
                                content: sketchContent
                            });
                            console.log(`Auto-loaded p5 visualizer: ${visualizerPath}`);
                        }
                    } else if (visualizerPath.toLowerCase().endsWith('.glsl') || 
                               (!visualizerPath.toLowerCase().endsWith('.js') && !visualizerPath.toLowerCase().endsWith('.glsl'))) {
                        // Load shader (single-pass or multi-pass)
                        let shaderContent;
                        
                        if (visualizerPath.toLowerCase().endsWith('.glsl')) {
                            // Single-pass shader
                            const fullShaderPath = path.join(getEffectsRepoPath(), visualizerPath);
                            if (fs.existsSync(fullShaderPath)) {
                                shaderContent = fs.readFileSync(fullShaderPath, 'utf-8');
                            }
                        } else {
                            // Multi-pass shader (base name)
                            shaderContent = loadMultiPassShader(visualizerPath, getEffectsRepoPath());
                        }
                        
                        if (shaderContent) {
                            mainWindow.webContents.send('auto-visualizer-loaded', {
                                type: 'shader',
                                path: visualizerPath,
                                content: shaderContent
                            });
                            console.log(`Auto-loaded shader visualizer: ${visualizerPath}`);
                        }
                    }
                } catch (visualizerError) {
                    console.error(`Error loading visualizer ${visualizerPath}:`, visualizerError);
                }
            }
        }
    } catch (readError) {
        console.warn(`Could not read SC file for visualizer parsing: ${readError.message}`);
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
    loadMultiPassShader
};