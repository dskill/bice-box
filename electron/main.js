const { app, BrowserWindow, ipcMain } = require('electron');

/* ------------  WebGL-/GPU-related flags  ------------- */
/* ---- WebGL-2 on Raspberry Pi ---- */

// Determine if we're in development mode
const isDev = process.env.NODE_ENV === 'development';

if (!isDev) {
  app.commandLine.appendSwitch('use-gl', 'angle');          // Use ANGLE for GL implementation
  app.commandLine.appendSwitch('use-angle', 'gles');         // Tell ANGLE to use native GLES backend
  app.commandLine.appendSwitch('ignore-gpu-blocklist');   // Pi's VC4 is black-listed
  app.commandLine.appendSwitch('enable-unsafe-es3-apis'); // expose WebGL2 (ES3) path
}

/* ---- Touch Events for Raspberry Pi ---- */
app.commandLine.appendSwitch('touch-events', 'enabled');
app.commandLine.appendSwitch('enable-pinch');

/* --------------------------------- */

const path = require('path');
const fs = require('fs');
const util = require('util');
const chokidar = require('chokidar');
const { exec, spawn } = require('child_process');
const os = require('os');
const networkInterfaces = os.networkInterfaces();
const openaiApiKey = process.env.OPENAI_API_KEY;
const OSCManager = require('./oscManager');
const packageJson = require('../package.json');
const appVersion = packageJson.version;
const axios = require('axios');
const {
  synths,
  initializeSuperCollider,
  sendCodeToSclang,
  killSuperCollider,
  loadEffectsList,
  loadP5SketchSync,
  loadScFile,
  loadMultiPassShader,
  loadVisualizerContent
} = require('./superColliderManager');
const wifi = require('node-wifi');
const { startHttpServer, stopHttpServer, broadcast } = require('./httpServer');

// Auto-updater (production only)
let initAutoUpdater = null;
const isDevelopment = process.env.NODE_ENV === 'development';
if (!isDevelopment) {
  try {
    const autoUpdaterModule = require('./autoUpdater');
    initAutoUpdater = autoUpdaterModule.initAutoUpdater;
  } catch (err) {
    console.log('[AutoUpdater] Not available:', err.message);
  }
}

let mainWindow;
let oscManager;
let devMode = false;

let activeAudioSourcePath = null; // To store the path of the user-selected audio effect
let activeVisualSourcePath = null; // To store the path of the user-selected visual effect

// Log buffer for MCP log reading functionality
const LOG_BUFFER_SIZE = 2000; // Keep last 2000 lines in memory
let logBuffer = [];

function addToLogBuffer(type, ...args) {
    const timestamp = new Date().toISOString();
    const message = args.map(arg => 
        typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
    ).join(' ');
    
    const logEntry = `[${timestamp}] [${type}] ${message}`;
    logBuffer.push(logEntry);
    
    // Keep buffer size limited
    if (logBuffer.length > LOG_BUFFER_SIZE) {
        logBuffer.shift();
    }
}

// Function to get logs from buffer
function getLogBuffer(numLines = 100, filter = null) {
    let logs = [...logBuffer]; // Copy the buffer
    
    // Apply filter if provided
    if (filter) {
        logs = logs.filter(log => log.toLowerCase().includes(filter.toLowerCase()));
    }
    
    // Get last N lines
    const startIndex = Math.max(0, logs.length - numLines);
    return logs.slice(startIndex).join('\n');
}

const runHeadlessTest = process.argv.includes('--headless-test');
const runGpuCheck = process.argv.includes('--gpu-check'); // Added gpu-check flag

if (process.argv.includes('--version'))
{
  console.log(`v${packageJson.version}`);
  process.exit(0);
}

console.log('Electron main process starting...');

app.commandLine.appendSwitch('enable-logging');

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
  addToLogBuffer('LOG', ...arguments); // Add to our buffer
  try {
    originalConsoleLog.apply(console, arguments);
  } catch (e) {
    // Ignore EPIPE errors from broken pipes (prevents runaway log loops)
  }
};

console.error = function ()
{
  logStream.write('ERROR: ' + util.format.apply(null, arguments) + '\n');
  addToLogBuffer('ERROR', ...arguments); // Add to our buffer
  try {
    originalConsoleError.apply(console, arguments);
  } catch (e) {
    // Ignore EPIPE errors from broken pipes (prevents runaway log loops)
  }
};

// Also override console.warn
const originalConsoleWarn = console.warn;
console.warn = function ()
{
  logStream.write('WARN: ' + util.format.apply(null, arguments) + '\n');
  addToLogBuffer('WARN', ...arguments); // Add to our buffer
  try {
    originalConsoleWarn.apply(console, arguments);
  } catch (e) {
    // Ignore EPIPE errors from broken pipes (prevents runaway log loops)
  }
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

function createWindow()
{
  console.log('Creating main window...');

  let isLinux = process.platform === 'linux';
  console.log('Platform:', process.platform);

  let windowOptions = {
    width: 800,
    height: 480,
    fullscreen: isLinux && !runGpuCheck, // Disable fullscreen if gpu-check is active
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      enableRemoteModule: true,
      worldSafeExecuteJavaScript: true,
      preload: path.join(__dirname, 'preload.js')
    },
    frame: !isLinux || runGpuCheck, // Ensure frame is true if not Linux or if gpu-check is active
    kiosk: isLinux && !runGpuCheck, // Disable kiosk if gpu-check is active
    backgroundColor: '#000000',
    show: false
  };

  console.log('Creating BrowserWindow...');

  try
  {
    mainWindow = new BrowserWindow(windowOptions);
    console.log('BrowserWindow created successfully');

    if (runGpuCheck) {
      console.log('Loading chrome://gpu');
      mainWindow.loadURL('chrome://gpu');
    } else {
      const loadUrl = isDev ? 'http://localhost:3000' : `file://${path.join(__dirname, '../build/index.html')}`;
      console.log('Loading URL:', loadUrl);
      mainWindow.loadURL(loadUrl);
    }
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
      if (isLinux && !runGpuCheck) // Only hide cursor if not in gpu-check mode
      {
        mainWindow.webContents.insertCSS('* { cursor: none !important; }');
      }
    });

    if (isDev && !runGpuCheck) // Don't open devtools if gpu-check is active
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
    const loadEffectsCallback = () => {
      const loaded = loadEffectsList(mainWindow, getEffectsRepoPath, getEffectsPath);
      try { (loaded || []).forEach(s => ensureEffectInStore(s.name, s.scFilePath)); } catch {}
      broadcastEffectsState(effectsStore.activeEffectName);
      
      // Start Claude streaming process now that effects are loaded
      // This ensures the system prompt has the full effects list
      if (claudeManager) {
        console.log('Effects loaded, starting Claude streaming process with context...');
        claudeManager.startStreamingProcess();
      }
    };
    initializeSuperCollider(mainWindow, getEffectsRepoPath, loadEffectsCallback);

    // Initialize OSC Server after creating the window
    const handleEffectSpecs = ({ name: effectName, params, error }) => {
      // Debug logging (commented out for cleaner console)
      // console.log(`=== CALLBACK: handleEffectSpecs called ===`);
      // console.log(`Effect name: ${effectName}`);
      // console.log(`Params:`, params);
      // console.log(`Error:`, error);
    
      if (error) {
        console.error(`Received error with specs for ${effectName}: ${error}`);
        return;
      }
      
      // Debug: Effect specs received
      // console.log(`CALLBACK: Received effect-specs for ${effectName}`);
      // console.log(`CALLBACK: Params received:`, params);
      
      const effectIndex = synths.findIndex(synth => synth.name === effectName);
      
      if (effectIndex !== -1) {
        // console.log(`CALLBACK: Before update - synths[${effectIndex}].params:`, synths[effectIndex].params);
        synths[effectIndex].params = params || {}; 
        // console.log(`CALLBACK: After update - synths[${effectIndex}].params:`, synths[effectIndex].params);
        // console.log(`Updated params for ${effectName} in synths array:`, synths[effectIndex].params);
    
        const currentActiveEffect = getCurrentEffectFromStore();
        // console.log(`CALLBACK: Current active effect:`, currentActiveEffect ? currentActiveEffect.name : 'none');
        // console.log(`CALLBACK: Active audio source path:`, activeAudioSourcePath);
        // console.log(`CALLBACK: This effect's SC file path:`, synths[effectIndex].scFilePath);
        
        // Check if this effect's SC file matches the currently active audio source
        const isActiveAudioSource = activeAudioSourcePath && synths[effectIndex].scFilePath && 
                                   activeAudioSourcePath.toLowerCase() === synths[effectIndex].scFilePath.toLowerCase();
        
        // Update central store paramSpecs/paramValues and apply values once when specs are available
        ensureEffectInStore(effectName, synths[effectIndex].scFilePath);
        updateParamSpecs(effectName, params || {});
        // Initialize any missing paramValues to defaults lazily
        initializeParamValuesFromSpecs(effectName);

        const isActiveInStore = effectsStore.activeEffectName && effectsStore.activeEffectName === effectName;

        if (isActiveAudioSource || isActiveInStore) {
          // This effect matches the active audio source - updating UI
          // ---------------------
          // Apply current paramValues to SC exactly once when specs are known
          tryApplyAllParamsToSC(effectName);

          // Update the current effect to include the new params (legacy structure)
          // Legacy: no longer needed - state is updated in effectsStore 
          // console.log('Updated currentEffect with new params from SC.');
          if (mainWindow && mainWindow.webContents) {
            // Send effect-updated to renderer for active audio source
          mainWindow.webContents.send('effect-updated', synths[effectIndex]);
          // console.log(`Sent effect-updated for ${effectName} with new SC params to renderer.`);
          

            // -----------------------
            // Also broadcast unified effects/state snapshot
            broadcastEffectsState(effectName);
          } else {
            console.error(`mainWindow or webContents not available!`);
          }
        } else if (!currentActiveEffect && synths.length > 0 && synths[0].name === effectName) {
          // console.log(`CALLBACK: Setting initial effect ${effectName}`);
          // This handles the case where the very first effect (e.g. bypass or default) gets its specs
          // Legacy: no longer needed - state is updated in effectsStore
          effectsStore.activeEffectName = effectName;
          activeAudioSourcePath = synths[effectIndex].scFilePath;
          if (synths[effectIndex].shaderPath) {
            activeVisualSourcePath = synths[effectIndex].shaderPath;
          } else if (synths[effectIndex].p5SketchPath) {
            activeVisualSourcePath = synths[effectIndex].p5SketchPath;
          }
    
          if (mainWindow && mainWindow.webContents) {
            // Send effect-updated to renderer for initial effect
            mainWindow.webContents.send('effect-updated', synths[effectIndex]);
            // console.log(`Sent effect-updated for initial effect ${effectName} with new SC params to renderer.`);
            

            // -----------------------
            // Apply params and broadcast unified state
            tryApplyAllParamsToSC(effectName);
            broadcastEffectsState(effectName);
          } else {
            console.error(`mainWindow or webContents not available for initial effect!`);
          }
        } else {
          // console.log(`CALLBACK: Effect ${effectName} does not match active audio source. Active: ${activeAudioSourcePath}, This effect: ${synths[effectIndex].scFilePath}`);
          // Still broadcast store state so UI/MCP can see specs for non-active effects
          broadcastEffectsState(effectsStore.activeEffectName);
        }
      } else {
        console.warn(`Received specs for unknown effect: ${effectName}`);
        console.log(`Available effects: ${synths.map(s => s.name).join(', ')}`);
      }
      // End of handleEffectSpecs callback
    };

    const handleMidiCommand = (command) => {
      console.log(`[MIDI] Handling command: ${command}`);
      
      if (!effectsStore.activeEffectName) {
        console.warn('[MIDI] No active effect, cannot switch.');
        // Try to select the first one if nothing is active
        if (synths.length > 0) {
            console.log('[MIDI] selecting first effect as fallback');
            setCurrentEffectAction({ name: synths[0].name });
        }
        return;
      }

      // Find current index in synths list
      // Filter out any invalid synths first to match UI logic
      const validSynths = synths.filter(s => s && s.name);
      const currentIndex = validSynths.findIndex(s => s.name === effectsStore.activeEffectName);

      if (currentIndex === -1) {
        console.warn(`[MIDI] Active effect '${effectsStore.activeEffectName}' not found in synth list.`);
        return;
      }

      let newIndex = currentIndex;
      if (command === 'prev') {
        newIndex = (currentIndex - 1 + validSynths.length) % validSynths.length;
      } else if (command === 'next') {
        newIndex = (currentIndex + 1) % validSynths.length;
      } else {
        console.warn(`[MIDI] Unknown command: ${command}`);
        return;
      }

      const nextEffect = validSynths[newIndex];
      if (nextEffect) {
        console.log(`[MIDI] Switching to ${command} effect: ${nextEffect.name} (index ${currentIndex} -> ${newIndex})`);
        setCurrentEffectAction({ name: nextEffect.name });
      }
    };

    oscManager = new OSCManager(mainWindow, handleEffectSpecs, broadcast, handleMidiCommand);
    oscManager.initialize();
    
    // Expose setEffectParametersAction globally for MIDI CC updates from OSC
    global.setEffectParametersAction = setEffectParametersAction;
    
    // Set up WebSocket broadcasting for remote visualizer
    setupRemoteVisualizerBroadcasting();

    // Set up file watcher for hot reloading
    setupEffectsWatcher();

    // Initialize Claude manager
    initializeClaudeManager();
    
  } catch (error)
  {
    console.error('Error creating window:', error);
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
  } else if (runGpuCheck) { // Add this condition for gpu-check mode
    console.log('--gpu-check flag detected. Starting GPU check mode.');
    createWindow(); // Create the window configured for chrome://gpu
    console.log('GPU check mode: Window creation initiated.');
  } else {
    // Not headless test, so proceed with window creation and other modes
    createWindow();
    console.log('Window creation initiated.');

    // Initialize auto-updater (production only)
    if (initAutoUpdater && mainWindow) {
      initAutoUpdater(mainWindow);
    }

    // Start the MCP HTTP server
    const getState = {
        getCurrentEffectSnapshot: getActiveEffectSnapshot,
        getActiveVisualSourcePath: () => activeVisualSourcePath,
        getSynths: () => synths,
        getAvailableVisualizers: () => getAvailableVisualizers(getEffectsRepoPath()),
        getLogDir: () => logDir,
        fs: fs,
        path: path,
        sendCodeToSclang: sendCodeToSclang,
        mainWindow: mainWindow,
        loadScFileAndRequestSpecs: loadScFileAndRequestSpecs,
        loadVisualizerContent: loadVisualizerContent,
        getEffectsRepoPath: getEffectsRepoPath,
        loadEffectsList: loadEffectsList,
        // New unified actions
        setCurrentEffectAction: setCurrentEffectAction,
        setEffectParametersAction: setEffectParametersAction,
        setCurrentVisualizerAction: setCurrentVisualizerAction,
        getActiveVisualizerSnapshot: getActiveVisualizerSnapshot,
        setActiveVisualSourcePath: (filePath) => {
            activeVisualSourcePath = filePath;
            console.log(`[MCP] Set activeVisualSourcePath to: ${activeVisualSourcePath}`);
        },
        setActiveAudioSourcePath: (filePath) => {
            activeAudioSourcePath = filePath;
            console.log(`[MCP] Set activeAudioSourcePath to: ${activeAudioSourcePath}`);
        },
        // Add the safe compilation function
        compileAndSaveEffect: async (effectName, scCode) => {
            console.log(`[main.js] compileAndSaveEffect called with effectName: ${effectName}`);
            const { compileAndSaveEffect } = require('./superColliderManager');
            const result = await compileAndSaveEffect(effectName, scCode, getEffectsRepoPath, activeAudioSourcePath);
            console.log(`[main.js] compileAndSaveEffect returned:`, result);
            return result;
        },
        // Add the test-only function
        testSuperColliderCode: async (scCode) => {
            const { testSuperColliderCode } = require('./superColliderManager');
            return await testSuperColliderCode(scCode);
        },
        getLogBuffer: getLogBuffer
    };
    startHttpServer(getState);
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
        const loadEffectsCallback = () => {
          const loaded = loadEffectsList(mainWindow, getEffectsRepoPath, getEffectsPath);
          try { (loaded || []).forEach(s => ensureEffectInStore(s.name, s.scFilePath)); } catch {}
          broadcastEffectsState(effectsStore.activeEffectName);
        };
        initializeSuperCollider(mainWindow, getEffectsRepoPath, loadEffectsCallback);
      }, 1000); // Wait for 1 second before rebooting
    })
    .catch((error) =>
    {
      console.error('Error sending Server.killAll command:', error);
      // Still attempt to reboot even if the kill command fails
      setTimeout(() =>
      {
        const loadEffectsCallback = () => {
          const loaded = loadEffectsList(mainWindow, getEffectsRepoPath, getEffectsPath);
          try { (loaded || []).forEach(s => ensureEffectInStore(s.name, s.scFilePath)); } catch {}
          broadcastEffectsState(effectsStore.activeEffectName);
        };
        initializeSuperCollider(mainWindow, getEffectsRepoPath, loadEffectsCallback);
      }, 1000);
    });
});

app.on('will-quit', async () =>
{
  console.log('Application shutting down...');

  // Stop the HTTP server
  stopHttpServer();

  // Cleanup Claude Manager
  if (claudeManager) {
    claudeManager.cleanup();
    console.log('Claude Manager cleaned up');
  }

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
        
        if (!global.scPortConfig) {
            throw new Error('SuperCollider port configuration not received. Cannot send OSC messages.');
        }
        
        const scPort = global.scPortConfig.lang;
        //console.log(`Using SC port config: ${JSON.stringify(global.scPortConfig)}`);

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
    ignored: [
      /(^|[\\/])\../, // ignore dotfiles
      /temp_[a-f0-9]+_.*\.sc$/ // ignore temp SC files from compilation testing
    ],
    persistent: true,
    ignoreInitial: true
  });

  const debouncedReloadEffect = debounce((changedPath) =>
  {
    console.log(`File changed: ${changedPath}`);
    reloadEffectForChangedFile(changedPath);
  }, 300); // in ms - keep at 300ms for file watching

  watcher
    .on('change', debouncedReloadEffect)
    .on('add', (filePath) => {
        console.log(`File added: ${filePath}. Reloading effects list.`);
        debouncedReloadEffectList();
    })
    .on('unlink', (filePath) => {
        console.log(`File removed: ${filePath}. Reloading effects list.`);
        debouncedReloadEffectList();
    });
}

const debouncedReloadEffectList = debounce(() => {
    console.log('Reloading full effects list due to file addition/deletion.');
    loadEffectsListAndInitStore(mainWindow, getEffectsRepoPath, getEffectsPath);
    // Note: We could also reload visualizers here if needed in the future
}, 300);

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

function loadScFileAndRequestSpecs(filePath) {
    console.log(`Loading SC file and requesting specs for: ${filePath}`);
    
    // Load the SC file
    return loadScFile(filePath, getEffectsRepoPath, mainWindow, broadcast)
        .then(() => {
            console.log(`SC file ${filePath} loaded successfully. Requesting specs...`);
            
            // Extract effect name from file path (remove .sc extension and path)
            const effectName = path.basename(filePath, '.sc');
            console.log(`Using effect name: ${effectName} for OSC request`);
            
            // Add a small delay to ensure SuperCollider has time to register the specs
            setTimeout(() => {
                // Request specs via OSC to SC
                if (oscManager && oscManager.oscServer) {
                    const scHost = '127.0.0.1';
                    
                    if (!global.scPortConfig) {
                        console.error('SuperCollider port configuration not received. Cannot request specs.');
                        return;
                    }
                    
                    const scPort = global.scPortConfig.lang;
                    console.log(`ELECTRON: Requesting specs for ${effectName} on ${scHost}:${scPort}`);
                    
                    // Send the specs request
                    oscManager.oscServer.send({
                        address: '/effect/get_specs',
                        args: [{ type: 's', value: effectName }] 
                    }, scHost, scPort);
                    console.log(`ELECTRON: /effect/get_specs message sent for ${effectName}`);
                } else {
                    console.error('ELECTRON: OSC Manager or oscServer not available to request specs.');
                }
            }, 250); // 250ms delay to let SuperCollider finish registration
        })
        .catch(error => {
            console.error(`Error loading SC file ${filePath}:`, error);

            if (claudeManager && claudeManager.hasActiveSession()) {
                console.log('Active Claude session detected. Sending compilation error to Claude.');
                let errorMessage = 'The SuperCollider file at "' + filePath + '" failed to compile. The error was:\\n';
                errorMessage += error.message || error.toString();
                claudeManager.handleFileError(filePath, errorMessage);
            }
            
            // Re-throw the error to be caught by the caller if needed
            throw error;
        });
}

function reloadAudioEffect(scFilePath)
{
  console.log(`Reloading audio effect (checking active): ${scFilePath}`);
  let reloaded = false;

  const reloadAndRequest = (filePath) => {
    loadScFileAndRequestSpecs(filePath).catch(err => {
      console.error(`Error in reloadAudioEffect for ${filePath}:`, err);
    });
  };

  if (activeAudioSourcePath && activeAudioSourcePath.toLowerCase() === scFilePath.toLowerCase()) {
    console.log(`Changed SC file ${scFilePath} matches activeAudioSourcePath. Reloading.`);
    reloadAndRequest(scFilePath);
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
      reloadAndRequest(scFilePath);
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
    const currentPresetEffect = getCurrentEffectFromStore();
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
    const effectsRepoPath = getEffectsRepoPath();
    const fullChangedGlslPath = path.join(effectsRepoPath, glslFilePath);

    // Extract potential base name from the changed GLSL file
    // e.g., "shaders/oscilloscope_bufferA.glsl" -> "oscilloscope"
    const fileName = path.basename(glslFilePath, '.glsl');
    // const shaderDir = path.dirname(glslFilePath);
    let potentialBaseName = null;
    let passType = null;
    
    // Check if this is a multi-pass shader file (has underscore suffix)
    const multiPassSuffixes = ['_common', '_bufferA', '_bufferB', '_bufferC', '_bufferD', '_image'];
    // const multiPassComponentPattern = /_buffer[a-d]\.glsl$|_common\.glsl$/i;
    for (const suffix of multiPassSuffixes) {
        if (fileName.endsWith(suffix)) {
            potentialBaseName = fileName.substring(0, fileName.length - suffix.length);
            passType = suffix.substring(1); // Remove the underscore
            break;
        }
    }

    // Check if the changed GLSL is the activeVisualSourcePath
    if (activeVisualSourcePath) {
        const fullActiveVisualSourcePath = path.join(effectsRepoPath, activeVisualSourcePath);
        
        if (activeVisualSourcePath.toLowerCase().endsWith('.glsl') && fullActiveVisualSourcePath.toLowerCase() === fullChangedGlslPath.toLowerCase()) {
            // Active visual is a single GLSL file, and it's the one that changed.
            console.log(`Changed GLSL file ${glslFilePath} matches active single-pass visual. Reloading.`);
            try {
                const updatedShaderContent = fs.readFileSync(fullChangedGlslPath, 'utf-8');
                if (mainWindow && mainWindow.webContents) {
                    const shaderUpdateData = {
                        shaderPath: glslFilePath,
                        shaderContent: updatedShaderContent
                    };
                    mainWindow.webContents.send('shader-effect-updated', shaderUpdateData);
                    console.log(`Sent shader-effect-updated for active single-pass shader: ${glslFilePath}`);
                    

                }
                reloadedViaActive = true;
            } catch (error) {
                console.error(`Failed to read updated GLSL shader for active source: ${glslFilePath}`, error);
            }
        } else if (!activeVisualSourcePath.toLowerCase().endsWith('.glsl') && potentialBaseName) {
            // Active visual is a multi-pass base name, check if this GLSL file belongs to it
            const activeBaseName = path.basename(activeVisualSourcePath);
            if (activeBaseName === potentialBaseName) {
                console.log(`Changed GLSL file ${glslFilePath} is part of active multi-pass shader ${activeVisualSourcePath} (pass: ${passType}). Reloading.`);
                try {
                    // Reload the entire multi-pass shader
                    const { loadMultiPassShader } = require('./superColliderManager');
                    const updatedMultiPassConfig = loadMultiPassShader(activeVisualSourcePath, effectsRepoPath);
                    
                    if (mainWindow && mainWindow.webContents) {
                        const shaderUpdateData = {
                            shaderPath: activeVisualSourcePath, // Base name
                            shaderContent: updatedMultiPassConfig // Entire multi-pass object
                        };
                        mainWindow.webContents.send('shader-effect-updated', shaderUpdateData);
                        console.log(`Sent shader-effect-updated for active multi-pass shader: ${activeVisualSourcePath}`);
                        

                    }
                    reloadedViaActive = true;
                } catch (error) {
                    console.error(`Failed to reload multi-pass shader ${activeVisualSourcePath}:`, error);
                }
            }
        }
    }

    // Fallback: Update shaderContent in the main synths array for any effect that uses this GLSL.
    synths.forEach(synth => {
        if (!synth.shaderPath) return;

        const fullSynthShaderPath = path.join(effectsRepoPath, synth.shaderPath);

        if (synth.shaderPath.toLowerCase().endsWith('.glsl') && fullSynthShaderPath.toLowerCase() === fullChangedGlslPath.toLowerCase()) {
            // This synth uses the changed GLSL as a single-pass shader.
            if (!reloadedViaActive || synth.shaderPath.toLowerCase() !== activeVisualSourcePath?.toLowerCase()) {
                console.log(`Updating shaderContent in synths array for single-pass effect: ${synth.name} using ${glslFilePath}`);
                try {
                    const updatedContent = fs.readFileSync(fullChangedGlslPath, 'utf-8');
                    synth.shaderContent = updatedContent;
                    
                    const currentPresetEffect = getCurrentEffectFromStore();
                    if (currentPresetEffect && currentPresetEffect.name === synth.name) {
                         if (mainWindow && mainWindow.webContents) {
                            const shaderUpdateData = {
                                shaderPath: synth.shaderPath,
                                shaderContent: updatedContent
                            };
                            mainWindow.webContents.send('shader-effect-updated', shaderUpdateData);
                            console.log(`Sent shader-effect-updated for preset (single-pass): ${synth.shaderPath}`);
                            

                        }
                    }
                } catch (error) {
                    console.error(`Failed to read updated GLSL for synths array (single-pass ${synth.name}): ${glslFilePath}`, error);
                }
            }
        } else if (!synth.shaderPath.toLowerCase().endsWith('.glsl') && potentialBaseName) {
            // This synth uses a multi-pass base name, check if the changed GLSL belongs to it
            const synthBaseName = path.basename(synth.shaderPath);
            if (synthBaseName === potentialBaseName) {
                if (!reloadedViaActive || synth.shaderPath.toLowerCase() !== activeVisualSourcePath?.toLowerCase()) {
                    console.log(`Updating shaderContent in synths array for multi-pass effect: ${synth.name}, pass: ${passType} from ${glslFilePath}`);
                    try {
                        // Reload the entire multi-pass shader
                        const { loadMultiPassShader } = require('./superColliderManager');
                        const updatedMultiPassConfig = loadMultiPassShader(synth.shaderPath, effectsRepoPath);
                        synth.shaderContent = updatedMultiPassConfig;
                        
                        const currentPresetEffect = getCurrentEffectFromStore();
                        if (currentPresetEffect && currentPresetEffect.name === synth.name) {
                            if (mainWindow && mainWindow.webContents) {
                                const shaderUpdateData = {
                                    shaderPath: synth.shaderPath,
                                    shaderContent: updatedMultiPassConfig
                                };
                                mainWindow.webContents.send('shader-effect-updated', shaderUpdateData);
                                console.log(`Sent shader-effect-updated for preset (multi-pass): ${synth.shaderPath}`);
                                

                            }
                        }
                    } catch (error) {
                        console.error(`Failed to reload multi-pass shader for synths array (${synth.name}):`, error);
                    }
                }
            }
        }
    });
}

// IPC listeners for explicitly setting active audio/visual sources
ipcMain.on('set-current-audio-source', (event, filePath) => {
  activeAudioSourcePath = filePath;
  console.log(`IPC: Active audio source path set to: ${activeAudioSourcePath}`);
});

ipcMain.on('set-current-visual-source', (event, filePath) => {
  activeVisualSourcePath = filePath;
  console.log(`IPC: Active visual source path set to: ${activeVisualSourcePath}`);
  
  // Also broadcast to remote clients if it's a shader
  if (filePath && filePath.includes('shaders/')) {
    console.log('[RemoteBroadcast] Manual visualizer selection detected, broadcasting to remote clients');
    try {
      const effectsRepoPath = getEffectsRepoPath();
      const { loadMultiPassShader } = require('./superColliderManager');
      
      // Check if it's a single-pass or multi-pass shader
      if (filePath.toLowerCase().endsWith('.glsl')) {
        // Single-pass shader
        const fullShaderPath = path.join(effectsRepoPath, filePath);
        const shaderContent = fs.readFileSync(fullShaderPath, 'utf-8');
        
        broadcast({
          type: 'shaderUpdate',
          payload: {
            shaderPath: filePath,
            shaderContent: shaderContent
          }
        });
        console.log(`[RemoteBroadcast] Broadcast single-pass shader: ${filePath}`);
      } else {
        // Multi-pass shader (base name)
        const multiPassConfig = loadMultiPassShader(filePath, effectsRepoPath);
        
        broadcast({
          type: 'shaderUpdate',
          payload: {
            shaderPath: filePath,
            shaderContent: multiPassConfig
          }
        });
        console.log(`[RemoteBroadcast] Broadcast multi-pass shader: ${filePath}`);
      }
    } catch (error) {
      console.error('[RemoteBroadcast] Error broadcasting manual shader selection:', error);
    }
  }
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
  console.log(`[pull-effects-repo] Starting pull for repository at: ${effectsRepoPath}`);

  try
  {
    console.log('[pull-effects-repo] Pruning remote origin...');
    const pruneResult = await execPromise('git remote prune origin', { cwd: effectsRepoPath, shell: true });
    console.log('[pull-effects-repo] Prune stdout:', pruneResult.stdout);
    console.log('[pull-effects-repo] Prune stderr:', pruneResult.stderr);

    console.log('[pull-effects-repo] Fetching from origin...');
    const fetchResult = await execPromise('git fetch origin', { cwd: effectsRepoPath, shell: true });
    console.log('[pull-effects-repo] Fetch stdout:', fetchResult.stdout);
    console.log('[pull-effects-repo] Fetch stderr:', fetchResult.stderr);

    console.log('[pull-effects-repo] Determining current branch...');
    let currentBranch = 'main'; // Default to main
    try {
      const branchResult = await execPromise('git rev-parse --abbrev-ref HEAD', { cwd: effectsRepoPath, shell: true });
      if (branchResult.stdout && branchResult.stdout.trim() !== 'HEAD') {
        currentBranch = branchResult.stdout.trim();
      }
      console.log(`[pull-effects-repo] Current branch determined as: ${currentBranch}`);
    } catch (branchError) {
      console.warn(`[pull-effects-repo] Could not determine current branch, defaulting to 'main'. Error:`, branchError.stderr || branchError.error);
    }

    console.log(`[pull-effects-repo] Pulling from origin/${currentBranch}...`);
    const pullResult = await execPromise(`git pull origin ${currentBranch}`, { cwd: effectsRepoPath, shell: true });
    console.log('[pull-effects-repo] Git pull stdout:', pullResult.stdout);
    console.log('[pull-effects-repo] Git pull stderr:', pullResult.stderr);

    // After successful pull, reload effects and update status
    console.log('[pull-effects-repo] Reloading effects list...');
    const loadedSynths = loadEffectsList(mainWindow, getEffectsRepoPath, getEffectsPath);
    const validSynths = loadedSynths.filter(synth => synth && synth.name); // Ensure consistent filtering
    if (mainWindow && mainWindow.webContents) {
        mainWindow.webContents.send('effects-data', validSynths);
        console.log('[pull-effects-repo] Global effects-data broadcast after git pull and effects reload.');
    }

    // Check status again after pull
    console.log('[pull-effects-repo] Checking git status after pull...');
    const statusResult = await execPromise('git status -uno', { cwd: effectsRepoPath, shell: true });
    const statusText = statusResult.stdout ? statusResult.stdout.toString() : '';
    console.log('[pull-effects-repo] Git status output:', statusText);
    const hasUpdates = statusText.includes('Your branch is behind') || statusText.includes('behind'); // Made the check more robust

    event.reply('effects-repo-status', { hasUpdates });
    event.reply('pull-effects-repo-success', pullResult.stdout.toString());
    console.log('[pull-effects-repo] Pull process completed successfully.');

  } catch (error)
  {
    console.error('[pull-effects-repo] Error during pull process:', error);
    let errorMessage = 'Unknown error pulling repo.';
    if (error.error && error.error.message) errorMessage = error.error.message;
    if (error.stderr) errorMessage += `\nGit stderr: ${error.stderr}`;
    if (error.stdout) errorMessage += `\nGit stdout: ${error.stdout}`;
    event.reply('pull-effects-repo-error', errorMessage);
  }
});

ipcMain.on('check-effects-repo', async (event) =>
{
  const effectsRepoPath = getEffectsRepoPath();
  console.log('[check-effects-repo] Checking effects repo at:', effectsRepoPath);

  try
  {
    const execOptions = {
      cwd: effectsRepoPath,
      shell: true
    };

    console.log('[check-effects-repo] Pruning remote origin...');
    const pruneResult = await execPromise('git remote prune origin', execOptions);
    console.log('[check-effects-repo] Prune stdout:', pruneResult.stdout);
    console.log('[check-effects-repo] Prune stderr:', pruneResult.stderr);

    console.log('[check-effects-repo] Fetching from origin...');
    await execPromise('git fetch origin', execOptions);

    console.log('[check-effects-repo] Determining current branch...');
    let currentBranch = 'main'; // Default to main
    try {
      const branchResult = await execPromise('git rev-parse --abbrev-ref HEAD', execOptions);
      if (branchResult.stdout && branchResult.stdout.trim() !== 'HEAD') {
        currentBranch = branchResult.stdout.trim();
      }
      console.log(`[check-effects-repo] Current branch determined as: ${currentBranch}`);
    } catch (branchError) {
      console.warn(`[check-effects-repo] Could not determine current branch, defaulting to 'main'. Error:`, branchError.stderr || branchError.error);
    }

    console.log(`[check-effects-repo] Getting local commit for ${currentBranch}...`);
    const localHeadResult = await execPromise(`git rev-parse ${currentBranch}`, execOptions);
    const localHead = localHeadResult.stdout.trim();

    console.log(`[check-effects-repo] Getting remote commit for origin/${currentBranch}...`);
    const remoteHeadResult = await execPromise(`git rev-parse origin/${currentBranch}`, execOptions);
    const remoteHead = remoteHeadResult.stdout.trim();

    const hasUpdates = localHead !== remoteHead;

    console.log('[check-effects-repo] Git status check complete:', { currentBranch, localHead, remoteHead, hasUpdates });
    event.reply('effects-repo-status', { hasUpdates });

  } catch (error)
  {
    console.error('[check-effects-repo] Error checking effects repo:', error);
    let errorMessage = 'Error checking repo status.';
    if (error.error && error.error.message) errorMessage = error.error.message;
    if (error.stderr) errorMessage += `\nGit stderr: ${error.stderr}`;
    if (error.stdout) errorMessage += `\nGit stdout: ${error.stdout}`;
    
    event.reply('effects-repo-error', {
      error: errorMessage,
      needsAttention: true
    });
  }
});

// Get available git branches
ipcMain.on('get-git-branches', async (event) =>
{
  const effectsRepoPath = getEffectsRepoPath();
  console.log('[get-git-branches] Getting branches for repo at:', effectsRepoPath);
  
  try
  {
    const execOptions = {
      cwd: effectsRepoPath,
      shell: true
    };

    // Fetch latest from origin
    console.log('[get-git-branches] Fetching from origin...');
    await execPromise('git fetch origin', execOptions);
    
    // Get all remote branches
    console.log('[get-git-branches] Getting remote branches...');
    const result = await execPromise('git branch -r', execOptions);
    const branches = result.stdout
      .split('\n')
      .map(b => b.trim().replace('origin/', '').replace('origin/HEAD ->', ''))
      .filter(b => b && !b.includes('->'))
      .filter(b => !b.startsWith('archived/'))  // Filter archived branches
      .filter(b => !b.startsWith('cursor/'))    // Filter cursor branches
      .filter(b => !b.startsWith('claude/'))    // Filter claude branches
      .filter((v, i, a) => a.indexOf(v) === i); // unique
    
    // Get current branch
    console.log('[get-git-branches] Getting current branch...');
    const currentBranchResult = await execPromise('git rev-parse --abbrev-ref HEAD', execOptions);
    const currentBranch = currentBranchResult.stdout.trim();
    
    console.log('[get-git-branches] Found branches:', branches, 'Current:', currentBranch);
    event.reply('git-branches-reply', { branches, currentBranch });
  }
  catch (error)
  {
    console.error('[get-git-branches] Error getting branches:', error);
    const errorMessage = error.stderr || error.message || 'Unknown error getting branches';
    event.reply('git-branches-error', errorMessage);
  }
});

// Check for local changes in the effects repo
ipcMain.on('check-git-local-changes', async (event) =>
{
  const effectsRepoPath = getEffectsRepoPath();
  console.log('[check-git-local-changes] Checking for local changes at:', effectsRepoPath);
  
  try
  {
    const execOptions = {
      cwd: effectsRepoPath,
      shell: true
    };

    const result = await execPromise('git status --porcelain', execOptions);
    const hasLocalChanges = result.stdout.trim().length > 0;
    
    console.log('[check-git-local-changes] Has local changes:', hasLocalChanges);
    event.reply('git-local-changes-reply', { hasLocalChanges });
  }
  catch (error)
  {
    console.error('[check-git-local-changes] Error checking local changes:', error);
    const errorMessage = error.stderr || error.message || 'Unknown error checking local changes';
    event.reply('git-local-changes-error', errorMessage);
  }
});

// Discard local changes in effects repo
ipcMain.on('discard-git-changes', async (event) =>
{
  const effectsRepoPath = getEffectsRepoPath();
  console.log('[discard-git-changes] Discarding local changes at:', effectsRepoPath);
  
  try
  {
    const execOptions = {
      cwd: effectsRepoPath,
      shell: true
    };

    // Reset to HEAD (discards all local changes)
    console.log('[discard-git-changes] Running git reset --hard HEAD...');
    await execPromise('git reset --hard HEAD', execOptions);
    
    // Clean untracked files
    console.log('[discard-git-changes] Running git clean -fd...');
    await execPromise('git clean -fd', execOptions);
    
    console.log('[discard-git-changes] Local changes discarded successfully');
    event.reply('discard-changes-success');
  }
  catch (error)
  {
    console.error('[discard-git-changes] Error discarding changes:', error);
    const errorMessage = error.stderr || error.message || 'Unknown error discarding changes';
    event.reply('discard-changes-error', errorMessage);
  }
});

// Switch git branch
ipcMain.on('switch-git-branch', async (event, branchName) =>
{
  const effectsRepoPath = getEffectsRepoPath();
  console.log(`[switch-git-branch] Switching to branch '${branchName}' at:`, effectsRepoPath);
  
  try
  {
    const execOptions = {
      cwd: effectsRepoPath,
      shell: true
    };

    // Check for local changes first
    console.log('[switch-git-branch] Checking for local changes...');
    const statusResult = await execPromise('git status --porcelain', execOptions);
    if (statusResult.stdout.trim().length > 0)
    {
      throw new Error('Cannot switch branches with local changes');
    }
    
    // Checkout the branch
    console.log(`[switch-git-branch] Checking out branch '${branchName}'...`);
    await execPromise(`git checkout ${branchName}`, execOptions);
    
    // Pull latest
    console.log(`[switch-git-branch] Pulling latest from origin/${branchName}...`);
    await execPromise(`git pull origin ${branchName}`, execOptions);
    
    // Reload effects
    console.log('[switch-git-branch] Reloading effects list...');
    const loadedSynths = loadEffectsList(mainWindow, getEffectsRepoPath, getEffectsPath);
    try { (loadedSynths || []).forEach(s => ensureEffectInStore(s.name, s.scFilePath)); } catch {}
    broadcastEffectsState(effectsStore.activeEffectName);
    const validSynths = loadedSynths.filter(synth => synth && synth.name);
    if (mainWindow && mainWindow.webContents)
    {
      mainWindow.webContents.send('effects-data', validSynths);
      console.log('[switch-git-branch] Effects reloaded and sent to renderer.');
    }
    
    console.log(`[switch-git-branch] Successfully switched to branch '${branchName}'`);
    event.reply('switch-branch-success', { branch: branchName });
  }
  catch (error)
  {
    console.error('[switch-git-branch] Error switching branch:', error);
    const errorMessage = error.stderr || error.message || 'Unknown error switching branch';
    event.reply('switch-branch-error', errorMessage);
  }
});

// Get git diff for commit preview
ipcMain.on('get-git-diff', async (event) =>
{
  const effectsRepoPath = getEffectsRepoPath();
  console.log('[get-git-diff] Getting diff at:', effectsRepoPath);

  try
  {
    const execOptions = {
      cwd: effectsRepoPath,
      shell: true,
      maxBuffer: 1024 * 1024 * 5 // 5MB buffer for large diffs
    };

    // Get list of changed files
    const statusResult = await execPromise('git status --porcelain', execOptions);
    const changedFiles = statusResult.stdout.trim().split('\n').filter(line => line.trim());

    // Get the diff
    const diffResult = await execPromise('git diff', execOptions);

    // Also get diff of staged files and untracked file contents
    const stagedDiffResult = await execPromise('git diff --cached', execOptions);

    console.log('[get-git-diff] Found', changedFiles.length, 'changed files');
    event.reply('git-diff-reply', {
      changedFiles,
      diff: diffResult.stdout + stagedDiffResult.stdout,
      success: true
    });
  }
  catch (error)
  {
    console.error('[get-git-diff] Error getting diff:', error);
    const errorMessage = error.stderr || error.message || 'Unknown error getting diff';
    event.reply('git-diff-reply', { success: false, error: errorMessage });
  }
});

// Generate commit message using Claude
ipcMain.on('generate-commit-message', async (event, diffContent) =>
{
  console.log('[generate-commit-message] Generating commit message for diff...');

  try
  {
    const prompt = `Generate a concise git commit message for these changes to an audio effects repository. The message should have a subject line (max 72 chars) that clearly describes what changed. Reply with only the commit message, no explanation or markdown formatting.

Changes:
${diffContent}`;

    let output = '';
    let errorOutput = '';
    let hasReplied = false;

    // Build extended PATH like ClaudeManager does (needed for Pi where claude is in ~/.local/bin)
    const homeDir = os.homedir();
    const extendedPath = [
      process.env.PATH,
      homeDir ? path.join(homeDir, '.local', 'bin') : null,
      '/usr/local/bin',
      homeDir ? path.join(homeDir, '.nvm', 'versions', 'node', 'v20.18.0', 'bin') : null,
    ].filter(Boolean).join(path.delimiter);

    const cleanEnv = {
      ...process.env,
      PATH: extendedPath,
      NODE_OPTIONS: '',
    };

    // Use shell with heredoc to safely pass multiline prompt with special characters
    const claude = spawn('sh', ['-c', `claude -p "$(cat)"`], {
      env: cleanEnv,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    // Write prompt to stdin and close it
    claude.stdin.write(prompt);
    claude.stdin.end();

    // Add timeout to prevent hanging
    const timeout = setTimeout(() => {
      if (!hasReplied) {
        hasReplied = true;
        console.error('[generate-commit-message] Timeout - Claude took too long');
        claude.kill();
        event.reply('commit-message-reply', {
          success: false,
          error: 'Timeout generating commit message',
          fallbackMessage: 'Update effects'
        });
      }
    }, 30000); // 30 second timeout

    claude.stdout.on('data', (data) => {
      output += data.toString();
    });

    claude.stderr.on('data', (data) => {
      errorOutput += data.toString();
      console.log('[generate-commit-message] stderr:', data.toString());
    });

    claude.on('close', (code) => {
      clearTimeout(timeout);
      if (hasReplied) return;
      hasReplied = true;

      if (code === 0 && output.trim())
      {
        console.log('[generate-commit-message] Generated message:', output.trim());
        event.reply('commit-message-reply', { success: true, message: output.trim() });
      }
      else
      {
        console.error('[generate-commit-message] Claude exited with code:', code, 'stderr:', errorOutput);
        event.reply('commit-message-reply', {
          success: false,
          error: errorOutput || 'Failed to generate commit message',
          fallbackMessage: 'Update effects'
        });
      }
    });

    claude.on('error', (err) => {
      clearTimeout(timeout);
      if (hasReplied) return;
      hasReplied = true;

      console.error('[generate-commit-message] Failed to spawn claude:', err);
      event.reply('commit-message-reply', {
        success: false,
        error: 'Claude not available',
        fallbackMessage: 'Update effects'
      });
    });
  }
  catch (error)
  {
    console.error('[generate-commit-message] Error:', error);
    event.reply('commit-message-reply', {
      success: false,
      error: error.message,
      fallbackMessage: 'Update effects'
    });
  }
});

// Commit and push changes
ipcMain.on('git-commit-and-push', async (event, commitMessage) =>
{
  const effectsRepoPath = getEffectsRepoPath();
  console.log('[git-commit-and-push] Committing and pushing at:', effectsRepoPath);

  try
  {
    const execOptions = {
      cwd: effectsRepoPath,
      shell: true
    };

    // Stage all changes
    console.log('[git-commit-and-push] Staging all changes...');
    await execPromise('git add -A', execOptions);

    // Commit with the message (escape quotes in message)
    const escapedMessage = commitMessage.replace(/"/g, '\\"');
    console.log('[git-commit-and-push] Committing with message:', commitMessage);
    await execPromise(`git commit -m "${escapedMessage}"`, execOptions);

    // Get current branch
    const branchResult = await execPromise('git rev-parse --abbrev-ref HEAD', execOptions);
    const currentBranch = branchResult.stdout.trim();

    // Push to origin
    console.log(`[git-commit-and-push] Pushing to origin/${currentBranch}...`);
    await execPromise(`git push origin ${currentBranch}`, execOptions);

    console.log('[git-commit-and-push] Successfully committed and pushed');
    event.reply('git-commit-push-reply', { success: true });
  }
  catch (error)
  {
    console.error('[git-commit-and-push] Error:', error);
    const errorMessage = error.stderr || error.message || 'Unknown error committing/pushing';
    event.reply('git-commit-push-reply', { success: false, error: errorMessage });
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
        reject({ error, stdout: stdout.toString(), stderr: stderr.toString() });
      } else
      {
        resolve({ stdout: stdout.toString(), stderr: stderr.toString() });
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
    try { (loadedSynths || []).forEach(s => ensureEffectInStore(s.name, s.scFilePath)); } catch {}
    broadcastEffectsState(effectsStore.activeEffectName);
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

// Handler for loading SC files and requesting specs
ipcMain.on('load-sc-file-and-request-specs', (event, filePath) => {
    console.log(`IPC: Received load-sc-file-and-request-specs for: ${filePath}`);
    
    // Update the active audio source path
    activeAudioSourcePath = filePath;
    console.log(`Updated activeAudioSourcePath to: ${activeAudioSourcePath}`);
    
    loadScFileAndRequestSpecs(filePath)
        .catch(error => {
            console.error(`Error in IPC handler for loading SC file ${filePath}:`, error);
        });
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
        // Filter out networks with extremely weak signals (e.g., below -95 dBm)
        .filter(network => network.signal_level > -95)
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

ipcMain.handle('get-platform-info', () => ({
  platform: process.platform,
  isLinux: process.platform === 'linux',
  isPi: process.platform === 'linux' // Assuming Pi runs Linux
}));

ipcMain.on('toggle-dev-mode', (event) => {
    devMode = !devMode;
    mainWindow.webContents.send('dev-mode-changed', devMode);
    
    // Reload effects list with new mode
    const loadedSynths = loadEffectsList(mainWindow, getEffectsRepoPath, getEffectsPath);
    event.reply('effects-data', loadedSynths);
});

// --- Function to Scan for Visualizers ---
function getAvailableVisualizers(effectsRepoPath) {
  const visualizers = [];
  const p5VisualsDir = path.join(effectsRepoPath, 'visual');
  const shaderVisualsDir = path.join(effectsRepoPath, 'shaders'); // Added shaders

  // console.log(`Scanning for P5 visualizers in: ${p5VisualsDir}`); // Spam removed
  try {
    if (fs.existsSync(p5VisualsDir)) {
      const files = fs.readdirSync(p5VisualsDir);
      files
        .filter(file => path.extname(file).toLowerCase() === '.js')
        .forEach(file => {
          const name = path.basename(file, '.js').replace(/_/g, ' ');
          visualizers.push({
            name: name,
            type: 'p5', // Added type
            path: path.join('visual', file) // Kept original path structure for p5
          });
        });
    } else {
      console.warn(`P5 Visuals directory not found: ${p5VisualsDir}`);
    }
  } catch (error) {
    console.error(`Error scanning P5 visualizers directory ${p5VisualsDir}:`, error);
  }

  // console.log(`Scanning for Shader visualizers in: ${shaderVisualsDir}`); // Spam removed
  try {
    if (fs.existsSync(shaderVisualsDir)) {
      const files = fs.readdirSync(shaderVisualsDir);
      const shadersOutput = new Map(); // Use a map to handle overrides and ensure uniqueness by base name

      // Regex to identify multi-pass component files that should NOT be listed directly,
      // except for _image.glsl which is used as an identifier.
      const multiPassComponentPattern = /_buffer[a-d]\.glsl$|_common\.glsl$/i;

      // First pass: Identify multi-pass shaders via _image.glsl
      files.forEach(file => {
        if (file.toLowerCase().endsWith('_image.glsl')) {
          const baseName = file.substring(0, file.length - '_image.glsl'.length);
          const displayName = baseName.replace(/_/g, ' ');
          shadersOutput.set(baseName, {
            name: displayName,
            type: 'shader',
            path: path.join('shaders', baseName) // Path is the base name for multi-pass
          });
        }
      });

      // Second pass: Identify single-pass shaders
      files.forEach(file => {
        if (file.toLowerCase().endsWith('.glsl')) {
          const baseName = file.substring(0, file.length - '.glsl'.length);
          
          // If it's an _image.glsl, it's already handled by the first pass (identified as multi-pass).
          // If it's another multi-pass component (_bufferX.glsl, _common.glsl), ignore it for direct listing.
          if (file.toLowerCase().endsWith('_image.glsl') || multiPassComponentPattern.test(file.toLowerCase())) {
            return;
          }

          // If this baseName is NOT already in shadersOutput (meaning it wasn't identified as a multi-pass shader by an _image.glsl file)
          // then it's a single-pass shader.
          if (!shadersOutput.has(baseName)) {
            const displayName = baseName.replace(/_/g, ' ');
            // The key for single-pass shaders should be distinct if a multi-pass with the same basename exists.
            // However, the current logic correctly prioritizes multi-pass via the first loop.
            // This ensures that if "foo_image.glsl" exists, "foo.glsl" (if it also exists as a separate single file) won't override "foo" as multi-pass.
            shadersOutput.set(baseName, { 
              name: displayName,
              type: 'shader',
              path: path.join('shaders', file) // Path is the full filename for single-pass
            });
          }
        }
      });
      visualizers.push(...Array.from(shadersOutput.values()));
    } else {
      console.warn(`Shader Visuals directory not found: ${shaderVisualsDir}`);
    }
  } catch (error) {
    console.error(`Error scanning Shader visualizers directory ${shaderVisualsDir}:`, error);
  }

  // Detect duplicate names across p5 and shader visualizers
  const nameMap = new Map();
  visualizers.forEach(v => {
    if (!nameMap.has(v.name)) {
      nameMap.set(v.name, []);
    }
    nameMap.get(v.name).push(v);
  });
  
  // Log warnings for any duplicates found
  nameMap.forEach((entries, name) => {
    if (entries.length > 1) {
      const paths = entries.map(e => `${e.path} (${e.type})`).join(', ');
      console.warn(`[Visualizer Warning] Duplicate visualizer name "${name}" found in: ${paths}. Only the first will be selectable. Consider renaming to ensure unique names.`);
    }
  });

  visualizers.sort((a, b) => a.name.localeCompare(b.name)); // Sort alphabetically
  // console.log(`Found ${visualizers.length} total visualizers (P5 and Shaders):`, visualizers.map(v => `${v.name} (${v.type}) [${v.path}]`)); // Spam removed
  return visualizers;
}

// --- IPC Handlers ---

// Add handler for getting visualizers
ipcMain.handle('get-visualizers', async (event) => {
  const effectsRepoPath = getEffectsRepoPath();
  return getAvailableVisualizers(effectsRepoPath);
});

// Add this IPC handler for loading shader content
ipcMain.handle('load-shader-content', async (event, shaderPath) => {
  try {
    const effectsRepoPath = getEffectsRepoPath();
    
    if (shaderPath.toLowerCase().endsWith('.glsl')) {
      // Single-pass shader: load GLSL content directly
      const fullPath = path.join(effectsRepoPath, shaderPath); // shaderPath is relative
      if (!fs.existsSync(fullPath)) {
        console.error(`Shader file not found: ${fullPath}`);
        throw new Error(`Shader file not found: ${shaderPath}`);
      }
      const content = fs.readFileSync(fullPath, 'utf-8');
      return content;
    } else {
      // Multi-pass shader: shaderPath is the base name (e.g., "shaders/myEffect")
      // Use loadMultiPassShader from superColliderManager.js
      console.log(`Loading multi-pass shader content for base: ${shaderPath}`);
      const multiPassConfig = loadMultiPassShader(shaderPath, effectsRepoPath);
      if (!multiPassConfig || Object.keys(multiPassConfig).length === 0 || !multiPassConfig.image) {
          throw new Error(`Failed to load multi-pass shader or image pass missing for ${shaderPath}`);
      }
      return multiPassConfig; // Return the object with all shader passes
    }
  } catch (error) {
    console.error(`Error loading shader content for ${shaderPath}:`, error);
    throw error; // Propagate error to renderer
  }
});

// Add this IPC handler for loading visualizer content using shared logic
ipcMain.handle('load-visualizer-content', async (event, visualizerPath) => {
  try {
    const result = loadVisualizerContent(visualizerPath, getEffectsRepoPath);
    if (result.error) {
      throw new Error(result.error);
    }
    return result; // Return { type, content }
  } catch (error) {
    console.error(`Error loading visualizer content for ${visualizerPath}:`, error);
    throw error;
  }
});

// Handler for loading SC files
ipcMain.on('load-sc-file', (event, filePath) => {
    loadScFile(filePath, getEffectsRepoPath, mainWindow, broadcast);
});

// --- Claude Code SDK Integration ---
const ClaudeManager = require('./claudeManager');
let claudeManager;

// Initialize Claude manager
function initializeClaudeManager() {
    // Pass state getters to ClaudeManager for context injection
    const stateGetters = {
        getSynths: () => synths,
        getAvailableVisualizers: () => getAvailableVisualizers(getEffectsRepoPath()),
        getCurrentEffectSnapshot: getActiveEffectSnapshot,
        getActiveVisualizerSnapshot: getActiveVisualizerSnapshot
    };
    
    claudeManager = new ClaudeManager(getEffectsRepoPath(), stateGetters);
    if (mainWindow) {
        claudeManager.setMainWindow(mainWindow);
    }
}

// Add main Claude message handler
ipcMain.on('send-to-claude', async (event, message) => {
    if (!claudeManager) {
        initializeClaudeManager();
    }
    await claudeManager.handleMessage(message);
});

// Add session reset handler
ipcMain.on('reset-claude-session', () => {
    if (!claudeManager) {
        initializeClaudeManager();
    }
    claudeManager.handleSessionReset();
});

// Add cancel handler
ipcMain.on('cancel-claude', async () => {
    if (!claudeManager) {
        initializeClaudeManager();
    }
    await claudeManager.cancelCurrentRequest();
});

// Using optimized --continue approach - no toggle needed

function setupRemoteVisualizerBroadcasting() {
  console.log('[RemoteBroadcast] Setting up centralized WebSocket broadcasting');
  
  // Intercept all shader-related IPC messages to the frontend and auto-broadcast them
  const originalSend = mainWindow.webContents.send;
  mainWindow.webContents.send = function(channel, ...args) {
    // Call the original send first
    originalSend.call(this, channel, ...args);
    
    // Then check if we should broadcast to remote clients
    if (channel === 'shader-effect-updated' || channel === 'auto-visualizer-loaded') {
      const data = args[0];
      if (data && (data.shaderPath || data.path) && (data.shaderContent || data.content)) {
        console.log('[RemoteBroadcast] Auto-broadcasting shader update:', data.shaderPath || data.path);
        broadcast({
          type: 'shaderUpdate',
          payload: {
            shaderPath: data.shaderPath || data.path,
            shaderContent: data.shaderContent || data.content
          }
        });
      }
    } else if (channel === 'visual-effect-updated') {
      // For p5.js updates, we don't broadcast since remote only handles shaders
      console.log('[RemoteBroadcast] P5.js visual update detected, not broadcasting (remote only supports shaders)');
    }
  };
  
  console.log('[RemoteBroadcast] Centralized broadcasting setup complete');
}
// ========================= Effects Store (SSOT) =========================
// Canonical store for effects specs and live param values
const effectsStore = {
  byName: {},
  activeEffectName: null
};

// Legacy compatibility helper - use getActiveEffectSnapshot() instead
function getCurrentEffectFromStore() {
  const snapshot = getActiveEffectSnapshot();
  if (!snapshot) return null;
  // Find the synth object from the synths array to maintain legacy format
  return synths.find(s => s.name === snapshot.name) || null;
}

function ensureEffectInStore(effectName, scFilePath) {
  if (!effectsStore.byName[effectName]) {
    effectsStore.byName[effectName] = {
      name: effectName,
      scFilePath: scFilePath || null,
      paramSpecs: {},
      paramValues: {}
    };
  } else if (scFilePath && !effectsStore.byName[effectName].scFilePath) {
    effectsStore.byName[effectName].scFilePath = scFilePath;
  }
}

function initializeEffectsStoreFromSynths(allSynths) {
  (allSynths || []).forEach(s => ensureEffectInStore(s.name, s.scFilePath));
}

function updateParamSpecs(effectName, specs) {
  ensureEffectInStore(effectName);
  effectsStore.byName[effectName].paramSpecs = specs || {};
}

function initializeParamValuesFromSpecs(effectName) {
  const effect = effectsStore.byName[effectName];
  if (!effect) return;
  const specs = effect.paramSpecs || {};
  effect.paramValues = effect.paramValues || {};
  Object.entries(specs).forEach(([paramName, spec]) => {
    if (typeof effect.paramValues[paramName] === 'undefined' && spec && typeof spec.default !== 'undefined') {
      effect.paramValues[paramName] = spec.default;
    }
  });
}

function clampParam(effectName, paramName, value) {
  const spec = effectsStore.byName?.[effectName]?.paramSpecs?.[paramName];
  if (!spec) return { value, clamped: false, known: false };
  
  // Parameter clamping with validation
  
  const min = typeof spec.minval === 'number' ? spec.minval : value;
  const max = typeof spec.maxval === 'number' ? spec.maxval : value;
  const clampedValue = Math.max(min, Math.min(max, value));
  return { value: clampedValue, clamped: clampedValue !== value, known: true };
}

function getActiveEffectSnapshot() {
  const name = effectsStore.activeEffectName;
  if (!name) return null;
  const e = effectsStore.byName[name];
  if (!e) return null;
  return {
    name: e.name,
    scFilePath: e.scFilePath,
    paramSpecs: e.paramSpecs || {},
    paramValues: e.paramValues || {}
  };
}

function broadcastEffectsState(targetEffectName) {
  if (!mainWindow || !mainWindow.webContents) return;
  const name = typeof targetEffectName === 'string' ? targetEffectName : effectsStore.activeEffectName;
  const effect = name ? effectsStore.byName[name] : null;
  const payload = {
    activeEffectName: effectsStore.activeEffectName,
    effect: effect ? {
      name: effect.name,
      scFilePath: effect.scFilePath,
      paramSpecs: effect.paramSpecs,
      paramValues: effect.paramValues
    } : null
  };
  mainWindow.webContents.send('effects/state', payload);
}

function sendOscParamSet(paramName, value) {
  try {
    if (!oscManager || !oscManager.oscServer) return;
    if (!global.scPortConfig) return;
    const scHost = '127.0.0.1';
    const scPort = global.scPortConfig.lang;
    const typedArgs = [
      { type: 's', value: String(paramName) },
      { type: 'f', value: Number(value) }
    ];
    oscManager.oscServer.send({ address: '/effect/param/set', args: typedArgs }, scHost, scPort);
  } catch (err) {
    console.error('Error sending OSC param set:', err);
  }
}

function tryApplyAllParamsToSC(effectName) {
  const effect = effectsStore.byName?.[effectName];
  if (!effect || !effect.paramValues) return;
  Object.entries(effect.paramValues).forEach(([paramName, value]) => {
    sendOscParamSet(paramName, value);
  });
}

function setCurrentEffectAction({ name }) {
  if (!name) return { error: 'Missing effect name' };
  const found = synths.find(s => s.name === name);
  if (!found) return { error: `Effect '${name}' not found` };
  ensureEffectInStore(name, found.scFilePath);
  effectsStore.activeEffectName = name;
  activeAudioSourcePath = found.scFilePath;
  // Load SC and request specs; apply will happen when specs are received
  loadScFileAndRequestSpecs(found.scFilePath).catch(err => console.error('Error loading SC on set_current_effect:', err));
  broadcastEffectsState(name);
  return { ok: true };
}

function setEffectParametersAction({ name, params, fromMidi = false }) {
  const targetName = name || effectsStore.activeEffectName;
  if (!targetName) return { error: 'No active effect and no name provided' };
  if (!params || typeof params !== 'object') return { error: 'params must be an object' };
  
  // Set effect parameters with validation
  
  ensureEffectInStore(targetName);
  const effect = effectsStore.byName[targetName];
  const valid = {};
  const invalid = {};
  const clampedInfo = {};
  Object.entries(params).forEach(([k, v]) => {
    if (typeof v !== 'number' || Number.isNaN(v)) {
      invalid[k] = v;
      // Invalid parameter value
      return;
    }
    const { value, clamped, known } = clampParam(targetName, k, v);
    if (!known) {
      invalid[k] = v;
      // Unknown parameter for this effect
      return;
    }
    valid[k] = value;
    if (clamped) {
      clampedInfo[k] = { requested: v, applied: value };
      // Parameter value clamped to valid range
    }
  });
  
  // Update effect parameters in store
  
  // Update store and send OSC for each valid change
  Object.entries(valid).forEach(([k, v]) => {
    effect.paramValues[k] = v;
    // Only send OSC to SC if not from MIDI (to avoid feedback loop)
    if (!fromMidi) {
      sendOscParamSet(k, v);
    }
  });
  // Always broadcast to UI - UI is read-only and won't send values back
  broadcastEffectsState(targetName);
  return { ok: true, invalid, clamped: clampedInfo };
}

// Wrapper to load effects and sync the central store
function loadEffectsListAndInitStore(mainWindowArg, getEffectsRepoPathArg, getEffectsPathArg) {
  const result = loadEffectsList(mainWindowArg, getEffectsRepoPathArg, getEffectsPathArg);
  try { initializeEffectsStoreFromSynths(result); } catch (e) { console.warn('Failed to initialize effects store from synths:', e); }
  broadcastEffectsState(effectsStore.activeEffectName);
  return result;
}

// IPC: Actions and Queries for effects
ipcMain.on('effects/actions:set_current_effect', (event, payload) => {
  const res = setCurrentEffectAction(payload || {});
  if (res && res.error) console.warn('[IPC] set_current_effect error:', res.error);
});

ipcMain.on('effects/actions:set_effect_parameters', (event, payload) => {
  const res = setEffectParametersAction(payload || {});
  if (res && res.error) console.warn('[IPC] set_effect_parameters error:', res.error);
});

ipcMain.handle('effects/queries:get_current_effect', () => {
  return getActiveEffectSnapshot();
});

// ======================================================================

// ========================= Visualizers Store (SSOT) =========================
// Canonical store for visualizers following the same pattern as effects
const visualizersStore = {
  byName: {},
  activeVisualizerName: null
};

function ensureVisualizerInStore(visualizerName, path, type) {
  if (!visualizersStore.byName[visualizerName]) {
    visualizersStore.byName[visualizerName] = {
      name: visualizerName,
      path: path || null,
      type: type || null,
      content: null
    };
  } else {
    if (path && !visualizersStore.byName[visualizerName].path) {
      visualizersStore.byName[visualizerName].path = path;
    }
    if (type && !visualizersStore.byName[visualizerName].type) {
      visualizersStore.byName[visualizerName].type = type;
    }
  }
}

// Currently unused - might be useful for bulk initialization later
// function initializeVisualizersStoreFromList(allVisualizers) {
//   (allVisualizers || []).forEach(v => ensureVisualizerInStore(v.name, v.path, v.type));
// }

function getActiveVisualizerSnapshot() {
  const name = visualizersStore.activeVisualizerName;
  if (!name) return null;
  const v = visualizersStore.byName[name];
  if (!v) return null;
  return {
    name: v.name,
    path: v.path,
    type: v.type,
    content: v.content
  };
}

function broadcastVisualizersState(targetVisualizerName) {
  if (!mainWindow || !mainWindow.webContents) return;
  const name = typeof targetVisualizerName === 'string' ? targetVisualizerName : visualizersStore.activeVisualizerName;
  const visualizer = name ? visualizersStore.byName[name] : null;
  const payload = {
    activeVisualizerName: visualizersStore.activeVisualizerName,
    visualizer: visualizer ? {
      name: visualizer.name,
      path: visualizer.path,
      type: visualizer.type,
      content: visualizer.content
    } : null
  };
  mainWindow.webContents.send('visualizers/state', payload);
}

async function loadAndBroadcastVisualizerContent(visualizerName) {
  const v = visualizersStore.byName[visualizerName];
  if (!v || !v.path) return;
  
  try {
    const result = await loadVisualizerContent(v.path, getEffectsRepoPath);
    
    // Extract the actual content from the result object
    if (result && result.content) {
      v.content = result.content;
    } else if (result && result.error) {
      console.error(`[loadAndBroadcastVisualizerContent] Error loading ${visualizerName}: ${result.error}`);
      v.content = null;
    } else {
      v.content = null;
    }
    
    // Broadcast the unified state (which now includes content)
    broadcastVisualizersState(visualizerName);
    
    // No need to send separate events - the unified state has everything
  } catch (error) {
    console.error('Error loading visualizer content:', error);
    // Still broadcast state even on error so UI knows something changed
    broadcastVisualizersState(visualizerName);
  }
}

function setCurrentVisualizerAction({ name }) {
  if (!name) return { error: 'Missing visualizer name' };
  
  // Get fresh list of visualizers
  const effectsRepoPath = getEffectsRepoPath();
  const availableVisualizers = getAvailableVisualizers(effectsRepoPath);
  const found = availableVisualizers.find(v => v.name === name);
  
  if (!found) return { error: `Visualizer '${name}' not found` };
  
  ensureVisualizerInStore(name, found.path, found.type);
  visualizersStore.activeVisualizerName = name;
  activeVisualSourcePath = found.path;
  
  // Load content and broadcast only once with everything
  loadAndBroadcastVisualizerContent(name).catch(err => 
    console.error('Error loading visualizer on set_current_visualizer:', err)
  );
  
  return { ok: true };
}

function getVisualizersListAction() {
  const effectsRepoPath = getEffectsRepoPath();
  return getAvailableVisualizers(effectsRepoPath);
}

// IPC: Actions and Queries for visualizers
ipcMain.on('visualizers/actions:set_current_visualizer', (event, payload) => {
  const res = setCurrentVisualizerAction(payload || {});
  if (res && res.error) console.warn('[IPC] set_current_visualizer error:', res.error);
});

ipcMain.handle('visualizers/queries:get_current_visualizer', () => {
  return getActiveVisualizerSnapshot();
});

ipcMain.handle('visualizers/queries:list_visualizers', () => {
  return { visualizers: getVisualizersListAction() };
});

// ======================================================================


