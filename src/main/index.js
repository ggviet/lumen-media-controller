const { app, BrowserWindow, screen, ipcMain } = require('electron');
const path = require('path');

let operatorWindow;
let stageWindow;

function createWindows() {
  const displays = screen.getAllDisplays();
  
  // Operator Window always on primary display
  operatorWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false, // For simplicity in prototype
      webSecurity: false,
    },
    title: "LUMEN - Operator Dashboard",
    backgroundColor: '#1a1a1a'
  });

  operatorWindow.loadFile(path.join(__dirname, '../renderer/operator/index.html'));

  // Stage Window logic
  const externalDisplay = displays.find((display) => {
    return display.bounds.x !== 0 || display.bounds.y !== 0;
  });

  if (externalDisplay) {
    stageWindow = new BrowserWindow({
      x: externalDisplay.bounds.x,
      y: externalDisplay.bounds.y,
      fullscreen: true,
      frame: false,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
        webSecurity: false,
      },
      backgroundColor: '#000000'
    });
  } else {
    // If no external display, open in a window for testing (Simulate 16:9 TV)
    stageWindow = new BrowserWindow({
      width: 1280,
      height: 720,
      title: "LUMEN - Stage Preview (Simulating 16:9 TV Output)",
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
        webSecurity: false,
      },
      backgroundColor: '#000000'
    });
  }

  stageWindow.loadFile(path.join(__dirname, '../renderer/stage/index.html'));

  // Clean up
  stageWindow.on('closed', () => {
    stageWindow = null;
  });

  operatorWindow.on('closed', () => {
    if (stageWindow && !stageWindow.isDestroyed()) {
      stageWindow.close();
    }
    app.quit();
  });
}

app.whenReady().then(() => {
  createWindows();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindows();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// IPC Communication
ipcMain.on('go-live', (event, media) => {
  if (stageWindow) {
    stageWindow.webContents.send('update-media', media);
  }
});

ipcMain.on('control-action', (event, action, data) => {
  if (stageWindow) {
    stageWindow.webContents.send('stage-control', action, data);
  }
});

// Forward sync-time from Stage back to Operator Dashboard
ipcMain.on('sync-time', (event, currentTime) => {
  if (operatorWindow) {
    operatorWindow.webContents.send('sync-time', currentTime);
  }
});
