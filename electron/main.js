const { app, BrowserWindow, ipcMain } = require('electron');
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
const wifi = require('node-wifi');

let mainWindow;
let oscManager;
let updateAvailable = false;
let devMode = false;

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
    const loadEffectsCallback = () => loadEffectsList(mainWindow, getEffectsRepoPath, getEffectsPath, devMode);
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

app.whenReady().then(() =>
{
  console.log('App is ready');
  // Add check for electron.js file
  const electronJsPath = path.join(__dirname, '../electron/main.js');
  if (!fs.existsSync(electronJsPath))
  {
    console.error(`ERROR: electron.js not found at ${electronJsPath}`);
    console.error('This may cause startup issues. Make sure the file is being copied correctly during build.');
  } else
  {
    console.log(`electron.js found at ${electronJsPath}`);
  }

  createWindow();
  console.log('Window creation initiated');
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
        const loadEffectsCallback = () => loadEffectsList(mainWindow, getEffectsRepoPath, getEffectsPath, devMode);
        initializeSuperCollider(mainWindow, getEffectsRepoPath, loadEffectsCallback);
      }, 1000); // Wait for 1 second before rebooting
    })
    .catch((error) =>
    {
      console.error('Error sending Server.killAll command:', error);
      // Still attempt to reboot even if the kill command fails
      setTimeout(() =>
      {
        const loadEffectsCallback = () => loadEffectsList(mainWindow, getEffectsRepoPath, getEffectsPath, devMode);
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

  logStream.end();
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

      const newEffectData = JSON.parse(fileContent);

      // Update the effect in the synths array
      const updatedEffect = {
        name: newEffectData.name || effectName,
        scFilePath: newEffectData.audio,
        p5SketchPath: newEffectData.visual,
        p5SketchContent: loadP5SketchSync(newEffectData.visual, getEffectsRepoPath),
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
    loadScFile(scFilePath, getEffectsRepoPath, mainWindow);
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
    const currentSketchPath = path.relative(getEffectsRepoPath(), currentEffect.p5SketchPath);
    const changedFilePath = path.relative(getEffectsRepoPath(), jsFilePath);
    console.log('Comparing paths:', currentSketchPath, changedFilePath);

    if (currentSketchPath === changedFilePath)
    {
      console.log(`Reloading visual for current effect: ${currentEffect.name}`);
      const updatedSketchContent = loadP5SketchSync(jsFilePath, getEffectsRepoPath);

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
    const { stdout: pullOutput } = await exec('git pull', { cwd: effectsRepoPath });
    console.log('Git pull output:', pullOutput);

    // After successful pull, reload effects and update status
    loadEffectsList(mainWindow, getEffectsRepoPath, getEffectsPath, devMode);

    // Check status again after pull
    const { stdout: statusOutput } = await exec('git status -uno', { cwd: effectsRepoPath });
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
    const loadedSynths = loadEffectsList(mainWindow, getEffectsRepoPath, getEffectsPath, devMode);
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
    const loadedSynths = loadEffectsList(mainWindow, getEffectsRepoPath, getEffectsPath, devMode);
    event.reply('effects-data', loadedSynths);
});
