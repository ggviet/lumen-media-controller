/**
 * tests/m1_verification.test.js
 * Verification of Milestone 1 implementations in src/main/index.js and src/renderer/stage/index.html.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { readCompleteHtml } = require('./test_helpers');

describe('Milestone 1 Verification: Multi-Display Lifecycle & Screen Hardening (R2)', () => {
  const mainSrc = fs.readFileSync(path.join(__dirname, '../src/main/index.js'), 'utf8');
  const stageHtml = readCompleteHtml(path.join(__dirname, '../src/renderer/stage/index.html'));

  describe('src/main/index.js Hardening & Debounced Display Manager', () => {
    it('appends required Chromium flags before app.whenReady()', () => {
      assert.ok(mainSrc.includes("app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')"));
      assert.ok(mainSrc.includes("app.commandLine.appendSwitch('disable-background-timer-throttling')"));
      assert.ok(mainSrc.includes("app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')"));
      assert.ok(mainSrc.includes("app.commandLine.appendSwitch('disable-renderer-backgrounding')"));
    });

    it('implements powerSaveBlocker with error handling and IPC status handler', () => {
      assert.ok(mainSrc.includes("powerSaveBlocker.start('prevent-display-sleep')"));
      assert.ok(mainSrc.includes("ipcMain.handle('get-power-save-status'"));
      assert.ok(mainSrc.includes("powerSaveBlocker.isStarted(powerSaveId)"));
    });

    it('implements debounced display reconfiguration at 350ms coalescing timer', () => {
      assert.ok(mainSrc.includes('DISPLAY_DEBOUNCE_MS = 350') || mainSrc.includes('350'));
      assert.ok(mainSrc.includes('scheduleDisplayReconfiguration'));
      assert.ok(mainSrc.includes("scheduleDisplayReconfiguration('display-added')"));
      assert.ok(mainSrc.includes("scheduleDisplayReconfiguration('display-removed')"));
      assert.ok(mainSrc.includes("scheduleDisplayReconfiguration('display-metrics-changed')"));
    });

    it('implements borderless kiosk with screen-saver priority and backgroundThrottling false', () => {
      assert.ok(mainSrc.includes("setAlwaysOnTop(true, 'screen-saver')"));
      assert.ok(mainSrc.includes('backgroundThrottling: false'));
      assert.ok(!mainSrc.includes('stageWindow.setFullScreen(true)'), 'Should not use native setFullScreen(true)');
    });

    it('enforces unplug fallback protection: strips alwaysOnTop, hides/docks, and focuses operator', () => {
      assert.ok(mainSrc.includes('win.setAlwaysOnTop(false)'));
      assert.ok(mainSrc.includes('win.hide()'));
      assert.ok(mainSrc.includes('operatorWindow.focus()'));
    });

    it('dispatches displays-changed IPC to Operator UI', () => {
      assert.ok(mainSrc.includes("'displays-changed'"));
      assert.ok(mainSrc.includes("operatorWindow.webContents.send('displays-changed'"));
    });
  });

  describe('src/renderer/stage/index.html Cursor & Input Shielding', () => {
    it('enforces zero cursor visibility via CSS and immediate DOM style enforcement', () => {
      assert.ok(stageHtml.includes('cursor: none !important;'));
      assert.ok(stageHtml.includes("document.documentElement.style.cursor = 'none'"));
      assert.ok(stageHtml.includes("document.body.style.cursor = 'none'"));
    });

    it('implements hardware pointer lock with error catch', () => {
      assert.ok(stageHtml.includes('requestPointerLock'));
      assert.ok(stageHtml.includes('.catch('));
    });

    it('blocks contextmenu, drag-and-drop, text selection, and disruptive keys', () => {
      assert.ok(stageHtml.includes("'contextmenu'"));
      assert.ok(stageHtml.includes('dropEffect = \'none\''));
      assert.ok(stageHtml.includes("'selectstart'"));
      assert.ok(stageHtml.includes("'auxclick'"));
      assert.ok(stageHtml.includes("'F5'"));
      assert.ok(stageHtml.includes("'F11'"));
    });

    it('strictly complies with Clean Stage Guarantee (no freezeBanner in HTML/CSS/JS)', () => {
      assert.ok(!stageHtml.includes('id="freezeBanner"'), 'freezeBanner DOM element must be absent');
      assert.ok(!stageHtml.includes('#freezeBanner'), 'freezeBanner CSS selector must be absent');
      assert.ok(!stageHtml.includes("getElementById('freezeBanner')"), 'freezeBanner JS query must be absent');
    });
  });
});
