const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const util = require('util');
const chokidar = require('chokidar');
const { exec } = require('child_process');
const os = require('os');
const networkInterfaces = os.networkInterfaces();
const openaiApiKey = process.env.OPENAI_API_KEY;
const OSCManager = require('./oscManager');

let mainWindow;
let sclang;
let serverBooted = false;
let synths = [];
let oscManager;
let currentEffect = null;
let oscMessageCount = 0;
let oscDataBytes = 0;
let lastOscCountResetTime = Date.now();

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
  originalConsoleLog.apply(console, arguments);
};

console.error = function ()
{
  logStream.write('ERROR: ' + util.format.apply(null, arguments) + '\n');
  originalConsoleError.apply(console, arguments);
};

function getEffectsPath()
{
  return app.getPath("home") + '/bice-box-effects';
}

function getFullInitFilePath()
{
  return getEffectsPath() + '/utilities/init.sc';
}

console.log('Is app packaged?', app.isPackaged);
console.log("NODE_ENV:", process.env.NODE_ENV);
console.log('Home path:', app.getPath("home"));
console.log('Effects path:', getEffectsPath());

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
    require('electron-reloader')(module);
  } catch (err)
  {
    console.log('Error loading electron-reloader. This is fine in production.', err);
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

  console.log('Window options:', windowOptions);
  console.log('Creating BrowserWindow...');
  
  try {
    mainWindow = new BrowserWindow(windowOptions);
    console.log('BrowserWindow created successfully');

    const loadUrl = isDev ? 'http://localhost:3000' : `file://${path.join(__dirname, '../build/index.html')}`;
    console.log('Loading URL:', loadUrl);

    mainWindow.loadURL(loadUrl);
    console.log('URL loaded');

    mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
      console.error('Failed to load:', errorCode, errorDescription);
    });

    mainWindow.webContents.on('did-finish-load', () => {
      console.log('Content finished loading');
    });

    mainWindow.webContents.on('dom-ready', () => {
      console.log('DOM is ready');
      if (isLinux) {
        mainWindow.webContents.insertCSS('* { cursor: none !important; }');
      }
    });

    if (isDev) {
      console.log('Opening DevTools');
      mainWindow.webContents.openDevTools();
    }

    mainWindow.once('ready-to-show', () => {
      console.log('Window ready to show');
      mainWindow.show();
      console.log('Window shown');
    });

  } catch (error) {
    console.error('Error creating window:', error);
  }

  // Initialize SuperCollider
  initializeSuperCollider();

  // Initialize OSC Server after creating the window
  oscManager = new OSCManager(mainWindow);
  oscManager.initialize();

  // Set up file watcher for hot reloading
  setupEffectsWatcher();
}

function initializeSuperCollider()
{
  console.log('Initializing SuperCollider...');

  let sclangPath;
  try
  {
    sclangPath = getSclangPath();
  } catch (error)
  {
    console.error('Failed to get sclang path:', error);
    mainWindow.webContents.send('sc-error', 'SuperCollider (sclang) not found in resources');
    return;
  }

  console.log(`Using sclang from: ${sclangPath}`);

  try
  {
    sclang = spawn(sclangPath);
  } catch (error)
  {
    console.error('Failed to start SuperCollider:', error);
    mainWindow.webContents.send('sc-error', 'Failed to start SuperCollider.');
    return;
  }

  sclang.stdout.on('data', (data) =>
  {
    // console.log(`SC stdout: ${data}`);
    mainWindow.webContents.send('sclang-output', data.toString());

    if (data.toString().includes('Server booted successfully.'))
    {
      console.log('SuperCollider server is running');
      if (!serverBooted)
      {
        console.log('SuperCollider server is running');
        mainWindow.webContents.send('sc-ready');
        loadEffectsList();
      }
    }
  });

  sclang.stderr.on('data', (data) =>
  {
    console.error(`SC stderr: ${data}`);
    mainWindow.webContents.send('sclang-error', data.toString());
  });

  sclang.on('close', (code) =>
  {
    console.log(`sclang process exited with code ${code}`);
    serverBooted = false;
  });

  bootSuperColliderServer();
}

async function bootSuperColliderServer()
{
  const startupFilePath = getFullInitFilePath();
  console.log(`Loading startup file from: ${startupFilePath}`);

  const scCommand = `("${startupFilePath}").load;`;

  sendCodeToSclang(scCommand)
    .then(result => console.log('Startup file loaded successfully:', result))
    .catch(error => console.error('Error loading startup file:', error));
}

function sendCodeToSclang(code)
{
  return new Promise((resolve, reject) =>
  {
    if (!sclang)
    {
      console.error('SuperCollider is not initialized');
      reject('SuperCollider is not initialized');
      return;
    }
    if (!code || code === "")
    {
      console.log('Received empty or null code. Skipping SuperCollider execution.');
      resolve('No code to execute');
      return;
    }

    let sclangFriendlyFormatting = code.trim();
    sclangFriendlyFormatting += '\n';
    // SuperCollider:\n${sclangFriendlyFormatting}`);
    sclang.stdin.write(sclangFriendlyFormatting);

    //console.log(`to sclang:\n${sclangFriendlyFormatting}`);
    sclang.stdin.write(sclangFriendlyFormatting);

    // Set up a one-time listener for the sclang output
    sclang.stdout.once('data', (data) =>
    {
      const output = data.toString();
      //console.log('from sclang:', output);
      resolve(output);
    });

    // Set up error handling
    sclang.stderr.once('data', (data) =>
    {
      console.error(`sclang stderr: ${data}`);
      reject(data.toString());
    });
  });
}

// Helper function to parse sclang output
function parseDevicesFromSclang(output)
{
  console.log('Parsing SuperCollider output:', output);

  if (typeof output !== 'string')
  {
    console.error('Unexpected output type:', typeof output);
    return [];
  }

  const match = output.match(/\[(.*?)\]/);
  if (match)
  {
    const devices = match[1].split(',').map(device => device.trim().replace(/^"|"$/g, ''));
    console.log('Parsed devices:', devices);
    return devices;
  }

  console.log('No devices found in output');
  return [];
}

function loadEffectsList()
{
  console.log('Loading effects list...');
  const effectsPath = getEffectsPath();
  const effectFiles = fs.readdirSync(effectsPath).filter(file => file.endsWith('.json'));

  synths = effectFiles.map(file =>
  {
    const filePath = path.join(effectsPath, file);
    const effect = loadEffectFromFile(filePath);

    /*
    // Reload SuperCollider file
    if (effect.scFilePath) {
      console.log(`Loading SC file for ${effect.name}: ${effect.scFilePath}`);
      loadScFile(effect.scFilePath);
    }
    */

    // Reload p5.js sketch
    if (effect.p5SketchPath)
    {
      console.log(`Reloading p5.js sketch for ${effect.name}: ${effect.p5SketchPath}`);
      effect.p5SketchContent = loadP5SketchSync(effect.p5SketchPath);
    }

    return effect;
  });

  //console.log('Effects list loaded and reloaded:', synths);

  // Notify renderer about updated effects
  if (mainWindow && mainWindow.webContents)
  {
    mainWindow.webContents.send('effects-updated', synths);
  }

  return synths;
}

// Update the loadEffectFromFile function to include full paths
function loadEffectFromFile(filePath)
{
  const synthData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  return {
    name: synthData.name,
    scFilePath: synthData.audio,
    p5SketchPath: synthData.visual,
    p5SketchContent: loadP5SketchSync(synthData.visual),
    params: synthData.params
  };
}

// Add this synchronous function to load the p5.js sketch
function loadP5SketchSync(sketchPath)
{
  try
  {
    const effectsPath = getEffectsPath();
    const fullPath = path.join(effectsPath, sketchPath);
    //console.log(`Attempting to load p5 sketch from: ${fullPath}`);

    if (!fs.existsSync(fullPath))
    {
      console.error(`Sketch file not found: ${fullPath}`);
      return null;
    }

    const content = fs.readFileSync(fullPath, 'utf-8');
    //console.log(`Successfully loaded p5 sketch: ${sketchPath}`);
    return content;
  } catch (error)
  {
    console.error(`Error loading p5 sketch: ${error}`);
    return null;
  }
}

// Add this IPC handler for loading p5 sketches
ipcMain.handle('load-p5-sketch', async (event, sketchPath) =>
{
  return loadP5SketchSync(sketchPath);
});

ipcMain.on('load-sc-file', (event, filePath) =>
{
  loadScFile(filePath);
});

function loadScFile(filePath)
{
  // Ensure filePath is relative to the effects directory
  const scFilePath = path.join(getEffectsPath(), filePath);
  //const relativePath = path.relative(effectsPath, filePath);

  console.log(`Loading SC file: ${scFilePath}`);

  const scCommand = `("${scFilePath}").load;`;

  sendCodeToSclang(scCommand)
    .then(result => console.log('SC file load result:', result))
    .catch(error => console.error('Error loading SC file:', error));
}

app.whenReady().then(() => {
  console.log('App is ready');
  // Add check for electron.js file
  const electronJsPath = path.join(__dirname, '../electron/main.js');
  if (!fs.existsSync(electronJsPath)) {
    console.error(`ERROR: electron.js not found at ${electronJsPath}`);
    console.error('This may cause startup issues. Make sure the file is being copied correctly during build.');
  } else {
    console.log(`electron.js found at ${electronJsPath}`);
  }
  
  createWindow();
  console.log('Window creation initiated');
}).catch(error => {
  console.error('Error in app.whenReady():', error);
});

app.on('window-all-closed', () => {
  if (oscManager) {
    oscManager.close();
  }
  if (process.platform !== 'darwin') {
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

ipcMain.on('reload-all-effects', (event) =>
{
  console.log('Reloading all effects...');
  try
  {
    const loadedSynths = loadEffectsList();
    const validSynths = loadedSynths.filter(synth => synth && synth.name);
    //console.log('Effects data to be sent:', validSynths);
    event.reply('effects-data', validSynths);
    console.log('Effects data sent to renderer process');
  } catch (error)
  {
    console.error('Error loading or sending effects data:', error);
    event.reply('effects-error', error.message);
  }
});

ipcMain.on('get-audio-devices', async (event) =>
{
  console.log('Fetching audio devices...');
  try
  {
    let rawDevices = await sendCodeToSclang('ServerOptions.devices;');
    let devices = parseDevicesFromSclang(rawDevices);

    console.log('Raw devices from SuperCollider:', devices);
    // remove duplicate devices
    devices = [...new Set(devices.filter(device => device.trim() !== ''))];

    console.log('Parsed devices:', devices);
    event.reply('audio-devices-reply', devices);
  } catch (error)
  {
    console.error('Error fetching audio devices:', error);
    event.reply('audio-devices-reply', []); // Send an empty array instead of undefined
  }
});

ipcMain.on('set-audio-devices', async (event, { inputDevice, outputDevice }) =>
{
  try
  {
    if (inputDevice)
    {
      await sendCodeToSclang(`Server.default.options.inDevice_("${inputDevice}");`);
    }
    if (outputDevice)
    {
      await sendCodeToSclang(`Server.default.options.outDevice_("${outputDevice}");`);
    }
    await sendCodeToSclang('Server.default.reboot;'); // Reboot the server to apply changes
    event.reply('audio-devices-set', 'Audio devices set successfully');
  } catch (error)
  {
    console.error('Error setting audio devices:', error);
    event.reply('sc-error', 'Failed to set audio devices');
  }
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
        bootSuperColliderServer();
      }, 1000); // Wait for 1 second before rebooting
    })
    .catch((error) =>
    {
      console.error('Error sending Server.killAll command:', error);
      // Still attempt to reboot even if the kill command fails
      setTimeout(() =>
      {
        bootSuperColliderServer();
      }, 1000);
    });
});

app.on('will-quit', async () =>
{
  console.log('Application shutting down...');

  // Kill SuperCollider servers
  if (sclang)
  {
    try
    {
      console.log('Shutting down SuperCollider servers...');
      await sendCodeToSclang('Server.killAll;');
      console.log('SuperCollider servers killed successfully');

      // Kill the sclang process
      sclang.kill();
      console.log('sclang process terminated');
    } catch (error)
    {
      console.error('Error shutting down SuperCollider:', error);
    }
  }

  // Close OSC server
  if (oscManager)
  {
    oscManager.close();
    console.log('OSC server closed');
  }

  logStream.end();
  if (oscManager)
  {
    oscManager.close();
  }
});

function getSclangPath()
{
  const possiblePaths = [
    // Linux (including Raspberry Pi) paths
    '/usr/bin/sclang',
    '/usr/local/bin/sclang',
    '/opt/SuperCollider/bin/sclang',
    // macOS path
    '/Applications/SuperCollider.app/Contents/MacOS/sclang'
  ];

  for (const path of possiblePaths)
  {
    if (fs.existsSync(path))
    {
      return path;
    }
  }

  throw new Error('sclang not found in any of the expected paths');
}

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
  const effectsPath = getEffectsPath();
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
  const relativeChangedPath = path.relative(getEffectsPath(), changedPath);
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
    default:
      console.log(`Unhandled file type: ${extension}`);
  }
}

function reloadFullEffect(jsonPath)
{
  console.log(`Reloading full effect from: ${jsonPath}`);
  const effectName = path.basename(jsonPath, '.json');
  const effectIndex = synths.findIndex(synth => synth.name === effectName);

  if (effectIndex !== -1)
  {
    try
    {
      console.log(`Reading JSON file: ${jsonPath}`);
      const fileContent = fs.readFileSync(jsonPath, 'utf8');
      //console.log(`File content: ${fileContent}`);

      const newEffectData = JSON.parse(fileContent);
      //console.log(`Parsed effect data:`, newEffectData);

      // Update the effect in the synths array
      const updatedEffect = {
        name: newEffectData.name || effectName,
        scFilePath: newEffectData.audio,
        p5SketchPath: newEffectData.visual,
        p5SketchContent: loadP5SketchSync(newEffectData.visual),
        params: newEffectData.params || []
      };
      console.log(`Updated effect object:`, updatedEffect);

      synths[effectIndex] = updatedEffect;

      // Reload SuperCollider file
      if (updatedEffect.scFilePath)
      {
        console.log(`Loading SC file: ${updatedEffect.scFilePath}`);
        loadScFile(updatedEffect.scFilePath);
      } else
      {
        console.warn(`No SC file path provided for effect ${effectName}`);
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

      console.log(`Effect ${effectName} has been reloaded`);
    } catch (error)
    {
      console.error(`Error reloading effect ${effectName}:`, error);
      console.error(error.stack);
    }
  } else
  {
    console.warn(`Effect ${effectName} not found in synths array`);
    console.log('Current synths:', synths.map(s => s.name));
  }
}

function reloadAudioEffect(scFilePath)
{
  console.log(`Reloading audio effect: ${scFilePath}`);
  const affectedEffect = synths.find(synth => synth.scFilePath === scFilePath);

  if (affectedEffect)
  {
    console.log(`Reloading audio for effect: ${affectedEffect.name}`);
    loadScFile(scFilePath);
  } else
  {
    console.log(`No effect found using SC file: ${scFilePath}`);
  }
}

function reloadVisualEffect(jsFilePath)
{
  console.log(`Reloading visual effect: ${jsFilePath}`);
  const currentEffect = getCurrentEffect();
  console.log('Current effect:', currentEffect ? currentEffect.name : 'None');
  console.log('Current effect p5SketchPath:', currentEffect ? currentEffect.p5SketchPath : 'None');

  if (currentEffect)
  {
    // Compare the relative paths
    const currentSketchPath = path.relative(getEffectsPath(), currentEffect.p5SketchPath);
    const changedFilePath = path.relative(getEffectsPath(), jsFilePath);
    console.log('Comparing paths:', currentSketchPath, changedFilePath);

    if (currentSketchPath === changedFilePath)
    {
      console.log(`Reloading visual for current effect: ${currentEffect.name}`);
      const updatedSketchContent = loadP5SketchSync(jsFilePath);

      if (updatedSketchContent)
      {
        currentEffect.p5SketchContent = updatedSketchContent;
        console.log('Sending visual-effect-updated event to renderer');
        if (mainWindow && mainWindow.webContents)
        {
          mainWindow.webContents.send('visual-effect-updated', {
            name: currentEffect.name,
            p5SketchContent: updatedSketchContent
          });
        } else
        {
          console.error('mainWindow or webContents is not available');
        }
      } else
      {
        console.error(`Failed to load updated p5 sketch: ${jsFilePath}`);
      }
    } else
    {
      console.log(`Changed JS file is not for the current effect, skipping reload`);
    }
  } else
  {
    console.log('No current effect set, skipping reload');
  }
}

function getCurrentEffect()
{
  return currentEffect;
}

ipcMain.on('set-current-effect', (event, effectName) =>
{
  const effect = synths.find(synth => synth.name === effectName);
  if (effect)
  {
    setCurrentEffect(effect);
  } else
  {
    console.error(`Effect not found: ${effectName}`);
  }
});

function setCurrentEffect(effect)
{
  currentEffect = effect;
  console.log('Current effect set to:', effect ? effect.name : 'None');
}

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
ipcMain.on('pull-effects-repo', async (event) => {
  const effectsPath = getEffectsPath();
  
  try {
    const { stdout: pullOutput } = await exec('git pull', { cwd: effectsPath });
    console.log('Git pull output:', pullOutput);
    
    // After successful pull, reload effects and update status
    loadEffectsList();
    
    // Check status again after pull
    const { stdout: statusOutput } = await exec('git status -uno', { cwd: effectsPath });
    const statusText = statusOutput ? statusOutput.toString() : '';
    const hasUpdates = statusText.includes('behind');
    
    event.reply('effects-repo-status', { hasUpdates });
    event.reply('pull-effects-repo-success', pullOutput.toString());
  } catch (error) {
    console.error('Error pulling effects repo:', error);
    event.reply('pull-effects-repo-error', error.message || 'Unknown error pulling repo');
  }
});

ipcMain.on('check-effects-repo', async (event) => {
  const effectsPath = getEffectsPath();
  console.log('Checking effects repo at:', effectsPath);

  try {
    // Use the shell option to execute git commands through the system shell
    const execOptions = { 
      cwd: effectsPath,
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

  } catch (error) {
    console.error('Error checking effects repo:', error);
    event.reply('effects-repo-error', {
      error: error.message,
      needsAttention: true
    });
  }
});

function execPromise(command, options) {
  return new Promise((resolve, reject) => {
    exec(command, options, (error, stdout, stderr) => {
      if (error) {
        reject(error);
      } else {
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
