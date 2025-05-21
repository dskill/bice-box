const { app, BrowserWindow, ipcMain } = require('electron');

/* ------------  WebGL-/GPU-related flags  ------------- */
/* ---- WebGL-2 on Raspberry Pi ---- */
app.commandLine.appendSwitch('use-gl', 'egl');          // or 'desktop' if X11/Mesa GL works better
app.commandLine.appendSwitch('ignore-gpu-blocklist');   // Pi's VC4 is black-listed
app.commandLine.appendSwitch('enable-unsafe-es3-apis'); // expose WebGL2 (ES3) paths
/* --------------------------------- */

const path = require('path');
const fs = require('fs');
const util = require('util');
const chokidar = require('chokidar');
const { exec } = require('child_process');
const os = require('os');
const networkInterfaces = os.networkInterfaces();
const openaiApiKey = process.env.OPENAI_API_KEY;
const OSCManager = require('./oscManager');
const packageJson = require('../package.json');
const appVersion = packageJson.version;
const axios = require('axios');
const {
  synths,
  getCurrentEffect,
  setCurrentEffect,
  initializeSuperCollider,
  sendCodeToSclang,
  killSuperCollider,
  loadEffectsList,
  loadP5SketchSync,
  loadScFile,
} = require('./superColliderManager');
const generativeEffectManager = require('./generativeEffectManager');
const wifi = require('node-wifi');

let mainWindow;
let oscManager;
let updateAvailable = false;
let devMode = false;

let activeAudioSourcePath = null; // To store the path of the user-selected audio effect
let activeVisualSourcePath = null; // To store the path of the user-selected visual effect

const runGenerator = process.argv.includes('--generate');
const runHeadlessTest = process.argv.includes('--headless-test');

if (process.argv.includes('--version'))
{
  console.log(`v${packageJson.version}`);
  process.exit(0);
}

console.log('Electron main process starting...');

app.commandLine.appendSwitch('enable-logging');
app.commandLine.appendSwitch('ozone-platform', 'wayland');

// Ensure log directory exists
const logDir = path.join(app.getPath('userData'), 'logs');
if (!fs.existsSync(logDir))
{
  fs.mkdirSync(logDir);
}

// Create a log file with a timestamp
const logPath = path.join(logDir, `log-${new Date().toISOString().replace(/:/g, '-')}.txt`);
const logStream = fs.createWriteStream(logPath, { flags: 'a' });

// Redirect console.log and console.error
const originalConsoleLog = console.log;
const originalConsoleError = console.error;

console.log = function ()
{
  logStream.write(util.format.apply(null, arguments) + '\n');
  originalConsoleLog.apply(console, arguments);
};

console.error = function ()
{
  logStream.write('ERROR: ' + util.format.apply(null, arguments) + '\n');
  originalConsoleError.apply(console, arguments);
};

function getEffectsPath()
{
  return getEffectsRepoPath() + '/effects';
}

function getEffectsRepoPath()
{
  return app.getPath("home") + '/bice-box-effects';
}

console.log('Is app packaged?', app.isPackaged);
console.log('Home path:', app.getPath("home"));
console.log('Repo path:', getEffectsRepoPath());

// Log unhandled exceptions
process.on('uncaughtException', (error) =>
{
  console.error('Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) =>
{
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

console.log('Logging initialized');

// Determine if we're in development mode
const isDev = process.env.NODE_ENV === 'development';

// Enable live reload for Electron
if (isDev)
{
  try
  {
    require('electron-reloader')(module, {
      debug: true,
      watchRenderer: true
    });
  } catch (err)
  {
    console.log('Error loading electron-reloader:', err);
  }
}

function createWindow()
{
  console.log('Creating main window...');

  let isLinux = process.platform === 'linux';
  console.log('Platform:', process.platform);

  let windowOptions = {
    width: 800,
    height: 480,
    fullscreen: isLinux,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      enableRemoteModule: true,
      worldSafeExecuteJavaScript: true,
      preload: path.join(__dirname, 'preload.js')
    },
    frame: true,
    kiosk: isLinux,
    backgroundColor: '#000000',
    show: false
  };

  console.log('Creating BrowserWindow...');

  try
  {
    mainWindow = new BrowserWindow(windowOptions);
    console.log('BrowserWindow created successfully');

    const loadUrl = isDev ? 'http://localhost:3000' : `file://${path.join(__dirname, '../build/index.html')}`;
    console.log('Loading URL:', loadUrl);

    mainWindow.loadURL(loadUrl);
    console.log('URL loaded');

    mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) =>
    {
      console.error('Failed to load:', errorCode, errorDescription);
    });

    mainWindow.webContents.on('did-finish-load', () =>
    {
      console.log('Content finished loading');
    });

    mainWindow.webContents.on('dom-ready', () =>
    {
      console.log('DOM is ready');
      if (isLinux)
      {
        mainWindow.webContents.insertCSS('* { cursor: none !important; }');
      }
    });

    if (isDev)
    {
      console.log('Opening DevTools');
      mainWindow.webContents.openDevTools();
    }

    mainWindow.once('ready-to-show', () =>
    {
      console.log('Window ready to show');
      mainWindow.show();
      console.log('Window shown');
    });

    // Initialize SuperCollider with the necessary callbacks
    const loadEffectsCallback = () => loadEffectsList(mainWindow, getEffectsRepoPath, getEffectsPath);
    initializeSuperCollider(mainWindow, getEffectsRepoPath, loadEffectsCallback);

    // Initialize OSC Server after creating the window
    oscManager = new OSCManager(mainWindow);
    oscManager.initialize();

    // Set up file watcher for hot reloading
    setupEffectsWatcher();

    // Check for updates periodically
    checkForAppUpdate();
    setInterval(checkForAppUpdate, 1800000); // Check every 30 minutes

  } catch (error)
  {
    console.error('Error creating window:', error);
  }
}

async function testGenerativeManager() {
    console.log('Running test for generativeEffectManager...');

    const effectsRepo = getEffectsRepoPath();

    const config = {
        apiKey: process.env.GEMINI_API_KEY || 'MOCK_API_KEY', // Use actual key if available, else mock
        effectsRepoPath: effectsRepo,
        audioEffectsSubdir: 'audio',
        jsonEffectsSubdir: 'effects',
        promptTemplatePath: path.join(__dirname, '..', 'scripts', 'generative', 'farm_prompt_template.md'),
        instructionsPath: path.join(__dirname, '..', 'scripts', 'generative', 'audio_effect_instructions.md'),
        systemPromptPath: path.join(__dirname, '..', 'scripts', 'generative', 'system_prompt.md'),
        geminiModel: 'gemini-1.5-pro-latest', // Model name, not used by mock in manager yet
        tempPath: app.getPath('temp'),
        mainWindow: mainWindow
    };

    try {
        const result = await generativeEffectManager.generateAndValidateEffect(config);
        console.log('--- Test Result from generateAndValidateEffect ---');
        if (result) {
            console.log('Success:', result.success);
            console.log('Output Filename Hint:', result.outputFilenameHint);
            console.log('Generated SC Code:\n', result.scCode);
            console.log('Generated JSON Content:\n', result.jsonContent);
            if (result.compilationSuccess) {
                console.log('SC Compilation Success:', result.compilationSuccess);
                console.log('Final SC Path:', result.finalScPath);
                console.log('Final JSON Path:', result.finalJsonPath);
            } else {
                console.error('SC Compilation Failed. Error:', result.compilationError);
            }
            if (result.error && !result.compilationError) { // Display general error if not a compilation error
                console.error('Error:', result.error);
            }
        } else {
            console.error('Test function returned null or undefined.');
        }
        console.log('-------------------------------------------------');
    } catch (error) {
        console.error('Error during generative manager test:', error);
    }
}

app.whenReady().then(() =>
{
  console.log('App is ready');
  // Add check for electron.js file
  const electronJsPath = path.join(__dirname, '../electron/main.js');
  if (!fs.existsSync(electronJsPath))
  {
    console.error(`ERROR: electron.js not found at ${electronJsPath}`);
    console.error('This may cause startup issues. Make sure the file is being copying correctly during build.');
  } else
  {
    console.log(`electron.js found at ${electronJsPath}`);
  }

  if (runHeadlessTest) {
    console.log('--headless-test flag detected. Starting headless test mode.');
    // Minimal setup for headless mode
    // Initialize OSC Server if it can run headlessly and is needed for the test
    // oscManager = new OSCManager(null); // Pass null for mainWindow if not needed
    // oscManager.initialize();
    // console.log('OSC Manager initialized in headless mode.');

    // Add any other non-UI initializations needed for your test

    console.log('Headless test mode started successfully.');
    setTimeout(() => {
      console.log('Headless test finished. Exiting.');
      app.quit();
    }, 5000); // Exit after 5 seconds
  } else {
    // Not headless test, so proceed with window creation and other modes
    createWindow();
    console.log('Window creation initiated.');

    // Call the test function if --generate flag is present
    if (runGenerator) { 
      console.log('--generate flag detected. Running generation process...');
      testGenerativeManager();
    }
    // Any other initializations that depend on the window or are not for headless mode can go here
  }
}).catch(error =>
{
  console.error('Error in app.whenReady():', error);
});

app.on('window-all-closed', () =>
{
  if (oscManager)
  {
    oscManager.close();
  }
  if (process.platform !== 'darwin')
  {
    app.quit();
  }
});

app.on('activate', () =>
{
  if (BrowserWindow.getAllWindows().length === 0)
  {
    createWindow();
  }
});

// IPC listeners for renderer process communication
ipcMain.on('send-to-supercollider', (event, code) =>
{
  sendCodeToSclang(code);
});

ipcMain.on('stop-synth', (event, synthName) =>
{
  sendCodeToSclang(`~${synthName}.free;`);
  console.log(`Stopped ${synthName}`);
});

ipcMain.on('reboot-server', (event) =>
{
  console.log('Rebooting SuperCollider server...');
  // Send killall command
  sendCodeToSclang('Server.killAll;')
    .then(() =>
    {
      setTimeout(() =>
      {
        const loadEffectsCallback = () => loadEffectsList(mainWindow, getEffectsRepoPath, getEffectsPath);
        initializeSuperCollider(mainWindow, getEffectsRepoPath, loadEffectsCallback);
      }, 1000); // Wait for 1 second before rebooting
    })
    .catch((error) =>
    {
      console.error('Error sending Server.killAll command:', error);
      // Still attempt to reboot even if the kill command fails
      setTimeout(() =>
      {
        const loadEffectsCallback = () => loadEffectsList(mainWindow, getEffectsRepoPath, getEffectsPath);
        initializeSuperCollider(mainWindow, getEffectsRepoPath, loadEffectsCallback);
      }, 1000);
    });
});

app.on('will-quit', async () =>
{
  console.log('Application shutting down...');

  // Kill SuperCollider servers
  await killSuperCollider();

  // Close OSC server
  if (oscManager)
  {
    oscManager.close();
    console.log('OSC server closed');
  }

  if (logStream && typeof logStream.end === 'function') { // Check if logStream is valid
    logStream.end();
  }
});

// IPC listener for OSC messages from p5.js sketches
ipcMain.on('send-osc-to-sc', (event, { address, args }) => {
  if (oscManager && oscManager.oscServer) { // Check for oscServer directly
    try {
      const scHost = '127.0.0.1';
      const scPort = 57120; // Default SuperCollider server port

      // Map arguments to the format expected by the osc library
      const typedArgs = args.map(arg => {
        if (typeof arg === 'number') {
          return { type: 'f', value: arg }; // Assume float for numbers
        } else if (typeof arg === 'string') {
          return { type: 's', value: arg };
        } else if (typeof arg === 'boolean') {
          // OSC doesn't have a dedicated boolean, send as int or T/F symbols
          return { type: 'i', value: arg ? 1 : 0 }; 
        }
        // Add more type handling if needed (e.g., integers explicitly 'i')
        console.warn(`Unsupported OSC argument type: ${typeof arg} for value: ${arg}. Skipping.`);
        return null;
      }).filter(arg => arg !== null); // Remove any unsupported args

      oscManager.oscServer.send(
        { address: address, args: typedArgs },
        scHost,
        scPort
      );
      // console.log(`OSC message sent to sc: ${address}`, typedArgs);
    } catch (error) {
      console.error('Error sending OSC message to SuperCollider:', error, { address, args });
    }
  } else {
    console.warn('OSC Manager or oscServer not available. OSC message from p5 not sent.', { address, args });
  }
});

const debounce = (func, delay) =>
{
  let inDebounce;
  return function ()
  {
    const context = this;
    const args = arguments;
    clearTimeout(inDebounce);
    inDebounce = setTimeout(() => func.apply(context, args), delay);
  }
};

function setupEffectsWatcher()
{
  const effectsPath = getEffectsRepoPath();
  const watcher = chokidar.watch(effectsPath, {
    ignored: /(^|[\/\\])\../, // ignore dotfiles
    persistent: true,
    ignoreInitial: true
  });

  const debouncedReloadEffect = debounce((changedPath) =>
  {
    console.log(`File changed: ${changedPath}`);
    reloadEffectForChangedFile(changedPath);
  }, 300); // in ms

  watcher.on('change', debouncedReloadEffect);
}

function reloadEffectForChangedFile(changedPath)
{
  const extension = path.extname(changedPath).toLowerCase();
  const relativeChangedPath = path.relative(getEffectsRepoPath(), changedPath);
  const fileName = path.basename(changedPath);

  console.log(`File changed: ${changedPath}`);
  console.log(`Relative path: ${relativeChangedPath}`);
  console.log(`File name: ${fileName}`);

  switch (extension)
  {
    case '.json':
      reloadFullEffect(changedPath);
      break;
    case '.sc':
      reloadAudioEffect(relativeChangedPath);
      break;
    case '.js':
      reloadVisualEffect(relativeChangedPath);
      break;
    case '.glsl':
      reloadShaderEffect(relativeChangedPath);
      break;
    default:
      console.log(`Unhandled file type: ${extension}`);
  }
}

function reloadFullEffect(jsonPath)
{
  console.log(`Reloading full effect from: ${jsonPath}`);
  const effectNameFromFile = path.basename(jsonPath, '.json');
  const effectIndex = synths.findIndex(synth => 
    synth.name && effectNameFromFile && 
    synth.name.toLowerCase() === effectNameFromFile.toLowerCase()
  );

  if (effectIndex !== -1)
  {
    try
    {
      console.log(`Reading JSON file: ${jsonPath}`);
      const fileContent = fs.readFileSync(jsonPath, 'utf8');
      const newEffectData = JSON.parse(fileContent);

      // Load p5 sketch content if visual path exists
      let p5SketchContent = null;
      if (newEffectData.visual) {
        p5SketchContent = loadP5SketchSync(newEffectData.visual, getEffectsRepoPath);
      }

      // Load shader content if shader path exists
      let shaderContent = null;
      if (newEffectData.shader) {
        try {
            const effectsRepoPath = getEffectsRepoPath(); 
            const fullShaderPath = path.join(effectsRepoPath, newEffectData.shader);
            if (fs.existsSync(fullShaderPath)) {
                shaderContent = fs.readFileSync(fullShaderPath, 'utf-8');
                console.log(`ReloadFullEffect: Loaded shader content from: ${fullShaderPath}`);
            } else {
                console.warn(`ReloadFullEffect: Shader file not found: ${fullShaderPath}`);
            }
        } catch (error) {
            console.error(`ReloadFullEffect: Error loading shader file ${newEffectData.shader}:`, error);
        }
      }

      // Update the effect in the synths array
      const updatedEffect = {
        name: newEffectData.name || effectNameFromFile,
        scFilePath: newEffectData.audio,
        p5SketchPath: newEffectData.visual,
        p5SketchContent: p5SketchContent, // Use the loaded p5 content
        shaderPath: newEffectData.shader, // Add shader path
        shaderContent: shaderContent,     // Add loaded shader content
        params: newEffectData.params || []
      };
      console.log(`Updated effect object:`, updatedEffect);

      synths[effectIndex] = updatedEffect;

      // Reload SuperCollider file
      if (updatedEffect.scFilePath)
      {
        console.log(`Loading SC file: ${updatedEffect.scFilePath}`);
        loadScFile(updatedEffect.scFilePath, getEffectsRepoPath, mainWindow);
      } else
      {
        console.warn(`No SC file path provided for effect ${effectNameFromFile}`);
      }

      // Notify renderer process about the updated effect
      if (mainWindow && mainWindow.webContents)
      {
        console.log(`Sending updated effect to renderer:`, updatedEffect);
        mainWindow.webContents.send('effect-updated', updatedEffect);
      } else
      {
        console.error('mainWindow or webContents is not available');
      }

      console.log(`Reloaded effect details:`, {
        name: updatedEffect.name,
        scFilePath: updatedEffect.scFilePath,
        p5SketchPath: updatedEffect.p5SketchPath,
        paramsCount: updatedEffect.params.length
      });

      console.log(`Effect ${updatedEffect.name} has been reloaded`);
    } catch (error)
    {
      console.error(`Error reloading effect ${effectNameFromFile}:`, error);
      console.error(error.stack);
    }
  } else
  {
    console.warn(`Effect ${effectNameFromFile} not found in synths array`);
    console.log('Current synths:', synths.map(s => s.name));
  }
}

function reloadAudioEffect(scFilePath)
{
  console.log(`Reloading audio effect (checking active): ${scFilePath}`);
  let reloaded = false;

  if (activeAudioSourcePath && activeAudioSourcePath.toLowerCase() === scFilePath.toLowerCase()) {
    console.log(`Changed SC file ${scFilePath} matches activeAudioSourcePath. Reloading.`);
    loadScFile(scFilePath, getEffectsRepoPath, mainWindow); // Pass the function, not its result
    reloaded = true;
  } else {
    console.log(`Changed SC file ${scFilePath} does not match activeAudioSourcePath (${activeAudioSourcePath}).`);
  }

  // Optional: Fallback to checking if any loaded preset uses it, if not already reloaded.
  // This part can be kept if you want to reload an SC file even if it's not the *active* one but part of a loaded preset.
  // For the user's current request, this might be commented out or removed if only active should hot-reload.
  if (!reloaded) {
    const affectedEffect = synths.find(synth => synth.scFilePath && synth.scFilePath.toLowerCase() === scFilePath.toLowerCase());
    if (affectedEffect) {
      console.log(`Fallback: Reloading audio for effect defined in preset: ${affectedEffect.name} as ${scFilePath}`);
      loadScFile(scFilePath, getEffectsRepoPath, mainWindow); // Pass the function, not its result
    } else {
      console.log(`No active audio source or preset found using SC file: ${scFilePath}`);
    }
  }
}

function reloadVisualEffect(jsFilePath)
{
  console.log(`Reloading visual effect (checking active): ${jsFilePath}`);
  let reloaded = false;

  if (activeVisualSourcePath && activeVisualSourcePath.toLowerCase() === jsFilePath.toLowerCase()) {
    console.log(`Changed JS file ${jsFilePath} matches activeVisualSourcePath. Reloading.`);
    const updatedSketchContent = loadP5SketchSync(jsFilePath, getEffectsRepoPath);
    if (updatedSketchContent) {
      if (mainWindow && mainWindow.webContents) {
        mainWindow.webContents.send('visual-effect-updated', {
          p5SketchPath: jsFilePath, // Send the path of the changed sketch
          p5SketchContent: updatedSketchContent
        });
        console.log(`Sent visual-effect-updated for active visual: ${jsFilePath}`);
      }
      reloaded = true;
    } else {
      console.error(`Failed to load updated p5 sketch for active source: ${jsFilePath}`);
    }
  } else {
    console.log(`Changed JS file ${jsFilePath} does not match activeVisualSourcePath (${activeVisualSourcePath}).`);
  }

  // Fallback: if not reloaded based on activeVisualSourcePath, check currentEffect from preset
  // This maintains previous behavior if the active path isn't directly matched but the preset uses it.
  if (!reloaded) {
    const currentPresetEffect = getCurrentEffect();
    if (currentPresetEffect && currentPresetEffect.p5SketchPath && currentPresetEffect.p5SketchPath.toLowerCase() === jsFilePath.toLowerCase()) {
      console.log(`Fallback: Reloading visual for current preset effect: ${currentPresetEffect.name} from changed file: ${jsFilePath}`);
      const updatedSketchContent = loadP5SketchSync(jsFilePath, getEffectsRepoPath);
      if (updatedSketchContent) {
        currentPresetEffect.p5SketchContent = updatedSketchContent; // Update the preset's content in memory
        if (mainWindow && mainWindow.webContents) {
          mainWindow.webContents.send('visual-effect-updated', {
            p5SketchPath: jsFilePath, // Still send path for consistency
            // name: currentPresetEffect.name, // Optional: could also send name if using preset context
            p5SketchContent: updatedSketchContent
          });
          console.log('Sent visual-effect-updated for preset visual.');
        }
      } else {
        console.error(`Failed to load updated p5 sketch for preset effect: ${jsFilePath}`);
      }
    } else {
      console.log(`No active visual source or preset found using JS file: ${jsFilePath}`);
    }
  }
}

function reloadShaderEffect(glslFilePath) {
    console.log(`Reloading shader effect (checking active): ${glslFilePath}`);
    let reloadedViaActive = false;

    if (activeVisualSourcePath && activeVisualSourcePath.toLowerCase() === glslFilePath.toLowerCase()) {
        console.log(`Changed GLSL file ${glslFilePath} matches activeVisualSourcePath. Reloading.`);
        try {
            const fullShaderPath = path.join(getEffectsRepoPath(), glslFilePath);
            const updatedShaderContent = fs.readFileSync(fullShaderPath, 'utf-8');
            const payload = { // Prepare payload explicitly
                shaderPath: glslFilePath,
                shaderContent: updatedShaderContent
            };
            if (mainWindow && mainWindow.webContents) {
                console.log('[Main Process] Sending shader-effect-updated with payload:', JSON.stringify(payload)); // Log the payload
                mainWindow.webContents.send('shader-effect-updated', payload);
                console.log(`Sent shader-effect-updated for active shader: ${glslFilePath}`);
            }
            reloadedViaActive = true;
        } catch (error) {
            console.error(`Failed to read updated GLSL shader for active source: ${glslFilePath}`, error);
        }
    } else {
        console.log(`Changed GLSL file ${glslFilePath} does not match activeVisualSourcePath (${activeVisualSourcePath || 'None set'}).`);
    }

    // Also, always update the shaderContent in the main synths array for any effect that uses this shader.
    // This ensures that if the effect is reloaded or switched to later, it gets the updated shader.
    const affectedEffectInSynths = synths.find(synth => synth.shaderPath && synth.shaderPath.toLowerCase() === glslFilePath.toLowerCase());
    if (affectedEffectInSynths) {
        try {
            const fullShaderPath = path.join(getEffectsRepoPath(), glslFilePath);
            const updatedShaderContent = fs.readFileSync(fullShaderPath, 'utf-8');
            affectedEffectInSynths.shaderContent = updatedShaderContent;
            console.log(`Updated shaderContent in synths array for effect: ${affectedEffectInSynths.name}`);

            // If this shader is part of the *current preset* (even if not the active visual source due to dev override)
            // and it wasn't reloaded via activeVisualSourcePath, send an update.
            // This ensures the preset, if re-selected or if it's what's actually driving the view, gets updated.
            const currentPresetEffect = getCurrentEffect();
            if (!reloadedViaActive && currentPresetEffect && currentPresetEffect.shaderPath && currentPresetEffect.shaderPath.toLowerCase() === glslFilePath.toLowerCase()) {
                 const fullShaderPathForPreset = path.join(getEffectsRepoPath(), glslFilePath); // Ensure path is correct
                 const updatedShaderContentForPreset = fs.readFileSync(fullShaderPathForPreset, 'utf-8'); // Re-read or ensure scope
                 const presetPayload = { // Prepare payload explicitly
                    shaderPath: glslFilePath,
                    shaderContent: updatedShaderContentForPreset
                 };
                 if (mainWindow && mainWindow.webContents) {
                    console.log('[Main Process] Sending shader-effect-updated (for preset) with payload:', JSON.stringify(presetPayload)); // Log the payload
                    mainWindow.webContents.send('shader-effect-updated', presetPayload);
                    console.log(`Sent shader-effect-updated for current preset shader: ${glslFilePath}`);
                }
            }
        } catch (error) {
            console.error(`Failed to read updated GLSL shader for synths array update: ${glslFilePath}`, error);
        }
    } else {
        console.log(`No preset in synths array found using GLSL file: ${glslFilePath}`);
    }
}

ipcMain.on('set-current-effect', (event, effectName) =>
{
  console.log(`IPC: Received set-current-effect for: ${effectName}`);
  const effect = synths.find(synth => synth.name === effectName);
  if (effect)
  {
    setCurrentEffect(effect);
    activeAudioSourcePath = effect.scFilePath;
    // Update activeVisualSourcePath based on whether it's a p5 or shader visual
    if (effect.shaderPath) {
        activeVisualSourcePath = effect.shaderPath;
        console.log(`Active visual source (shader) path updated from preset ${effectName}: ${activeVisualSourcePath}`);
    } else if (effect.p5SketchPath) {
        activeVisualSourcePath = effect.p5SketchPath;
        console.log(`Active visual source (p5) path updated from preset ${effectName}: ${activeVisualSourcePath}`);
    } else {
        activeVisualSourcePath = null; // No visual for this effect
        console.log(`No visual source path in preset ${effectName}.`);
    }
  } else
  {
    console.error(`Effect not found: ${effectName}`);
  }
});

// IPC listeners for explicitly setting active audio/visual sources
ipcMain.on('set-current-audio-source', (event, filePath) => {
  activeAudioSourcePath = filePath;
  console.log(`IPC: Active audio source path set to: ${activeAudioSourcePath}`);
});

ipcMain.on('set-current-visual-source', (event, filePath) => {
  activeVisualSourcePath = filePath;
  console.log(`IPC: Active visual source path set to: ${activeVisualSourcePath}`);
});

// Add this IPC handler for updating effect parameters
ipcMain.on('update-effect-params', (event, { effectName, params }) =>
{
  const effectIndex = synths.findIndex(synth => synth.name === effectName);
  if (effectIndex !== -1)
  {
    synths[effectIndex].params = params;
  }
});


// Also fix the pull-effects-repo handler similarly:
ipcMain.on('pull-effects-repo', async (event) =>
{
  const effectsRepoPath = getEffectsRepoPath();

  try
  {
    const { stdout: pullOutput } = await execPromise('git pull', { cwd: effectsRepoPath });
    console.log('Git pull output:', pullOutput);

    // After successful pull, reload effects and update status
    const loadedSynths = loadEffectsList(mainWindow, getEffectsRepoPath, getEffectsPath);
    const validSynths = loadedSynths.filter(synth => synth && synth.name); // Ensure consistent filtering
    if (mainWindow && mainWindow.webContents) {
        mainWindow.webContents.send('effects-data', validSynths);
        console.log('Global effects-data broadcast after git pull and effects reload.');
    }

    // Check status again after pull
    const { stdout: statusOutput } = await execPromise('git status -uno', { cwd: effectsRepoPath });
    const statusText = statusOutput ? statusOutput.toString() : '';
    const hasUpdates = statusText.includes('behind');

    event.reply('effects-repo-status', { hasUpdates });
    event.reply('pull-effects-repo-success', pullOutput.toString());
  } catch (error)
  {
    console.error('Error pulling effects repo:', error);
    event.reply('pull-effects-repo-error', error.message || 'Unknown error pulling repo');
  }
});

ipcMain.on('check-effects-repo', async (event) =>
{
  const effectsRepoPath = getEffectsRepoPath();
  console.log('Checking effects repo at:', effectsRepoPath);

  try
  {
    // Use the shell option to execute git commands through the system shell
    const execOptions = {
      cwd: effectsRepoPath,
      shell: true  // This is the key change
    };

    // Fetch latest
    await execPromise('git fetch origin', execOptions);

    // Compare local and remote commits
    const localHead = (await execPromise('git rev-parse HEAD', execOptions)).stdout.trim();
    const remoteHead = (await execPromise('git rev-parse origin/main', execOptions)).stdout.trim();

    const hasUpdates = localHead !== remoteHead;

    console.log('Git status check complete:', { localHead, remoteHead, hasUpdates });
    event.reply('effects-repo-status', { hasUpdates });

  } catch (error)
  {
    console.error('Error checking effects repo:', error);
    event.reply('effects-repo-error', {
      error: error.message,
      needsAttention: true
    });
  }
});

function execPromise(command, options)
{
  return new Promise((resolve, reject) =>
  {
    exec(command, options, (error, stdout, stderr) =>
    {
      if (error)
      {
        reject(error);
      } else
      {
        resolve({ stdout, stderr });
      }
    });
  });
}
function getIPAddress()
{
  for (const interfaceName in networkInterfaces)
  {
    const myInterface = networkInterfaces[interfaceName];
    for (const entry of myInterface)
    {
      if (entry.family === 'IPv4' && !entry.internal)
      {
        return entry.address;
      }
    }
  }
  return 'Unable to determine IP';
}

ipcMain.on('get-ip-address', (event) =>
{
  console.log("Received get-ip-address request");
  const ipAddress = getIPAddress();
  console.log(`Sending IP Address: ${ipAddress}`);
  event.reply('ip-address-reply', ipAddress);
});

ipcMain.handle('get-openai-key', () =>
{
  return openaiApiKey;
});

ipcMain.on('get-version', (event) =>
{
  console.log("Sending version:", appVersion);
  event.reply('version-reply', appVersion);
});

async function checkForAppUpdate()
{
  let latestVersion;
  try
  {
    // First try GitHub API
    const response = await axios.get(`https://api.github.com/repos/dskill/bice-box/releases/latest`);
    latestVersion = response.data.tag_name.replace('v', '');
    const currentVersion = packageJson.version;

    console.log(`Checking app version: current=${currentVersion}, latest=${latestVersion}`);
    updateAvailable = compareVersions(currentVersion, latestVersion) === 'smaller';
  } catch (error)
  {
    console.log('GitHub API failed or rate limited, trying alternative method...');
    try
    {
      // Fallback to getting redirect URL of latest release
      const response = await axios.get('https://github.com/dskill/bice-box/releases/latest', {
        maxRedirects: 0,
        validateStatus: status => status >= 200 && status < 400
      });

      // Extract version from the redirect URL
      const redirectUrl = response.request.res.responseUrl || response.headers.location;
      latestVersion = redirectUrl.split('/').pop().replace('v', '');
      const currentVersion = packageJson.version;

      if (!latestVersion)
      {
        throw new Error('Could not extract version from redirect URL');
      }

      console.log(`Checking app version (fallback method): current=${currentVersion}, latest=${latestVersion}`);
      updateAvailable = compareVersions(currentVersion, latestVersion) === 'smaller';
    } catch (fallbackError)
    {
      console.error('Error checking for app update (both methods failed):', fallbackError);
      return false;
    }
  }

  if (mainWindow && mainWindow.webContents)
  {
    mainWindow.webContents.send('app-update-status', {
      hasUpdate: updateAvailable,
      currentVersion: packageJson.version,
      latestVersion
    });
  }

  return updateAvailable;
}

function compareVersions(current, latest)
{
  if (current === latest) return 'equal';
  const currentParts = current.split('.').map(Number);
  const latestParts = latest.split('.').map(Number);

  for (let i = 0; i < 3; i++)
  {
    if (currentParts[i] < latestParts[i]) return 'smaller';
    if (currentParts[i] > latestParts[i]) return 'greater';
  }
  return 'equal';
}

// Add these IPC handlers
ipcMain.on('check-app-update', async (event) =>
{
  await checkForAppUpdate();
});

ipcMain.on('update-app', async (event) =>
{
  const command = process.platform === 'darwin' ?
    'curl -L https://raw.githubusercontent.com/dskill/bice-box/main/scripts/install.sh | bash -s -- -r' :
    'curl -L https://raw.githubusercontent.com/dskill/bice-box/main/scripts/install.sh | bash -s -- -r';

  console.log('Updating app with command:', command);
  // TODO: actually figure out if an error occurred and report it
  exec(command, (error, stdout, stderr) =>
  {
    if (error)
    {
      console.error('Error updating app:', error);
      event.reply('app-update-error', error.message);
    } else
    {
      console.log('App update initiated:', stdout);
    }
  });

  app.exit(0);

});

ipcMain.on('quit-app', () =>
{
  app.quit();
});

ipcMain.on('reload-all-effects', (event) =>
{
  console.log('Reloading all effects...');
  try
  {
    const loadedSynths = loadEffectsList(mainWindow, getEffectsRepoPath, getEffectsPath);
    const validSynths = loadedSynths.filter(synth => synth && synth.name);
    event.reply('effects-data', validSynths);
    console.log('Effects data sent to renderer process');
  } catch (error)
  {
    console.error('Error loading or sending effects data:', error);
    event.reply('effects-error', error.message);
  }
});

// Add this IPC handler for loading p5 sketches
ipcMain.handle('load-p5-sketch', async (event, sketchPath) =>
{
  try
  {
    return loadP5SketchSync(sketchPath, getEffectsRepoPath);
  } catch (error)
  {
    console.error('Error loading p5 sketch:', error);
    throw error;
  }
});

// Add handler for loading SC files
ipcMain.on('load-sc-file', (event, filePath) => {
    loadScFile(filePath, getEffectsRepoPath, mainWindow);
});

// Handler for WebGL capabilities logging
ipcMain.on('log-webgl-capabilities', (event, data) => {
  console.log('WebGL Capabilities Report:');
  console.log(JSON.stringify(data, null, 2));
  
  // Save to a file for future reference
  const webglReportPath = path.join(app.getPath('userData'), 'webgl-capabilities.json');
  fs.writeFileSync(webglReportPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    platform: process.platform,
    arch: process.arch,
    ...data
  }, null, 2));
  
  console.log(`WebGL capabilities report saved to ${webglReportPath}`);
});

wifi.init({
  iface: null // network interface, choose a random wifi interface if set to null
});

ipcMain.on('scan-wifi', (event) =>
{
  console.log('Scanning WiFi networks...');

  // First check current connection status
  wifi.getCurrentConnections((connectionError, currentConnections) => {
    const currentConnection = currentConnections?.[0];
    event.sender.send('wifi-connection-status', {
      success: !!currentConnection,
      ssid: currentConnection?.ssid || null
    });
  });


  wifi.scan((error, networks) =>
  {
    if (error)
    {
      console.error(error);
    } else
    {
      console.log('Raw WiFi networks:', networks);

      if (process.platform === 'darwin')
      {
        // for testing
        networks.push({
          ssid: 'Test Network 1',
          signal_level: -10,
          security: 'WPA2'
        });

        networks.push({
          ssid: 'Test Network 2',
          signal_level: -10,
          security: 'WPA2'
        });

        networks.push({
          ssid: 'Test Network 3',
          signal_level: -10,
          security: 'WPA2'
        });

        networks.push({
          ssid: 'Test Network 4',
          signal_level: -10,
          security: 'WPA2'
        });

        networks.push({
          ssid: 'Test Network 5',
          signal_level: -10,
          security: 'WPA2'
        });

        networks.push({
          ssid: 'Test Network 6',
          signal_level: -10,
          security: 'WPA2'
        });
      }


      // Filter and deduplicate networks
      const filteredNetworks = networks
        // Remove duplicates by keeping the strongest signal for each SSID
        .reduce((unique, network) =>
        {
          const existingNetwork = unique.find(n => n.ssid === network.ssid);
          if (!existingNetwork || existingNetwork.signal_level < network.signal_level)
          {
            // Remove existing weaker network if present
            const filtered = unique.filter(n => n.ssid !== network.ssid);
            return [...filtered, network];
          }
          return unique;
        }, [])
        // Filter out networks with weak signals (e.g., below -80 dBm)
        .filter(network => network.signal_level > -80)
        // Sort by signal strength (strongest first)
        .sort((a, b) => b.signal_level - a.signal_level);

      console.log('Filtered WiFi networks:', filteredNetworks);
      event.sender.send('wifi-networks', filteredNetworks);
    }
  });
});


ipcMain.on('connect-wifi', (event, { ssid, password }) =>
{
  console.log(`Attempting to connect to WiFi network: ${ssid}`);
  const WIFI_CONNECT_TIMEOUT = 20000;
  const connectOptions = {
    ssid,
    password,
    timeout: WIFI_CONNECT_TIMEOUT
  };

  wifi.connect(connectOptions, (error) =>
  {
    if (error)
    {
      console.error('WiFi connection error:', error);
      event.sender.send('wifi-connection-status', {
        success: false,
        error: error.message || 'Failed to connect to WiFi'
      });
    } else
    {
      console.log(`Successfully connected to ${ssid}`);
      event.sender.send('wifi-connection-status', {
        success: true,
        ssid: ssid
      });
    }
  });
});

ipcMain.on('check-wifi-status', (event) =>
{
  wifi.getCurrentConnections((error, currentConnections) =>
  {
    if (error)
    {
      console.error('Error checking WiFi status:', error);
      event.sender.send('wifi-status', {
        connected: false,
        error: error.message
      });
    } else
    {
      const currentConnection = currentConnections[0];
      event.sender.send('wifi-status', {
        connected: !!currentConnection,
        ssid: currentConnection ? currentConnection.ssid : null
      });
    }
  });
});

// Add these IPC handlers
ipcMain.handle('get-dev-mode', () => devMode);

ipcMain.on('toggle-dev-mode', (event) => {
    devMode = !devMode;
    mainWindow.webContents.send('dev-mode-changed', devMode);
    
    // Reload effects list with new mode
    const loadedSynths = loadEffectsList(mainWindow, getEffectsRepoPath, getEffectsPath);
    event.reply('effects-data', loadedSynths);
});

// --- Function to Scan for Visualizers ---
function getAvailableVisualizers(effectsRepoPath) {
  const visualsDir = path.join(effectsRepoPath, 'visual');
  console.log(`Scanning for visualizers in: ${visualsDir}`);
  try {
    if (!fs.existsSync(visualsDir)) {
      console.warn(`Visuals directory not found: ${visualsDir}`);
      return [];
    }
    const files = fs.readdirSync(visualsDir);
    const visualizers = files
      .filter(file => path.extname(file).toLowerCase() === '.js')
      .map(file => {
        const name = path.basename(file, '.js').replace(/_/g, ' ');
        // Capitalize first letter of each word (optional)
        // const prettyName = name.replace(/\b\w/g, l => l.toUpperCase());
        return {
          name: name, // Use the cleaned-up name
          p5SketchPath: path.join('visual', file) // Path relative to effects repo root
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name)); // Sort alphabetically
      
    console.log(`Found ${visualizers.length} visualizers:`, visualizers.map(v => v.name));
    return visualizers;
  } catch (error) {
    console.error(`Error scanning visualizers directory ${visualsDir}:`, error);
    return []; // Return empty list on error
  }
}

// --- IPC Handlers ---

// Add handler for getting visualizers
ipcMain.handle('get-visualizers', async (event) => {
  const effectsRepoPath = getEffectsRepoPath();
  return getAvailableVisualizers(effectsRepoPath);
});
