// Key Prioritized Tasks TODO:
/*
 ** Start a FRESH REPO that can be public...
 -- this repo should have all API keys stripped out and git reset to zero
 ** @use-gesture/react
 ** Fresh SD Card build with no credentials
 -- make sure credentials in git are wiped
 -- hook back up the startup script. Otherwise, keep it pretty vanilla.
 ** Figure out why we leak memory
 -- try a version that doesn't load sketches
 -- then try a version that doesn't load synths
 ** WIFI login from device
 ** Just pull new effects on startup maybe?
   - Display the Pi's IP address on-screen for easy connection.
 **WiFi and Effects Update Buttons**
   - Add a button for connecting the pedal to a local WiFi network.

   Not Necessary:
 ** Long ribbon cable for display
 ** Get touch working on that small display

*/


const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const util = require('util');
const OSC = require('osc');
const chokidar = require('chokidar');
const { exec } = require('child_process');
const os = require('os');
const networkInterfaces = os.networkInterfaces();
const openaiApiKey = process.env.OPENAI_API_KEY;

let mainWindow;
let sclang;
let serverBooted = false;
let synths = [];
let oscServer;
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
const isDev = !app.isPackaged;

// Enable live reload for Electron
if (isDev)
{
  try
  {
    require('electron-reload')(__dirname, {
      electron: path.join(__dirname, 'node_modules', '.bin', 'electron'),
      hardResetMethod: 'exit'
    });
  } catch (err)
  {
    console.log('Error loading electron-reload. This is fine in production.', err);
  }
}

function createWindow()
{
  console.log('Creating main window...');

  const isRaspberryPi = process.platform === 'linux' && process.arch === 'arm';

  let windowOptions = {
    width: 800,
    height: 480,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      enableRemoteModule: true,
      worldSafeExecuteJavaScript: true,
      preload: path.join(__dirname, 'preload.js')
    },
  };

  if (isRaspberryPi || (isDev && process.env.FULLSCREEN === 'true'))
  {
    windowOptions.fullscreen = true;
  } else
  {
    // Center the window on macOS or in dev mode
    windowOptions.center = true;
  }

  mainWindow = new BrowserWindow(windowOptions);

  // Load the index.html from a url
  mainWindow.loadURL(
    isDev
      ? 'http://localhost:3000'
      : `file://${path.join(__dirname, './build/index.html')}`
  );

  // Open the DevTools in development mode
  if (isDev)
  {
    mainWindow.webContents.openDevTools();
  }

  // Initialize SuperCollider
  initializeSuperCollider();

  // Initialize OSC Server after creating the window
  initializeOSCServer();

  // Set up file watcher for hot reloading
  setupEffectsWatcher();
}

function initializeOSCServer()
{
  oscServer = new OSC.UDPPort({
    localAddress: '127.0.0.1',
    localPort: 57121, // Match the port used in SuperCollider
    metadata: true
  });

  oscServer.on('ready', () =>
  {
    console.log('OSC Server is ready');
  });

  oscServer.on('message', (oscMsg) =>
  {
    oscMessageCount++;
    //oscDataBytes += calculateMessageSize(oscMsg);

    if (oscMsg.address === '/audio_analysis')
    {
      // Extract the RMS input and output values
      const rmsInput = oscMsg.args[0].value;
      const rmsOutput = oscMsg.args[1].value;

      // Send the RMS values to the renderer process
      mainWindow.webContents.send('audio-analysis', { rmsInput, rmsOutput });
    } else if (oscMsg.address === '/waveform0' || oscMsg.address === '/waveform1')
    {
      // Keep the existing waveform handling
      const waveformData = oscMsg.args.map(arg => arg.value);
      const eventName = oscMsg.address === '/waveform0' ? 'waveform0-data' : 'waveform1-data';
      mainWindow.webContents.send(eventName, waveformData);

    }
    else if (oscMsg.address === '/fft_data0' || oscMsg.address === '/fft_data1')
    {
      // Keep the existing waveform handling
      const fftData = oscMsg.args.map(arg => arg.value);
      const eventName = oscMsg.address === '/fft_data0' ? 'fft0-data' : 'fft1-data';
      mainWindow.webContents.send(eventName, fftData);
    }
    else if (oscMsg.address === '/tuner_data')
    {
      // console.log('Received OSC message:', oscMsg);
      // Handle tuner data
      const freq = oscMsg.args[0].value; 
      const hasFreq = oscMsg.args[1].value;
      const differences = oscMsg.args.slice(2, 8).map(arg => arg.value); // Differences for six strings
      const amplitudes = oscMsg.args.slice(8, 14).map(arg => arg.value); // Amplitudes for six strings

      // Send the tuner data to the renderer process
      mainWindow.webContents.send('tuner-data', {
        freq: freq,
        hasFreq: hasFreq,
        differences: differences,
        amplitudes: amplitudes
      });
    }
  });

  oscServer.open();

  // Set up interval to log messages and data per second
  // setInterval(logOscStats, 1000);
}

function calculateMessageSize(oscMsg) {
  // Estimate the size of the OSC message
  let size = oscMsg.address.length;
  for (let arg of oscMsg.args) {
    if (arg.value !== undefined) {
      size += String(arg.value).length;
    }
  }
  return size;
}

function logOscStats() {
  const now = Date.now();
  const elapsedSeconds = (now - lastOscCountResetTime) / 1000;
  const messagesPerSecond = oscMessageCount / elapsedSeconds;
  const dataRate = oscDataBytes / elapsedSeconds;

  console.log(`OSC Messages/sec: ${messagesPerSecond.toFixed(2)}`);
  console.log(`OSC Data Rate: ${dataRate.toFixed(2)} bytes/sec`);

  // Reset the counters and timer
  oscMessageCount = 0;
  oscDataBytes = 0;
  lastOscCountResetTime = now;
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
    console.log(`SC stdout: ${data}`);
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
    console.log(`Sending to SuperCollider:\n${sclangFriendlyFormatting}`);
    sclang.stdin.write(sclangFriendlyFormatting);

    console.log(`to sclang:\n${sclangFriendlyFormatting}`);
    sclang.stdin.write(sclangFriendlyFormatting);

    // Set up a one-time listener for the sclang output
    sclang.stdout.once('data', (data) =>
    {
      const output = data.toString();
      console.log('from sclang:', output);
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

  console.log('Effects list loaded and reloaded:', synths);

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
    console.log(`Attempting to load p5 sketch from: ${fullPath}`);

    if (!fs.existsSync(fullPath))
    {
      console.error(`Sketch file not found: ${fullPath}`);
      return null;
    }

    const content = fs.readFileSync(fullPath, 'utf-8');
    console.log(`Successfully loaded p5 sketch: ${sketchPath}`);
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

app.whenReady().then(createWindow);

app.on('window-all-closed', () =>
{
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

ipcMain.on('request-effects', (event) =>
{
  console.log('Received request for effects');
  try
  {
    const loadedSynths = loadEffectsList();
    // Ensure we're sending valid data
    const validSynths = loadedSynths.filter(synth => synth && synth.name);
    console.log('Effects data to be sent:', validSynths);
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

app.on('will-quit', () =>
{
  logStream.end();
  if (oscServer)
  {
    oscServer.close();
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
      console.log(`File content: ${fileContent}`);

      const newEffectData = JSON.parse(fileContent);
      console.log(`Parsed effect data:`, newEffectData);

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

ipcMain.on('pull-effects-repo', (event) =>
{
  console.log('Received pull-effects-repo request');
  const effectsPath = getEffectsPath();
  console.log('Effects path:', effectsPath);

  exec('git pull', { cwd: effectsPath }, (error, stdout, stderr) =>
  {
    if (error)
    {
      console.error(`Error pulling effects repo: ${error}`);
      console.error(`stderr: ${stderr}`);
      event.reply('pull-effects-repo-result', { success: false, message: error.message });
      return;
    }
    console.log(`Git pull output: ${stdout}`);
    event.reply('pull-effects-repo-result', { success: true, message: stdout });

    // Reload all effects
    loadEffectsList();

    console.log('All effects reloaded after Git pull');
  });
});

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

ipcMain.on('get-ip-address', (event) => {
  console.log("Received get-ip-address request");
  const ipAddress = getIPAddress();
  console.log(`Sending IP Address: ${ipAddress}`);
  event.reply('ip-address-reply', ipAddress);
});

ipcMain.handle('get-openai-key', () => {
  return openaiApiKey;
});

