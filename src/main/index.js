const { app, BrowserWindow, screen, ipcMain, powerSaveBlocker, dialog } = require('electron');
const path = require('path');

// Hardware acceleration & performance flags
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('enable-zero-copy');

let operatorWindow = null;
let stageWindow = null;
let powerSaveId = null;
let selectedStageDisplayId = null;

function getAvailableDisplays() {
  const displays = screen.getAllDisplays();
  const primaryDisplay = screen.getPrimaryDisplay();
  return displays.map((disp, index) => ({
    id: disp.id,
    label: `Display ${index + 1}: ${disp.bounds.width}x${disp.bounds.height} ${disp.id === primaryDisplay.id ? '(Primary)' : '(External)'}`,
    width: disp.bounds.width,
    height: disp.bounds.height,
    bounds: disp.bounds,
    isPrimary: disp.id === primaryDisplay.id
  }));
}

function createOperatorWindow() {
  const primaryDisplay = screen.getPrimaryDisplay();

  operatorWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1200,
    minHeight: 760,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webSecurity: false,
    },
    title: "LUMEN PRO - Event Media Controller (Broadcast Suite)",
    backgroundColor: '#0a0a0c',
    icon: path.join(__dirname, '../../assets/icon.png')
  });

  operatorWindow.loadFile(path.join(__dirname, '../renderer/operator/index.html'));

  operatorWindow.on('closed', () => {
    operatorWindow = null;
    if (stageWindow && !stageWindow.isDestroyed()) {
      stageWindow.close();
    }
    app.quit();
  });
}

function createOrRepositionStageWindow(preferredDisplayId = null) {
  const displays = screen.getAllDisplays();
  const primaryDisplay = screen.getPrimaryDisplay();

  let targetDisplay = null;
  if (preferredDisplayId) {
    targetDisplay = displays.find(d => d.id === preferredDisplayId);
  }

  // If no preferred or not found, pick first non-primary display
  if (!targetDisplay) {
    targetDisplay = displays.find(d => d.id !== primaryDisplay.id) || primaryDisplay;
  }

  selectedStageDisplayId = targetDisplay.id;
  const isExternal = targetDisplay.id !== primaryDisplay.id;

  if (!stageWindow || stageWindow.isDestroyed()) {
    stageWindow = new BrowserWindow({
      x: targetDisplay.bounds.x,
      y: targetDisplay.bounds.y,
      width: isExternal ? targetDisplay.bounds.width : 1280,
      height: isExternal ? targetDisplay.bounds.height : 720,
      fullscreen: isExternal,
      frame: !isExternal,
      alwaysOnTop: isExternal,
      title: "LUMEN - Stage Output (Live LED / Projector)",
      backgroundColor: '#000000',
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
        webSecurity: false,
      }
    });

    stageWindow.loadFile(path.join(__dirname, '../renderer/stage/index.html'));

    stageWindow.on('closed', () => {
      stageWindow = null;
    });
  } else {
    // Reposition existing window
    stageWindow.setFullScreen(false);
    stageWindow.setBounds({
      x: targetDisplay.bounds.x,
      y: targetDisplay.bounds.y,
      width: targetDisplay.bounds.width,
      height: targetDisplay.bounds.height
    });
    if (isExternal) {
      stageWindow.setFullScreen(true);
      stageWindow.setAlwaysOnTop(true);
    }
  }

  // Notify operator window of display info
  if (operatorWindow && !operatorWindow.isDestroyed()) {
    operatorWindow.webContents.send('displays-changed', {
      displays: getAvailableDisplays(),
      selectedId: selectedStageDisplayId
    });
  }
}

app.whenReady().then(() => {
  // Prevent OS sleep & screensaver
  powerSaveId = powerSaveBlocker.start('prevent-display-sleep');

  createOperatorWindow();
  createOrRepositionStageWindow();

  // Watch for HDMI plug / unplug events
  screen.on('display-added', () => {
    createOrRepositionStageWindow(selectedStageDisplayId);
  });

  screen.on('display-removed', (event, oldDisplay) => {
    if (selectedStageDisplayId === oldDisplay.id) {
      selectedStageDisplayId = null;
    }
    createOrRepositionStageWindow(selectedStageDisplayId);
  });

  screen.on('display-metrics-changed', () => {
    if (operatorWindow && !operatorWindow.isDestroyed()) {
      operatorWindow.webContents.send('displays-changed', {
        displays: getAvailableDisplays(),
        selectedId: selectedStageDisplayId
      });
    }
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createOperatorWindow();
      createOrRepositionStageWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (powerSaveId !== null && powerSaveBlocker.isStarted(powerSaveId)) {
    powerSaveBlocker.stop(powerSaveId);
  }
  if (process.platform !== 'darwin') app.quit();
});

// ==================== IPC HANDLERS ====================

// Display queries & change
ipcMain.handle('get-displays', () => {
  return {
    displays: getAvailableDisplays(),
    selectedId: selectedStageDisplayId
  };
});

ipcMain.on('set-stage-display', (event, displayId) => {
  createOrRepositionStageWindow(displayId);
});

// File picker dialog
ipcMain.handle('open-file-dialog', async (event, options) => {
  const result = await dialog.showOpenDialog(operatorWindow, options || {
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Media Files', extensions: ['mp4', 'mov', 'webm', 'mkv', 'png', 'jpg', 'jpeg', 'svg', 'webp'] },
      { name: 'Videos', extensions: ['mp4', 'mov', 'webm', 'mkv'] },
      { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'svg', 'webp'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  });
  return result.filePaths;
});

// Go Live command with transition parameters
ipcMain.on('go-live', (event, payload) => {
  if (stageWindow && !stageWindow.isDestroyed()) {
    stageWindow.webContents.send('stage-go-live', payload);
  }
  if (operatorWindow && !operatorWindow.isDestroyed()) {
    operatorWindow.webContents.send('pgm-updated', payload);
  }
});

// Master Control Actions
ipcMain.on('stage-control', (event, action, data) => {
  if (stageWindow && !stageWindow.isDestroyed()) {
    stageWindow.webContents.send('stage-control', action, data);
  }
  if (operatorWindow && !operatorWindow.isDestroyed()) {
    operatorWindow.webContents.send('control-feedback', action, data);
  }
});

// Stage status heartbeat forwarding to Operator Dashboard
ipcMain.on('stage-status', (event, status) => {
  if (operatorWindow && !operatorWindow.isDestroyed()) {
    operatorWindow.webContents.send('stage-status', status);
  }
});
