/**
 * tests/screen_lifecycle_stress.test.js
 * Adversarial Screen Lifecycle & Hotplug Stress Test Suite
 *
 * EMPIRICAL CHALLENGER FOR MILESTONE 1 (R2 Multi-Display Lifecycle)
 *
 * Tests the real production implementation in src/main/index.js against:
 * 1. Rapid cable bounce / hotplug storms (50ms, 100ms, 300ms intervals)
 * 2. 350ms debounce coalescing & single-execution verification
 * 3. Orphaned / duplicate BrowserWindow leak prevention
 * 4. Single-monitor disconnect safety (alwaysOnTop: false, operator unblocked)
 * 5. Dynamic resolution change & EDID handshake flutter
 * 6. Multi-monitor auto-promotion & non-target disconnect isolation
 * 7. Window crash/destruction recovery
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const EventEmitter = require('events');
const path = require('path');

// Helper to sleep in async tests
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Creates an isolated mock Electron environment and loads src/main/index.js
 */
function createScreenLifecycleHarness(initialDisplays) {
  let displays = JSON.parse(JSON.stringify(initialDisplays));
  const mockScreen = new EventEmitter();

  mockScreen.getAllDisplays = () => displays;
  mockScreen.getPrimaryDisplay = () => displays.find(d => d.isPrimary) || displays[0];

  const instances = [];
  const ipcMessages = [];
  const setBoundsHistory = [];

  class MockBrowserWindow extends EventEmitter {
    constructor(opts) {
      super();
      this.opts = opts;
      this.bounds = {
        x: opts.x || 0,
        y: opts.y || 0,
        width: opts.width || 800,
        height: opts.height || 600
      };
      this.destroyed = false;
      this.visible = opts.show !== false;
      this.alwaysOnTop = false;
      this.alwaysOnTopLevel = null;
      this.resizable = opts.resizable !== false;
      this.movable = opts.movable !== false;
      this.fullScreen = false;
      this.focused = false;
      this.title = opts.title || '';

      this.webContents = {
        send: (channel, ...args) => {
          ipcMessages.push({ window: this.title, channel, args });
        }
      };

      instances.push(this);
    }

    loadFile(filePath) {
      this.loadedFile = filePath;
    }

    isDestroyed() {
      return this.destroyed;
    }

    isFullScreen() {
      return this.fullScreen;
    }

    setFullScreen(val) {
      this.fullScreen = Boolean(val);
    }

    setAlwaysOnTop(flag, level) {
      this.alwaysOnTop = Boolean(flag);
      this.alwaysOnTopLevel = level || null;
    }

    isAlwaysOnTop() {
      return this.alwaysOnTop;
    }

    setResizable(val) {
      this.resizable = Boolean(val);
    }

    setMovable(val) {
      this.movable = Boolean(val);
    }

    setBounds(b) {
      this.bounds = { ...b };
      setBoundsHistory.push({
        windowTitle: this.title,
        bounds: { ...b },
        timestamp: Date.now()
      });
    }

    getBounds() {
      return { ...this.bounds };
    }

    isVisible() {
      return this.visible;
    }

    show() {
      this.visible = true;
    }

    hide() {
      this.visible = false;
    }

    showInactive() {
      this.visible = true;
      this.focused = false;
    }

    focus() {
      this.focused = true;
    }

    close() {
      this.destroyed = true;
      this.emit('closed');
    }

    static getAllWindows() {
      return instances.filter(w => !w.destroyed);
    }
  }

  const mockApp = new EventEmitter();
  mockApp.commandLine = {
    switches: {},
    appendSwitch: (k, v) => { mockApp.commandLine.switches[k] = v; }
  };
  mockApp.whenReady = () => Promise.resolve();
  mockApp.quit = () => { mockApp.emit('quit'); };

  const mockIpcMain = new EventEmitter();
  mockIpcMain.handlers = {};
  mockIpcMain.handle = (channel, fn) => {
    mockIpcMain.handlers[channel] = fn;
  };

  const powerSaveState = { active: false, id: null };
  const mockPowerSaveBlocker = {
    start: (type) => {
      powerSaveState.active = true;
      powerSaveState.id = 1001;
      return powerSaveState.id;
    },
    isStarted: (id) => powerSaveState.active && powerSaveState.id === id,
    stop: (id) => {
      if (powerSaveState.id === id) {
        powerSaveState.active = false;
        powerSaveState.id = null;
      }
    }
  };

  const mockDialog = {
    showOpenDialog: async () => ({ filePaths: [] })
  };

  // Intercept electron in require.cache
  const electronPath = require.resolve('electron');
  require.cache[electronPath] = {
    id: electronPath,
    filename: electronPath,
    loaded: true,
    exports: {
      app: mockApp,
      BrowserWindow: MockBrowserWindow,
      screen: mockScreen,
      ipcMain: mockIpcMain,
      powerSaveBlocker: mockPowerSaveBlocker,
      dialog: mockDialog
    }
  };

  // Clear cache for src/main/index.js and require fresh instance
  const mainPath = require.resolve('../src/main/index.js');
  delete require.cache[mainPath];
  require(mainPath);

  // Return control interface
  return {
    instances,
    ipcMessages,
    setBoundsHistory,
    mockScreen,
    mockIpcMain,
    mockApp,
    powerSaveState,
    getOperatorWindow: () => instances.find(w => w.title && (w.title.includes('Operator') || w.title.includes('Broadcast Suite') || w.title.includes('LUMEN PRO'))),
    getStageWindow: () => instances.filter(w => !w.isDestroyed()).find(w => w.title && w.title.includes('Stage')) || instances.find(w => w.title && w.title.includes('Stage')),
    setDisplays: (newDisplays) => {
      displays = JSON.parse(JSON.stringify(newDisplays));
    },
    getDisplays: () => displays,
    addDisplay: (disp) => {
      displays.push(disp);
      mockScreen.emit('display-added');
    },
    removeDisplay: (id) => {
      displays = displays.filter(d => d.id !== id);
      mockScreen.emit('display-removed');
    },
    updateMetrics: (id, newBounds) => {
      const target = displays.find(d => d.id === id);
      if (target) {
        target.bounds = { ...target.bounds, ...newBounds };
        mockScreen.emit('display-metrics-changed');
      }
    }
  };
}

describe('Milestone 1 Empirical Stress Tests: Screen Lifecycle & Hotplug (src/main/index.js)', () => {

  const standardDualDisplays = [
    {
      id: 1,
      label: 'Operator Primary Monitor',
      bounds: { x: 0, y: 0, width: 1920, height: 1080 },
      workArea: { x: 0, y: 0, width: 1920, height: 1040 },
      isPrimary: true,
      scaleFactor: 1.0
    },
    {
      id: 2,
      label: 'Main Stage Projector (HDMI)',
      bounds: { x: 1920, y: 0, width: 3840, height: 2160 },
      workArea: { x: 1920, y: 0, width: 3840, height: 2160 },
      isPrimary: false,
      scaleFactor: 1.0
    }
  ];

  // =========================================================================
  // STRESS SUITE 1: Rapid Cable Bounce / Hotplug Storm Coalescence
  // =========================================================================
  describe('Suite 1: Rapid Cable Bounce / Hotplug Storm Coalescence', () => {

    it('TC-STRESS-01: Rapid 50ms cable bounce storm coalesces into single execution without intermediate churn', async () => {
      const harness = createScreenLifecycleHarness(standardDualDisplays);
      await sleep(10); // Allow startup microtasks to settle

      const stageWin = harness.getStageWindow();
      const operatorWin = harness.getOperatorWindow();

      assert.ok(stageWin, 'Stage window must be created on launch');
      assert.ok(operatorWin, 'Operator window must be created on launch');
      assert.strictEqual(harness.instances.length, 2, 'Initial window count must be exactly 2');

      // Verify initial anchor on Display 2 (Projector)
      assert.deepStrictEqual(stageWin.getBounds(), { x: 1920, y: 0, width: 3840, height: 2160 });
      assert.strictEqual(stageWin.isAlwaysOnTop(), true);

      // Snapshot bounds history length before storm
      const initialHistoryLen = harness.setBoundsHistory.length;

      // SIMULATE 50ms RAPID CABLE BOUNCE (Flapping HDMI connection)
      // t = 0ms: Disconnect
      harness.removeDisplay(2);
      await sleep(50);

      // t = 50ms: Reconnect
      harness.addDisplay({
        id: 2,
        label: 'Main Stage Projector (HDMI)',
        bounds: { x: 1920, y: 0, width: 3840, height: 2160 },
        workArea: { x: 1920, y: 0, width: 3840, height: 2160 },
        isPrimary: false
      });
      await sleep(50);

      // t = 100ms: Disconnect
      harness.removeDisplay(2);
      await sleep(50);

      // t = 150ms: Reconnect
      harness.addDisplay({
        id: 2,
        label: 'Main Stage Projector (HDMI)',
        bounds: { x: 1920, y: 0, width: 3840, height: 2160 },
        workArea: { x: 1920, y: 0, width: 3840, height: 2160 },
        isPrimary: false
      });
      await sleep(50);

      // t = 200ms: Metrics change handshake
      harness.updateMetrics(2, { width: 3840, height: 2160 });

      // At t = 250ms (before the 350ms debounce window expires):
      // No setBounds should have been triggered during the storm!
      const midStormBoundsCalls = harness.setBoundsHistory.length - initialHistoryLen;
      assert.strictEqual(
        midStormBoundsCalls,
        0,
        `Expected 0 setBounds calls during rapid flap window, but got ${midStormBoundsCalls}`
      );

      // Now wait 400ms for debounce timer (350ms) to cleanly fire
      await sleep(400);

      // Post-debounce verification:
      const postStormBoundsCalls = harness.setBoundsHistory.length - initialHistoryLen;
      assert.strictEqual(
        postStormBoundsCalls,
        1,
        `Expected exactly 1 coalesced setBounds execution post-storm, got ${postStormBoundsCalls}`
      );

      // Verify zero orphaned windows spawned
      assert.strictEqual(
        harness.instances.length,
        2,
        'Window count must remain strictly 2 (no duplicate or orphaned BrowserWindow instances)'
      );

      // Verify final stage state is correctly anchored on Display 2
      assert.deepStrictEqual(stageWin.getBounds(), { x: 1920, y: 0, width: 3840, height: 2160 });
      assert.strictEqual(stageWin.isAlwaysOnTop(), true);
      assert.strictEqual(stageWin.alwaysOnTopLevel, 'screen-saver');
      assert.strictEqual(stageWin.isVisible(), true);
    });

    it('TC-STRESS-02: Mixed 100ms & 300ms intervals hotplug storm ending in removal coalesces to primary fallback', async () => {
      const harness = createScreenLifecycleHarness(standardDualDisplays);
      await sleep(10);

      const stageWin = harness.getStageWindow();
      const operatorWin = harness.getOperatorWindow();

      const initialHistoryLen = harness.setBoundsHistory.length;

      // Storm sequence:
      // t = 0ms: Disconnect
      harness.removeDisplay(2);
      await sleep(100);

      // t = 100ms: Reconnect
      harness.addDisplay({
        id: 2,
        label: 'Main Stage Projector',
        bounds: { x: 1920, y: 0, width: 3840, height: 2160 },
        isPrimary: false
      });
      await sleep(300); // 300ms elapsed since last event (< 350ms debounce)

      // t = 400ms: Permanent disconnect!
      harness.removeDisplay(2);

      // At t = 450ms (50ms after final disconnect):
      assert.strictEqual(
        harness.setBoundsHistory.length - initialHistoryLen,
        0,
        'Debounce must hold until 350ms after the LAST event'
      );

      // Wait 400ms for final debounce to fire
      await sleep(400);

      // Verify single-monitor fallback:
      assert.strictEqual(
        stageWin.isAlwaysOnTop(),
        false,
        'stageWindow.isAlwaysOnTop() MUST be false on single monitor disconnect'
      );
      assert.strictEqual(
        stageWin.isVisible(),
        false,
        'stageWindow must be hidden on disconnect fallback so operator is not covered'
      );
      assert.strictEqual(
        operatorWin.focused,
        true,
        'operatorWindow must be focused on disconnect'
      );
      assert.strictEqual(
        harness.instances.length,
        2,
        'No orphaned windows after disconnect storm'
      );
    });

    it('TC-STRESS-03: Chaos burst: 20 rapid alternating events in 10ms intervals without crashes or leaks', async () => {
      const harness = createScreenLifecycleHarness(standardDualDisplays);
      await sleep(10);

      // Fire 20 rapid events
      for (let i = 0; i < 20; i++) {
        if (i % 2 === 0) {
          harness.removeDisplay(2);
        } else {
          harness.addDisplay({
            id: 2,
            label: `Glitch Display Iteration ${i}`,
            bounds: { x: 1920, y: 0, width: 1920, height: 1080 },
            isPrimary: false
          });
        }
        await sleep(10);
      }

      // Wait 400ms for final debounce
      await sleep(400);

      // Zero crashes, window count intact
      assert.strictEqual(harness.instances.length, 2, 'Window count must remain exactly 2');
      assert.strictEqual(harness.getStageWindow().isDestroyed(), false);
      assert.strictEqual(harness.getOperatorWindow().isDestroyed(), false);
    });
  });

  // =========================================================================
  // STRESS SUITE 2: Single-Monitor Disconnect & Safety Guarantees
  // =========================================================================
  describe('Suite 2: Single-Monitor Disconnect & Safety Guarantees', () => {

    it('TC-STRESS-04: External disconnect strips alwaysOnTop, hides stage, and protects operator dashboard', async () => {
      const harness = createScreenLifecycleHarness(standardDualDisplays);
      await sleep(10);

      const stageWin = harness.getStageWindow();
      const operatorWin = harness.getOperatorWindow();

      // External projector is physically pulled
      harness.removeDisplay(2);
      await sleep(400); // Debounce expires

      // Verify safety guarantees:
      assert.strictEqual(stageWin.isAlwaysOnTop(), false, 'alwaysOnTop must be de-escalated to false');
      assert.strictEqual(stageWin.isVisible(), false, 'stageWindow must be hidden');
      assert.strictEqual(operatorWin.focused, true, 'operatorWindow must have active OS focus');

      // Verify Operator UI received updated display list
      const displayChangeMessages = harness.ipcMessages.filter(m => m.channel === 'displays-changed');
      assert.ok(displayChangeMessages.length > 0, 'displays-changed IPC must be emitted to operator');
      const latestPayload = displayChangeMessages[displayChangeMessages.length - 1].args[0];
      assert.strictEqual(latestPayload.displays.length, 1);
      assert.strictEqual(latestPayload.selectedId, null);
    });

    it('TC-STRESS-05: Cold launch on single monitor does not obstruct operator', async () => {
      const singleDisplay = [standardDualDisplays[0]]; // Only Primary display
      const harness = createScreenLifecycleHarness(singleDisplay);
      await sleep(10);

      const stageWin = harness.getStageWindow();
      const operatorWin = harness.getOperatorWindow();

      assert.strictEqual(stageWin.isAlwaysOnTop(), false, 'Must not be topmost on single screen');
      assert.strictEqual(stageWin.isVisible(), false, 'Stage must start hidden when no external display is present');
      assert.strictEqual(operatorWin.focused, true, 'Operator window must be focused');
    });

    it('TC-STRESS-06: Explicit user selection of Primary display creates safe 480x270 non-topmost docked preview', async () => {
      const singleDisplay = [standardDualDisplays[0]];
      const harness = createScreenLifecycleHarness(singleDisplay);
      await sleep(10);

      const stageWin = harness.getStageWindow();

      // Operator explicitly requests rehearsal preview on Primary screen via IPC
      harness.mockIpcMain.emit('set-stage-display', {}, 1);

      // Verify docked preview:
      assert.strictEqual(stageWin.isAlwaysOnTop(), false, 'Docked preview must NEVER be alwaysOnTop');
      assert.strictEqual(stageWin.isVisible(), true, 'Docked preview must be visible');
      const bounds = stageWin.getBounds();
      assert.strictEqual(bounds.width, 480, 'Preview width must be 480');
      assert.strictEqual(bounds.height, 270, 'Preview height must be 270');
      // Docked in bottom right of workArea (1920x1040)
      assert.strictEqual(bounds.x, 1920 - 480 - 20); // 1420
      assert.strictEqual(bounds.y, 1040 - 270 - 40); // 730
    });
  });

  // =========================================================================
  // STRESS SUITE 3: Dynamic Resolution Change & EDID Handshake
  // =========================================================================
  describe('Suite 3: Dynamic Resolution Change & EDID Handshake', () => {

    it('TC-STRESS-07: External display resolution upgrade (1080p -> 4K) re-anchors bounds cleanly', async () => {
      const displaySetup = [
        standardDualDisplays[0],
        {
          id: 2,
          label: 'External Stage Display',
          bounds: { x: 1920, y: 0, width: 1920, height: 1080 },
          workArea: { x: 1920, y: 0, width: 1920, height: 1080 },
          isPrimary: false
        }
      ];

      const harness = createScreenLifecycleHarness(displaySetup);
      await sleep(10);

      const stageWin = harness.getStageWindow();
      assert.deepStrictEqual(stageWin.getBounds(), { x: 1920, y: 0, width: 1920, height: 1080 });

      // Resolution changes to 4K (3840x2160)
      harness.updateMetrics(2, { width: 3840, height: 2160 });
      await sleep(400); // Wait for 350ms debounce

      // Verify bounds updated to 4K
      assert.deepStrictEqual(stageWin.getBounds(), { x: 1920, y: 0, width: 3840, height: 2160 });
      assert.strictEqual(stageWin.isAlwaysOnTop(), true);
      assert.strictEqual(stageWin.alwaysOnTopLevel, 'screen-saver');
    });

    it('TC-STRESS-08: Multi-step resolution negotiation flutter (1080p -> 720p -> 1440p -> 4K) applies only final resolution', async () => {
      const harness = createScreenLifecycleHarness(standardDualDisplays);
      await sleep(10);

      const initialHistoryLen = harness.setBoundsHistory.length;

      // Rapid EDID negotiation steps:
      harness.updateMetrics(2, { width: 1280, height: 720 });
      await sleep(60);
      harness.updateMetrics(2, { width: 2560, height: 1440 });
      await sleep(60);
      harness.updateMetrics(2, { width: 3840, height: 2160 });

      // During flutter:
      assert.strictEqual(
        harness.setBoundsHistory.length - initialHistoryLen,
        0,
        'Should not trigger intermediate setBounds during resolution flutter'
      );

      // Wait for debounce
      await sleep(400);

      // Only one final reconfiguration
      assert.strictEqual(
        harness.setBoundsHistory.length - initialHistoryLen,
        1,
        'Only final negotiated resolution must be applied'
      );
      assert.deepStrictEqual(
        harness.getStageWindow().getBounds(),
        { x: 1920, y: 0, width: 3840, height: 2160 }
      );
    });
  });

  // =========================================================================
  // STRESS SUITE 4: Multi-Monitor Topology & Fail-Safe Recovery
  // =========================================================================
  describe('Suite 4: Multi-Monitor Topology & Fail-Safe Recovery', () => {

    it('TC-STRESS-09: Reconnection after single-monitor disconnect auto-promotes to external display', async () => {
      const harness = createScreenLifecycleHarness(standardDualDisplays);
      await sleep(10);

      // 1. Unplug external
      harness.removeDisplay(2);
      await sleep(400);
      assert.strictEqual(harness.getStageWindow().isVisible(), false);
      assert.strictEqual(harness.getStageWindow().isAlwaysOnTop(), false);

      // 2. Re-plug external
      harness.addDisplay({
        id: 2,
        label: 'Reconnected Projector',
        bounds: { x: 1920, y: 0, width: 3840, height: 2160 },
        isPrimary: false
      });
      await sleep(400);

      // 3. Stage window must auto-promote back to external display
      const stageWin = harness.getStageWindow();
      assert.strictEqual(stageWin.isVisible(), true, 'Stage window must become visible again');
      assert.strictEqual(stageWin.isAlwaysOnTop(), true, 'Stage window must regain screen-saver topmost priority');
      assert.deepStrictEqual(stageWin.getBounds(), { x: 1920, y: 0, width: 3840, height: 2160 });
    });

    it('TC-STRESS-10: Triple-monitor setup: unplugging non-stage external display does NOT disturb active Stage presentation', async () => {
      const tripleDisplays = [
        standardDualDisplays[0], // Display 1: Primary
        standardDualDisplays[1], // Display 2: Projector (Stage)
        {
          id: 3,
          label: 'Confidence / Downstage Monitor',
          bounds: { x: 5760, y: 0, width: 1920, height: 1080 },
          workArea: { x: 5760, y: 0, width: 1920, height: 1080 },
          isPrimary: false
        }
      ];

      const harness = createScreenLifecycleHarness(tripleDisplays);
      await sleep(10);

      const stageWin = harness.getStageWindow();
      assert.deepStrictEqual(stageWin.getBounds(), { x: 1920, y: 0, width: 3840, height: 2160 });

      // Unplug confidence monitor (Display 3), which is NOT the stage display
      harness.removeDisplay(3);
      await sleep(400);

      // Stage window must remain firmly anchored to Display 2
      assert.deepStrictEqual(stageWin.getBounds(), { x: 1920, y: 0, width: 3840, height: 2160 });
      assert.strictEqual(stageWin.isAlwaysOnTop(), true);
      assert.strictEqual(stageWin.isVisible(), true);
    });

    it('TC-STRESS-11: Triple-monitor setup: unplugging active Stage display migrates presentation to secondary external display', async () => {
      const tripleDisplays = [
        standardDualDisplays[0], // Display 1: Primary
        standardDualDisplays[1], // Display 2: Projector (Active Stage)
        {
          id: 3,
          label: 'Backup LED Wall',
          bounds: { x: 5760, y: 0, width: 1920, height: 1080 },
          workArea: { x: 5760, y: 0, width: 1920, height: 1080 },
          isPrimary: false
        }
      ];

      const harness = createScreenLifecycleHarness(tripleDisplays);
      await sleep(10);

      // Unplug active Stage display (Display 2)
      harness.removeDisplay(2);
      await sleep(400);

      // Stage must automatically migrate to remaining external Display 3!
      const stageWin = harness.getStageWindow();
      assert.deepStrictEqual(stageWin.getBounds(), { x: 5760, y: 0, width: 1920, height: 1080 });
      assert.strictEqual(stageWin.isAlwaysOnTop(), true);
      assert.strictEqual(stageWin.isVisible(), true);
    });

    it('TC-STRESS-12: Destroyed Stage window recovers automatically on next display event without throw', async () => {
      const harness = createScreenLifecycleHarness(standardDualDisplays);
      await sleep(10);

      const oldStageWin = harness.getStageWindow();
      assert.ok(oldStageWin);

      // Simulate unexpected window crash or user close
      oldStageWin.close();
      assert.strictEqual(oldStageWin.isDestroyed(), true);

      // Trigger hotplug event
      harness.updateMetrics(2, { width: 3840, height: 2160 });
      await sleep(400);

      // Verify recreation
      const newStageWin = harness.getStageWindow();
      assert.ok(newStageWin, 'A new stage window instance must be recreated');
      assert.notStrictEqual(newStageWin, oldStageWin, 'Must be a fresh instance');
      assert.strictEqual(newStageWin.isDestroyed(), false);
      assert.deepStrictEqual(newStageWin.getBounds(), { x: 1920, y: 0, width: 3840, height: 2160 });
    });

    it('TC-STRESS-13: PowerSaveBlocker query IPC and shutdown cleanup', async () => {
      const harness = createScreenLifecycleHarness(standardDualDisplays);
      await sleep(10);

      // Query power save status via IPC
      const statusHandler = harness.mockIpcMain.handlers['get-power-save-status'];
      assert.ok(statusHandler, 'get-power-save-status handler must be registered');

      const status = await statusHandler();
      assert.strictEqual(status.isBlocked, true);
      assert.strictEqual(status.powerSaveId, 1001);

      // Simulate app window-all-closed
      harness.mockApp.emit('window-all-closed');
      assert.strictEqual(harness.powerSaveState.active, false, 'Power save blocker must be stopped on exit');
    });
  });
});
