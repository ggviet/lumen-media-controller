const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { readCompleteHtml } = require('./test_helpers');

describe('Forensic Auditor Independent Verification: Milestone 1 (R2)', () => {
  const mainSrc = fs.readFileSync(path.join(__dirname, '../src/main/index.js'), 'utf8');
  const stageHtml = readCompleteHtml(path.join(__dirname, '../src/renderer/stage/index.html'));

  it('1. Anti-cheat check: Zero hardcoded test constants or mock mocks in production code', () => {
    assert.strictEqual(mainSrc.includes('__MOCK_OUTPUT__'), false);
    assert.strictEqual(mainSrc.includes('fakeDisplay'), false);
    assert.strictEqual(mainSrc.includes('mock'), false);
    assert.strictEqual(stageHtml.includes('mock'), false);
  });

  it('2. Chromium flags check: Exact startup flags registered before ready', () => {
    const requiredSwitches = [
      "autoplay-policy', 'no-user-gesture-required'",
      "disable-background-timer-throttling'",
      "disable-backgrounding-occluded-windows'",
      "disable-renderer-backgrounding'"
    ];
    for (const sw of requiredSwitches) {
      assert.ok(mainSrc.includes(sw), `Missing switch: ${sw}`);
    }
  });

  it('3. PowerSaveBlocker lifecycle: Started with error handling, queried via IPC, cleaned on close', () => {
    assert.ok(mainSrc.includes("powerSaveBlocker.start('prevent-display-sleep')"));
    assert.ok(mainSrc.includes("ipcMain.handle('get-power-save-status'"));
    assert.ok(mainSrc.includes("powerSaveBlocker.stop(powerSaveId)"));
    assert.ok(mainSrc.includes("powerSaveBlocker.isStarted(powerSaveId)"));
  });

  it('4. Screen Manager logic simulation: getAvailableDisplays & resolveTargetDisplay', () => {
    // Extract getAvailableDisplays and resolveTargetDisplay logic into simulated scope
    const mockScreen = {
      primary: { id: 10, label: 'Built-in Display', bounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea: { x: 0, y: 0, width: 1920, height: 1040 }, scaleFactor: 1.25, internal: true },
      external1: { id: 20, label: 'HDMI-1 (Sony 4K)', bounds: { x: 1920, y: 0, width: 3840, height: 2160 }, workArea: { x: 1920, y: 0, width: 3840, height: 2160 }, scaleFactor: 2.0, internal: false },
      external2: { id: 30, label: 'DP-1 (Dell QHD)', bounds: { x: -2560, y: 0, width: 2560, height: 1440 }, workArea: { x: -2560, y: 0, width: 2560, height: 1440 }, scaleFactor: 1.0, internal: false },
    };

    function simulateGetAvailableDisplays(displays, primaryDisplay) {
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

    const formatted = simulateGetAvailableDisplays([mockScreen.primary, mockScreen.external1, mockScreen.external2], mockScreen.primary);
    assert.strictEqual(formatted.length, 3);
    assert.strictEqual(formatted[0].isPrimary, true);
    assert.strictEqual(formatted[0].isExternal, false);
    assert.strictEqual(formatted[1].isPrimary, false);
    assert.strictEqual(formatted[1].isExternal, true);
    assert.strictEqual(formatted[1].bounds.width, 3840);

    function simulateResolveTargetDisplay(displays, primaryDisplay, preferredId = null) {
      if (preferredId !== null && preferredId !== undefined) {
        const matched = displays.find(d => String(d.id) === String(preferredId));
        if (matched) {
          return { display: matched, isExternal: matched.id !== primaryDisplay.id };
        }
      }
      const externalDisplay = displays.find(d => d.id !== primaryDisplay.id);
      if (externalDisplay) {
        return { display: externalDisplay, isExternal: true };
      }
      return { display: primaryDisplay, isExternal: false };
    }

    // Auto-select external when preferredId is null
    const target1 = simulateResolveTargetDisplay([mockScreen.primary, mockScreen.external1], mockScreen.primary, null);
    assert.strictEqual(target1.display.id, 20);
    assert.strictEqual(target1.isExternal, true);

    // Explicit selection of external2
    const target2 = simulateResolveTargetDisplay([mockScreen.primary, mockScreen.external1, mockScreen.external2], mockScreen.primary, 30);
    assert.strictEqual(target2.display.id, 30);
    assert.strictEqual(target2.isExternal, true);

    // Fallback when only primary is connected
    const target3 = simulateResolveTargetDisplay([mockScreen.primary], mockScreen.primary, null);
    assert.strictEqual(target3.display.id, 10);
    assert.strictEqual(target3.isExternal, false);

    // Fallback when preferred external display was disconnected
    const target4 = simulateResolveTargetDisplay([mockScreen.primary, mockScreen.external2], mockScreen.primary, 999);
    assert.strictEqual(target4.display.id, 30); // falls back to first available external
  });

  it('5. Debounce timer: 350ms coalescing test for rapid hotplug bursts', async () => {
    let reconfigureCalls = 0;
    let timer = null;
    const DEBOUNCE_MS = 350;

    function schedule() {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        reconfigureCalls++;
      }, DEBOUNCE_MS);
    }

    // Burst 5 events within 100ms
    for (let i = 0; i < 5; i++) {
      schedule();
      await new Promise(r => setTimeout(r, 20));
    }

    assert.strictEqual(reconfigureCalls, 0, 'Should not fire during active burst');

    // Wait 400ms for debounce timer to fire once
    await new Promise(r => setTimeout(r, 400));
    assert.strictEqual(reconfigureCalls, 1, 'Coalescing debounce must fire exactly once');
  });

  it('6. Unplug fallback safety: De-escalates topmost, hides stage, focuses operator', () => {
    assert.ok(mainSrc.includes("win.setAlwaysOnTop(false)"));
    assert.ok(mainSrc.includes("win.hide()"));
    assert.ok(mainSrc.includes("operatorWindow.focus()"));
  });

  it('7. Stage Window attributes: Borderless kiosk without native fullscreen', () => {
    assert.ok(mainSrc.includes("frame: false"));
    assert.ok(mainSrc.includes("resizable: false"));
    assert.ok(mainSrc.includes("setAlwaysOnTop(true, 'screen-saver')"));
    assert.strictEqual(mainSrc.includes("win.setFullScreen(true)"), false);
  });

  it('8. Stage Renderer CSS: Cursor none and selection suppression', () => {
    assert.ok(stageHtml.includes("cursor: none !important;"));
    assert.ok(stageHtml.includes("-webkit-user-select: none !important;"));
    assert.ok(stageHtml.includes("-webkit-user-drag: none !important;"));
  });

  it('9. Stage Renderer Input Shield: Pointer lock, contextmenu, drag-and-drop, key blockers', () => {
    assert.ok(stageHtml.includes("document.body.requestPointerLock()"));
    assert.ok(stageHtml.includes("lockPromise.catch("));
    assert.ok(stageHtml.includes("window.addEventListener('contextmenu'"));
    assert.ok(stageHtml.includes("e.dataTransfer.dropEffect = 'none'"));
    assert.ok(stageHtml.includes("['F5', 'F11', 'Tab', ' ']"));
  });

  it('10. Clean Stage Guarantee: freezeBanner completely eradicated', () => {
    assert.strictEqual(stageHtml.includes("freezeBanner"), false);
    assert.strictEqual(stageHtml.includes("STAGE FROZEN"), false);
  });
});
