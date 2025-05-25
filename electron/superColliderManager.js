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
    console.log('Loading effects list...');
    const effectsPath = getEffectsPath();
    const effectFiles = fs.readdirSync(effectsPath).filter(file => file.endsWith('.json'));

    // Clear the existing synths array
    synths.length = 0;

    // Add new effects to the array
    effectFiles.forEach(file => {
        const filePath = path.join(effectsPath, file);
        const effect = loadEffectFromFile(filePath, getEffectsRepoPath);

        if (effect.p5SketchPath) {
            console.log(`Reloading p5.js sketch for ${effect.name}: ${effect.p5SketchPath}`);
            effect.p5SketchContent = loadP5SketchSync(effect.p5SketchPath, getEffectsRepoPath);
        }
        synths.push(effect); 
    });

    // Move "Bypass" to the front if it exists
    const bypassIndex = synths.findIndex(effect => effect.name === "bypass");
    if (bypassIndex !== -1) {
        const bypass = synths.splice(bypassIndex, 1)[0];
        synths.unshift(bypass);
    }

    // Notify renderer about updated effects
    if (mainWindow && mainWindow.webContents) {
        mainWindow.webContents.send('effects-updated', synths);
    }

    return synths;
}

function loadEffectFromFile(filePath, getEffectsRepoPath) {
    const synthData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    let p5SketchContent = null;
    if (synthData.visual) { // Ensure synthData.visual exists before trying to load
        p5SketchContent = loadP5SketchSync(synthData.visual, getEffectsRepoPath);
    }

    let shaderContent = null;
    if (synthData.shader) { // Check for the new shader field
        try {
            const effectsRepoPath = getEffectsRepoPath(); // Get base path for effects
            const fullShaderPath = path.join(effectsRepoPath, synthData.shader);
            if (fs.existsSync(fullShaderPath)) {
                shaderContent = fs.readFileSync(fullShaderPath, 'utf-8');
                console.log(`Loaded shader content from: ${fullShaderPath}`);
            } else {
                console.warn(`Shader file not found: ${fullShaderPath}`);
            }
        } catch (error) {
            console.error(`Error loading shader file ${synthData.shader}:`, error);
            // shaderContent remains null
        }
    }

    return {
        name: synthData.name,
        scFilePath: synthData.audio,
        p5SketchPath: synthData.visual,
        p5SketchContent: p5SketchContent, // Use the loaded content
        shaderPath: synthData.shader, // Store the path as well
        shaderContent: shaderContent, // Store the loaded shader content
        params: synthData.params,
        curated: synthData.curated || false
    };
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
    loadEffectFromFile
}; 