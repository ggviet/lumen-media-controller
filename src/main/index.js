const { app, BrowserWindow, screen, ipcMain, powerSaveBlocker, dialog, session } = require('electron');
const path = require('path');
const fs = require('fs');

function resolveAssetPath(fileName) {
  if (process.resourcesPath) {
    const packagedPath = path.join(process.resourcesPath, 'assets', fileName);
    if (fs.existsSync(packagedPath)) return packagedPath;
  }
  return path.join(__dirname, '../../assets', fileName);
}

// Hardware acceleration & performance flags
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('enable-zero-copy');

// Autoplay without user interaction (Critical for unattended Stage display)
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

// Prevent timer & frame throttling when Stage window lacks OS focus
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-renderer-backgrounding');

let operatorWindow = null;
let stageWindow = null;
let powerSaveId = null;
let selectedStageDisplayId = null;
let displayDebounceTimer = null;
const DISPLAY_DEBOUNCE_MS = 350;

/**
 * Intercepts hardware keyboard input before DOM dispatch to guarantee sub-50ms
 * emergency panic execution regardless of focus state or active window.
 */
function attachPanicInputInterceptor(win, windowRole = 'operator') {
  if (!win || !win.webContents || typeof win.webContents.on !== 'function') return;
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    const code = input.code || '';
    const key = input.key || '';

    // Always-active emergency bypass keys (work even when typing or on Stage window)
    let emergencyAction = null;
    if (code === 'Escape' || key === 'Escape' || code === 'F4' || code === 'NumpadSubtract') {
      emergencyAction = 'BLACKOUT';
    } else if (code === 'F1' || code === 'Numpad4') {
      emergencyAction = 'SAFE_LOGO';
    } else if (code === 'F2' || code === 'NumpadMultiply') {
      emergencyAction = 'FREEZE';
    } else if (code === 'F3' || code === 'NumpadAdd') {
      emergencyAction = 'FTB';
    } else if (code === 'NumpadEnter') {
      emergencyAction = 'GO_LIVE';
    } else if (code === 'NumpadDivide') {
      emergencyAction = 'MUTE';
    } else if (windowRole === 'stage') {
      // If Stage window accidentally has OS focus, forward standard operator hotkeys
      if (code === 'Space' || code === 'NumpadEnter') emergencyAction = 'GO_LIVE';
      else if (code === 'KeyB' || code === 'NumpadSubtract') emergencyAction = 'BLACKOUT';
      else if (code === 'KeyF' || code === 'NumpadMultiply') emergencyAction = 'FREEZE';
      else if (code === 'KeyL' || code === 'Numpad4') emergencyAction = 'SAFE_LOGO';
      else if (code === 'KeyT' || code === 'NumpadAdd') emergencyAction = 'FTB';
      else if (code === 'KeyM' || code === 'NumpadDivide') emergencyAction = 'MUTE';
    }

    if (emergencyAction && operatorWindow && !operatorWindow.isDestroyed()) {
      operatorWindow.webContents.send('panic-shortcut-triggered', {
        action: emergencyAction,
        code,
        key,
        source: windowRole,
        timestamp: Date.now()
      });
    }
  });
}

/**
 * Queries all connected displays and formats rich metadata including hardware labels,
 * resolution, DPI scale factor, and primary/external classification.
 * @returns {Array<Object>} List of display descriptors for UI population
 */
function getAvailableDisplays() {
  const displays = screen.getAllDisplays();
  const primaryDisplay = screen.getPrimaryDisplay();

  return displays.map((disp, index) => {
    const isPrimary = disp.id === primaryDisplay.id;
    const isExternal = !disp.internal && !isPrimary;
    const rawLabel = disp.label && disp.label.trim().length > 0 
      ? disp.label.trim() 
      : (isPrimary ? 'Primary Display' : `External Display ${index}`);
    const roleTag = isPrimary ? 'Primary' : 'External';
    const scaleTag = disp.scaleFactor && disp.scaleFactor !== 1 ? ` @${disp.scaleFactor}x` : '';

    return {
      id: disp.id,
      label: `${rawLabel} (${disp.bounds.width}x${disp.bounds.height}${scaleTag}) [${roleTag}]`,
      width: disp.bounds.width,
      height: disp.bounds.height,
      bounds: { ...disp.bounds },
      workArea: { ...disp.workArea },
      isPrimary: isPrimary,
      isExternal: isExternal,
      scaleFactor: disp.scaleFactor || 1,
      internal: disp.internal || false
    };
  });
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
    icon: resolveAssetPath('icon.png')
  });

  attachPanicInputInterceptor(operatorWindow, 'operator');
  operatorWindow.loadFile(path.join(__dirname, '../renderer/operator/index.html'));

  operatorWindow.on('closed', () => {
    operatorWindow = null;
    if (stageWindow && !stageWindow.isDestroyed()) {
      stageWindow.close();
    }
    app.quit();
  });
}

/**
 * Resolves the optimal display for Stage presentation according to priority:
 * 1. Matching preferred display ID (if still physically connected)
 * 2. First available external display (HDMI / DisplayPort / USB-C DP Alt)
 * 3. Primary display fallback (single-monitor rehearsal mode)
 * @param {number|string|null} preferredId
 * @returns {{ display: Electron.Display, isExternal: boolean }}
 */
function resolveTargetDisplay(preferredId = null) {
  const displays = screen.getAllDisplays();
  const primaryDisplay = screen.getPrimaryDisplay();

  // 1. Explicit preference match
  if (preferredId !== null && preferredId !== undefined) {
    const matched = displays.find(d => String(d.id) === String(preferredId));
    if (matched) {
      return {
        display: matched,
        isExternal: matched.id !== primaryDisplay.id
      };
    }
  }

  // 2. Auto-select first external display
  const externalDisplay = displays.find(d => d.id !== primaryDisplay.id);
  if (externalDisplay) {
    return {
      display: externalDisplay,
      isExternal: true
    };
  }

  // 3. Fallback to primary display (single-display dev/rehearsal mode)
  return {
    display: primaryDisplay,
    isExternal: false
  };
}

/**
 * Ensures stageWindow BrowserWindow instance exists
 */
function ensureStageWindowInstance() {
  if (stageWindow && !stageWindow.isDestroyed()) {
    return stageWindow;
  }

  stageWindow = new BrowserWindow({
    width: 1280,
    height: 720,
    frame: false,
    resizable: false,
    movable: false,
    enableLargerThanScreen: true,
    autoHideMenuBar: true,
    backgroundColor: '#000000',
    title: "LUMEN - Stage Output (Live LED / Projector)",
    icon: resolveAssetPath('icon.png'),
    show: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webSecurity: false,
      backgroundThrottling: false
    }
  });

  attachPanicInputInterceptor(stageWindow, 'stage');
  stageWindow.loadFile(path.join(__dirname, '../renderer/stage/index.html'));

  stageWindow.on('closed', () => {
    stageWindow = null;
  });

  return stageWindow;
}

/**
 * Creates or repositions the Stage presentation window.
 * - On External Displays: Launches or snaps borderless kiosk, pinned above taskbars with screen-saver level.
 * - On Primary Display (Fallback / Unplug): Strips alwaysOnTop, hides window (or sets safe non-topmost 480x270 preview
 *   with showInactive() if explicitly selected by operator), and focuses Operator window.
 * @param {number|string|null} preferredDisplayId
 * @param {boolean} isExplicitUserSelection
 */
function createOrRepositionStageWindow(preferredDisplayId = null, isExplicitUserSelection = false) {
  const { display: targetDisplay, isExternal } = resolveTargetDisplay(preferredDisplayId);
  selectedStageDisplayId = isExternal ? targetDisplay.id : (isExplicitUserSelection ? targetDisplay.id : null);

  const win = ensureStageWindowInstance();

  // Clear native fullscreen if previously active to prevent Windows DWM minimizing & focus glitches
  if (win.isFullScreen()) {
    win.setFullScreen(false);
  }

  if (isExternal) {
    // External Display Kiosk Presentation
    win.setAlwaysOnTop(false); // Reset z-order first to allow clean transition
    win.setResizable(true);    // Temporarily allow resize so setBounds succeeds cleanly
    win.setBounds({
      x: targetDisplay.bounds.x,
      y: targetDisplay.bounds.y,
      width: targetDisplay.bounds.width,
      height: targetDisplay.bounds.height
    });
    win.setResizable(false);
    win.setMovable(false);
    win.setAlwaysOnTop(true, 'screen-saver');
    if (!win.isVisible()) {
      win.show();
    }

    // Keep operator dashboard focused
    if (operatorWindow && !operatorWindow.isDestroyed()) {
      operatorWindow.focus();
    }
  } else {
    // Single Display Fallback: DO NOT BLIND THE OPERATOR!
    win.setAlwaysOnTop(false); // CRITICAL: Release topmost lock immediately
    win.setResizable(true);
    win.setMovable(true);

    if (isExplicitUserSelection) {
      // Operator explicitly selected primary screen for local rehearsal / preview
      const workArea = targetDisplay.workArea || targetDisplay.bounds;
      const previewWidth = 480;
      const previewHeight = 270;
      win.setBounds({
        x: workArea.x + workArea.width - previewWidth - 20,
        y: workArea.y + workArea.height - previewHeight - 40,
        width: previewWidth,
        height: previewHeight
      });
      win.showInactive();
    } else {
      // Unplug fallback: safely hide stage window so operator workspace is 100% visible
      win.hide();
    }

    // Ensure Operator Window retains active focus and visibility
    if (operatorWindow && !operatorWindow.isDestroyed()) {
      operatorWindow.focus();
    }
  }

  // Synchronize state with Operator dashboard
  notifyDisplaysChanged();
}

/**
 * Emits updated display topology to Operator window via IPC
 */
function notifyDisplaysChanged() {
  if (operatorWindow && !operatorWindow.isDestroyed()) {
    operatorWindow.webContents.send('displays-changed', {
      displays: getAvailableDisplays(),
      selectedId: selectedStageDisplayId
    });
  }
}

/**
 * Coalesces screen hardware events within a 350ms window.
 * Eliminates race conditions during cable connect/disconnect bounce and
 * ensures Windows has concluded EDID resolution negotiation.
 * @param {string} triggerReason
 */
function scheduleDisplayReconfiguration(triggerReason) {
  if (displayDebounceTimer) {
    clearTimeout(displayDebounceTimer);
  }

  displayDebounceTimer = setTimeout(() => {
    displayDebounceTimer = null;

    // Evaluate if currently selected display still exists
    const displays = screen.getAllDisplays();
    const primary = screen.getPrimaryDisplay();
    const currentStillExists = displays.some(d => d.id === selectedStageDisplayId);

    if (!currentStillExists) {
      // Active stage display was physically detached
      selectedStageDisplayId = null;
    } else if (selectedStageDisplayId === primary.id) {
      // Currently on primary display, but a new external display may have arrived
      const external = displays.find(d => d.id !== primary.id);
      if (external) {
        // Auto-promote to new external display
        selectedStageDisplayId = external.id;
      }
    }

    createOrRepositionStageWindow(selectedStageDisplayId, false);
  }, DISPLAY_DEBOUNCE_MS);
}

app.whenReady().then(() => {
  // Prevent OS sleep & screensaver with error handling
  try {
    powerSaveId = powerSaveBlocker.start('prevent-display-sleep');
    const isStarted = powerSaveBlocker.isStarted(powerSaveId);
    console.log(`[Main] PowerSaveBlocker started (id: ${powerSaveId}, active: ${isStarted})`);
  } catch (err) {
    console.error('[Main] Failed to start powerSaveBlocker:', err);
    powerSaveId = null;
  }

  // Audio & hardware device permissions for enumeration, setSinkId routing, Web MIDI, and WebHID
  if (session && session.defaultSession) {
    session.defaultSession.setPermissionCheckHandler((webContents, permission) => {
      if (permission === 'media' || permission === 'audio-capture' || permission === 'speaker-selection' || permission === 'midi' || permission === 'midiSysex' || permission === 'hid') return true;
      return true;
    });
    session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
      callback(true);
    });
    session.defaultSession.setDevicePermissionHandler(() => true);
  }

  createOperatorWindow();
  createOrRepositionStageWindow();

  // Watch for HDMI plug / unplug events & resolution handshakes with 350ms coalescing debounce
  screen.on('display-added', () => {
    scheduleDisplayReconfiguration('display-added');
  });

  screen.on('display-removed', () => {
    scheduleDisplayReconfiguration('display-removed');
  });

  screen.on('display-metrics-changed', () => {
    scheduleDisplayReconfiguration('display-metrics-changed');
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createOperatorWindow();
      createOrRepositionStageWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (displayDebounceTimer) {
    clearTimeout(displayDebounceTimer);
    displayDebounceTimer = null;
  }
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
  if (displayDebounceTimer) {
    clearTimeout(displayDebounceTimer);
    displayDebounceTimer = null;
  }
  const id = (typeof displayId === 'object' && displayId !== null) ? displayId.displayId : displayId;
  createOrRepositionStageWindow(id, true);
});

// Power save blocker status query
ipcMain.handle('get-power-save-status', () => {
  const isBlocked = powerSaveId !== null && powerSaveBlocker.isStarted(powerSaveId);
  return {
    isBlocked,
    powerSaveId
  };
});

// Toggle stage window preview (PiP on primary display or external)
ipcMain.on('toggle-stage-preview', () => {
  const win = ensureStageWindowInstance();
  if (win.isVisible()) {
    win.hide();
  } else {
    const primaryDisplay = screen.getPrimaryDisplay();
    const workArea = primaryDisplay.workArea || primaryDisplay.bounds;
    const previewWidth = 480;
    const previewHeight = 270;
    win.setAlwaysOnTop(false);
    win.setResizable(true);
    win.setBounds({
      x: workArea.x + workArea.width - previewWidth - 20,
      y: workArea.y + workArea.height - previewHeight - 40,
      width: previewWidth,
      height: previewHeight
    });
    win.setAlwaysOnTop(true, 'screen-saver');
    win.show();
    if (operatorWindow && !operatorWindow.isDestroyed()) {
      operatorWindow.focus();
    }
  }
  notifyDisplaysChanged();
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
