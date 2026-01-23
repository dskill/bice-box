const { autoUpdater } = require('electron-updater');
const { ipcMain } = require('electron');

let mainWindow = null;

// Configure auto-updater
autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = true;

// Track update state
let updateInfo = null;

function sendStatusToRenderer(status, data = {}) {
  if (mainWindow && mainWindow.webContents) {
    mainWindow.webContents.send('auto-update-status', { status, ...data });
  }
}

// Event handlers
autoUpdater.on('checking-for-update', () => {
  console.log('[AutoUpdater] Checking for updates...');
  sendStatusToRenderer('checking');
});

autoUpdater.on('update-available', (info) => {
  console.log('[AutoUpdater] Update available:', info.version);
  updateInfo = info;
  sendStatusToRenderer('available', {
    version: info.version,
    releaseDate: info.releaseDate,
    releaseNotes: info.releaseNotes
  });
});

autoUpdater.on('update-not-available', (info) => {
  console.log('[AutoUpdater] No update available. Current version is latest.');
  sendStatusToRenderer('idle', {
    currentVersion: info.version
  });
});

autoUpdater.on('download-progress', (progress) => {
  console.log(`[AutoUpdater] Download progress: ${Math.round(progress.percent)}%`);
  sendStatusToRenderer('downloading', {
    percent: Math.round(progress.percent),
    bytesPerSecond: progress.bytesPerSecond,
    transferred: progress.transferred,
    total: progress.total
  });
});

autoUpdater.on('update-downloaded', (info) => {
  console.log('[AutoUpdater] Update downloaded:', info.version);
  sendStatusToRenderer('ready', {
    version: info.version
  });
});

autoUpdater.on('error', (error) => {
  console.error('[AutoUpdater] Error:', error.message);
  sendStatusToRenderer('error', {
    message: error.message
  });
});

// IPC handlers
ipcMain.handle('check-for-updates', async () => {
  try {
    const result = await autoUpdater.checkForUpdates();
    return { success: true, updateInfo: result?.updateInfo };
  } catch (error) {
    console.error('[AutoUpdater] Check for updates failed:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('download-update', async () => {
  try {
    await autoUpdater.downloadUpdate();
    return { success: true };
  } catch (error) {
    console.error('[AutoUpdater] Download failed:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('install-update', () => {
  autoUpdater.quitAndInstall(false, true);
});

function initAutoUpdater(window) {
  mainWindow = window;

  // Check for updates on startup (with delay to let app settle)
  setTimeout(() => {
    console.log('[AutoUpdater] Checking for updates on startup...');
    autoUpdater.checkForUpdates().catch(err => {
      console.log('[AutoUpdater] Startup check failed:', err.message);
    });
  }, 5000);
}

module.exports = { initAutoUpdater };
