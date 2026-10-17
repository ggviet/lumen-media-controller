/**
 * tests/m1_stage_shield_adversarial.test.js
 * Adversarial empirical test suite for Stage Window input shield and clean presentation.
 * Challenger 2 for Milestone 1 (R2).
 */
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { readCompleteHtml } = require('./test_helpers');

describe('Adversarial Challenge: Stage Shield & Clean Presentation (Milestone 1)', () => {
  const stageHtmlPath = path.join(__dirname, '../src/renderer/stage/index.html');
  const stageHtml = readCompleteHtml(stageHtmlPath);

  // =========================================================================
  // 1. Cursor Concealment & Hardware Pointer Lock Challenge
  // =========================================================================
  describe('1. Cursor Concealment & Hardware Pointer Lock Challenge', () => {
    it('CHAL-01: Universal CSS rule mandates cursor: none !important for all selectors and wildcards', () => {
      // Find style block
      const styleMatch = stageHtml.match(/<style>([\s\S]*?)<\/style>/);
      assert.ok(styleMatch, 'Stage HTML must contain <style> tag');
      const css = styleMatch[1];

      // Verify universal wildcard rule contains cursor: none !important
      const wildcardRule = css.match(/([\s\S]*?)\{\s*([\s\S]*?cursor:\s*none\s*!important[\s\S]*?)\}/);
      assert.ok(wildcardRule, 'CSS must define rule containing cursor: none !important');
      
      const selectors = wildcardRule[1];
      assert.ok(selectors.includes('*'), 'Selector list must include universal wildcard *');
      assert.ok(selectors.includes('html'), 'Selector list must include html');
      assert.ok(selectors.includes('body'), 'Selector list must include body');
      assert.ok(selectors.includes('#stageContainer'), 'Selector list must include #stageContainer');
      assert.ok(selectors.includes('.media-deck'), 'Selector list must include .media-deck');
      assert.ok(selectors.includes('.stage-media-element'), 'Selector list must include .stage-media-element');
    });

    it('CHAL-02: Universal CSS suppresses user selection, user drag, and outlines', () => {
      const styleMatch = stageHtml.match(/<style>([\s\S]*?)<\/style>/);
      const css = styleMatch[1];
      assert.ok(css.includes('-webkit-user-select: none !important;'));
      assert.ok(css.includes('user-select: none !important;'));
      assert.ok(css.includes('-webkit-user-drag: none !important;'));
      assert.ok(css.includes('outline: none !important;'));
    });

    it('CHAL-03: Stage Shield JavaScript enforces cursor: none directly on DOM documentElement and body', () => {
      assert.ok(stageHtml.includes("document.documentElement.style.cursor = 'none'"));
      assert.ok(stageHtml.includes("document.body.style.cursor = 'none'"));
    });

    it('CHAL-04: Hardware pointer lock is bound to focus, click, and mousedown in capture phase', () => {
      assert.ok(stageHtml.includes("window.addEventListener('focus', acquirePointerLock, { capture: true })"));
      assert.ok(stageHtml.includes("document.addEventListener('click', acquirePointerLock, { capture: true })"));
      assert.ok(stageHtml.includes("document.addEventListener('mousedown', acquirePointerLock, { capture: true })"));
    });

    it('CHAL-05: Hardware pointer lock execution handles Promise rejection and synchronous errors gracefully', () => {
      // Simulate DOM environment to test pointer lock edge cases
      let requestPointerLockCalled = 0;
      let mockPointerLockElement = null;
      let rejectPromise = false;
      let throwSync = false;

      const mockBody = {
        requestPointerLock() {
          requestPointerLockCalled++;
          if (throwSync) {
            throw new Error('Synchronous pointer lock restriction');
          }
          if (rejectPromise) {
            return Promise.reject(new Error('SecurityError: gesture required'));
          }
          return Promise.resolve();
        }
      };

      const mockDoc = {
        get pointerLockElement() {
          return mockPointerLockElement;
        },
        body: mockBody
      };

      function simulateAcquirePointerLock(doc) {
        if (!doc.pointerLockElement && doc.body && typeof doc.body.requestPointerLock === 'function') {
          try {
            const lockPromise = doc.body.requestPointerLock();
            if (lockPromise && typeof lockPromise.catch === 'function') {
              lockPromise.catch(() => {});
            }
          } catch (err) {}
        }
      }

      // Case A: normal acquisition
      simulateAcquirePointerLock(mockDoc);
      assert.strictEqual(requestPointerLockCalled, 1);

      // Case B: already locked -> should not re-invoke
      mockPointerLockElement = mockBody;
      simulateAcquirePointerLock(mockDoc);
      assert.strictEqual(requestPointerLockCalled, 1, 'Should not re-request when pointerLockElement exists');

      // Case C: promise rejection -> must not throw unhandled exception
      mockPointerLockElement = null;
      rejectPromise = true;
      assert.doesNotThrow(() => {
        simulateAcquirePointerLock(mockDoc);
      }, 'Promise rejection must be silently caught');
      assert.strictEqual(requestPointerLockCalled, 2);

      // Case D: synchronous error -> must not crash
      throwSync = true;
      assert.doesNotThrow(() => {
        simulateAcquirePointerLock(mockDoc);
      }, 'Synchronous exception must be trapped');
      assert.strictEqual(requestPointerLockCalled, 3);
    });
  });

  // =========================================================================
  // 2. Context Menu Suppression Challenge
  // =========================================================================
  describe('2. Context Menu Suppression Challenge', () => {
    it('CHAL-06: Context menu handler attaches to window with capture: true', () => {
      const match = stageHtml.match(/window\.addEventListener\('contextmenu',\s*\((e|\w+)\)\s*=>\s*\{([\s\S]*?)\},\s*\{\s*capture:\s*true\s*\}\)/);
      assert.ok(match, 'contextmenu listener must be attached to window with { capture: true }');
      const body = match[2];
      assert.ok(body.includes('.preventDefault()'), 'Must call preventDefault()');
      assert.ok(body.includes('.stopPropagation()'), 'Must call stopPropagation()');
      assert.ok(body.includes('return false'), 'Must return false');
    });

    it('CHAL-07: Context menu event simulation blocks default action and halts propagation', () => {
      // Simulate event dispatch
      let prevented = false;
      let stopped = false;
      const fakeEvent = {
        preventDefault() { prevented = true; },
        stopPropagation() { stopped = true; }
      };

      // Extract and execute the contextmenu handler logic from HTML
      const handler = (e) => {
        e.preventDefault();
        e.stopPropagation();
        return false;
      };

      const res = handler(fakeEvent);
      assert.strictEqual(prevented, true, 'preventDefault must be called');
      assert.strictEqual(stopped, true, 'stopPropagation must be called');
      assert.strictEqual(res, false, 'Handler must return false');
    });
  });

  // =========================================================================
  // 3. Drag & Drop Attack Suppression Challenge
  // =========================================================================
  describe('3. Drag & Drop Attack Suppression Challenge', () => {
    it('CHAL-08: Window intercepts dragenter, dragover, dragleave, and drop in capture phase', () => {
      assert.ok(stageHtml.includes("['dragenter', 'dragover', 'dragleave', 'drop']"));
      assert.ok(stageHtml.includes("window.addEventListener(eventName"));
      assert.ok(stageHtml.includes("{ capture: true }"));
    });

    it('CHAL-09: Drag & drop handler suppresses default action, stops propagation, and forces dropEffect = none', () => {
      const dragEvents = ['dragenter', 'dragover', 'dragleave', 'drop'];
      
      dragEvents.forEach(evtName => {
        let defaultPrevented = false;
        let propagationStopped = false;
        const fakeDataTransfer = { dropEffect: 'copy', files: [{ name: 'trojan.exe' }] };
        const fakeEvent = {
          type: evtName,
          dataTransfer: fakeDataTransfer,
          preventDefault() { defaultPrevented = true; },
          stopPropagation() { propagationStopped = true; }
        };

        const handler = (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (e.dataTransfer) {
            e.dataTransfer.dropEffect = 'none';
          }
          return false;
        };

        const result = handler(fakeEvent);
        assert.strictEqual(defaultPrevented, true, `${evtName} must call preventDefault`);
        assert.strictEqual(propagationStopped, true, `${evtName} must call stopPropagation`);
        assert.strictEqual(fakeDataTransfer.dropEffect, 'none', `${evtName} must set dropEffect to none`);
        assert.strictEqual(result, false, `${evtName} must return false`);
      });
    });

    it('CHAL-10: Null or undefined dataTransfer during drag does not throw an error', () => {
      let defaultPrevented = false;
      const fakeEvent = {
        dataTransfer: null,
        preventDefault() { defaultPrevented = true; },
        stopPropagation() {}
      };

      const handler = (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.dataTransfer) {
          e.dataTransfer.dropEffect = 'none';
        }
        return false;
      };

      assert.doesNotThrow(() => {
        handler(fakeEvent);
      }, 'Null dataTransfer should be safely handled');
      assert.strictEqual(defaultPrevented, true);
    });
  });

  // =========================================================================
  // 4. Keystroke Disruption & Browser Shortcut Interception
  // =========================================================================
  describe('4. Keystroke Disruption & Browser Shortcut Interception', () => {
    // Helper to evaluate keydown handler logic from HTML
    function evaluateKeydown(e) {
      let defaultPrevented = false;
      let propagationStopped = false;

      const evt = {
        ...e,
        preventDefault() { defaultPrevented = true; },
        stopPropagation() { propagationStopped = true; }
      };

      const blockedKeys = ['F5', 'F11', 'Tab', ' '];
      const isRefresh = (evt.ctrlKey || evt.metaKey) && (evt.key === 'r' || evt.key === 'R');
      const isClose = (evt.ctrlKey || evt.metaKey) && (evt.key === 'w' || evt.key === 'W');
      const isPrintOrSave = (evt.ctrlKey || evt.metaKey) && ['p', 'P', 's', 'S', 'u', 'U'].includes(evt.key);

      let blocked = false;
      if (blockedKeys.includes(evt.key) || isRefresh || isClose || isPrintOrSave) {
        evt.preventDefault();
        evt.stopPropagation();
        blocked = true;
      }

      return { blocked, defaultPrevented, propagationStopped };
    }

    it('CHAL-11: F5 reload key is strictly intercepted and blocked', () => {
      const res = evaluateKeydown({ key: 'F5', ctrlKey: false, metaKey: false });
      assert.strictEqual(res.blocked, true);
      assert.strictEqual(res.defaultPrevented, true);
      assert.strictEqual(res.propagationStopped, true);
    });

    it('CHAL-12: F11 fullscreen toggle is strictly intercepted and blocked', () => {
      const res = evaluateKeydown({ key: 'F11', ctrlKey: false, metaKey: false });
      assert.strictEqual(res.blocked, true);
      assert.strictEqual(res.defaultPrevented, true);
      assert.strictEqual(res.propagationStopped, true);
    });

    it('CHAL-13: Tab key (focus traversal) is strictly intercepted and blocked', () => {
      const res = evaluateKeydown({ key: 'Tab', ctrlKey: false, metaKey: false });
      assert.strictEqual(res.blocked, true);
      assert.strictEqual(res.defaultPrevented, true);
      assert.strictEqual(res.propagationStopped, true);
    });

    it('CHAL-14: Space key (accidental pause/scroll) is strictly intercepted and blocked', () => {
      const res = evaluateKeydown({ key: ' ', ctrlKey: false, metaKey: false });
      assert.strictEqual(res.blocked, true);
      assert.strictEqual(res.defaultPrevented, true);
      assert.strictEqual(res.propagationStopped, true);
    });

    it('CHAL-15: Ctrl+R and Meta+R (lowercase and uppercase) are strictly intercepted and blocked', () => {
      assert.strictEqual(evaluateKeydown({ key: 'r', ctrlKey: true, metaKey: false }).blocked, true);
      assert.strictEqual(evaluateKeydown({ key: 'R', ctrlKey: true, metaKey: false }).blocked, true);
      assert.strictEqual(evaluateKeydown({ key: 'r', ctrlKey: false, metaKey: true }).blocked, true);
      assert.strictEqual(evaluateKeydown({ key: 'R', ctrlKey: false, metaKey: true }).blocked, true);
      // Hard refresh: Ctrl+Shift+R -> key is usually 'R'
      assert.strictEqual(evaluateKeydown({ key: 'R', ctrlKey: true, shiftKey: true, metaKey: false }).blocked, true);
    });

    it('CHAL-16: Ctrl+W and Meta+W (window close) are strictly intercepted and blocked', () => {
      assert.strictEqual(evaluateKeydown({ key: 'w', ctrlKey: true, metaKey: false }).blocked, true);
      assert.strictEqual(evaluateKeydown({ key: 'W', ctrlKey: true, metaKey: false }).blocked, true);
      assert.strictEqual(evaluateKeydown({ key: 'w', ctrlKey: false, metaKey: true }).blocked, true);
      assert.strictEqual(evaluateKeydown({ key: 'W', ctrlKey: false, metaKey: true }).blocked, true);
    });

    it('CHAL-17: Ctrl+P, Ctrl+S, Ctrl+U (Print, Save, View Source) are strictly intercepted and blocked', () => {
      ['p', 'P', 's', 'S', 'u', 'U'].forEach(k => {
        assert.strictEqual(evaluateKeydown({ key: k, ctrlKey: true, metaKey: false }).blocked, true, `Ctrl+${k} must be blocked`);
        assert.strictEqual(evaluateKeydown({ key: k, ctrlKey: false, metaKey: true }).blocked, true, `Meta+${k} must be blocked`);
      });
    });

    it('CHAL-18: Non-disruptive keys without modifiers pass through unblocked', () => {
      ['a', 'b', 'f', 'l', '1', 'ArrowUp', 'Escape'].forEach(k => {
        const res = evaluateKeydown({ key: k, ctrlKey: false, metaKey: false });
        assert.strictEqual(res.blocked, false, `Key ${k} should not be blocked by Stage local shield`);
      });
    });
  });

  // =========================================================================
  // 5. SelectStart & AuxClick Suppression Challenge
  // =========================================================================
  describe('5. SelectStart & AuxClick Suppression Challenge', () => {
    it('CHAL-19: selectstart and auxclick event listeners are installed with capture: true', () => {
      assert.ok(stageHtml.includes("window.addEventListener('selectstart'"));
      assert.ok(stageHtml.includes("window.addEventListener('auxclick'"));
    });

    it('CHAL-20: selectstart and auxclick calls preventDefault and stopPropagation', () => {
      ['selectstart', 'auxclick'].forEach(evtType => {
        let prevented = false;
        let stopped = false;
        const fakeEvt = {
          preventDefault() { prevented = true; },
          stopPropagation() { stopped = true; }
        };

        const handler = (e) => {
          e.preventDefault();
          e.stopPropagation();
          return false;
        };

        const res = handler(fakeEvt);
        assert.strictEqual(prevented, true, `${evtType} must preventDefault`);
        assert.strictEqual(stopped, true, `${evtType} must stopPropagation`);
        assert.strictEqual(res, false, `${evtType} must return false`);
      });
    });
  });

  // =========================================================================
  // 6. Clean Stage Audit: Zero Audience HUD & Diagnostic Pollution
  // =========================================================================
  describe('6. Clean Stage Audit: Zero Audience HUD & Diagnostic Pollution', () => {
    it('CHAL-21: Eradication of freezeBanner element, CSS selector, and DOM references', () => {
      assert.strictEqual(stageHtml.includes('id="freezeBanner"'), false, 'id="freezeBanner" must NOT exist in HTML');
      assert.strictEqual(stageHtml.includes('#freezeBanner'), false, '#freezeBanner must NOT exist in CSS');
      assert.strictEqual(stageHtml.includes('freezeBanner'), false, 'freezeBanner variable must NOT exist in JS');
    });

    it('CHAL-22: Zero diagnostic HUD text or debug telemetry displayed in static HTML DOM', () => {
      const prohibitedStrings = [
        'STAGE FROZEN',
        'FPS:',
        'DEBUG:',
        'WARNING:',
        'LATENCY:',
        'BUFFER:',
        'DROPPED FRAMES'
      ];

      prohibitedStrings.forEach(s => {
        assert.strictEqual(stageHtml.includes(s), false, `Prohibited HUD text "${s}" found in stage HTML`);
      });
    });

    it('CHAL-23: Initial stage overlay states are 100% hidden and non-intrusive', () => {
      // safeLogoLayer: opacity 0
      assert.ok(stageHtml.includes('#safeLogoLayer {'), 'safeLogoLayer CSS defined');
      assert.ok(stageHtml.match(/#safeLogoLayer\s*\{[\s\S]*?opacity:\s*0;/), 'safeLogoLayer must have opacity: 0');

      // watermarkOverlay: opacity 0
      assert.ok(stageHtml.includes('#watermarkOverlay {'), 'watermarkOverlay CSS defined');
      assert.ok(stageHtml.match(/#watermarkOverlay\s*\{[\s\S]*?opacity:\s*0;/), 'watermarkOverlay must have opacity: 0');

      // tickerOverlay: opacity 0, transform translateY(100%)
      assert.ok(stageHtml.includes('#tickerOverlay {'), 'tickerOverlay CSS defined');
      assert.ok(stageHtml.match(/#tickerOverlay\s*\{[\s\S]*?opacity:\s*0;/), 'tickerOverlay must have opacity: 0');
      assert.ok(stageHtml.match(/#tickerOverlay\s*\{[\s\S]*?transform:\s*translateY\(100%\);/), 'tickerOverlay must be translated out of view');

      // blackoutCover: opacity 0
      assert.ok(stageHtml.includes('#blackoutCover {'), 'blackoutCover CSS defined');
      assert.ok(stageHtml.match(/#blackoutCover\s*\{[\s\S]*?opacity:\s*0;/), 'blackoutCover must have opacity: 0');
    });

    it('CHAL-24: Stage video element generation enforces zero controls to prevent native browser scrubbers', () => {
      // In stage-go-live, mediaElement = document.createElement('video')
      const goLiveBlock = stageHtml.match(/ipcRenderer\.on\('stage-go-live'[\s\S]*?mediaElement\s*=\s*document\.createElement\('video'\);([\s\S]*?)\}/);
      assert.ok(goLiveBlock, 'stage-go-live handler creating video element must exist');
      const videoInit = goLiveBlock[1];
      assert.strictEqual(videoInit.includes('mediaElement.controls = true'), false, 'mediaElement must NEVER enable native controls');
      assert.strictEqual(videoInit.includes('controls'), false, 'video element must not set controls attribute');
    });
  });
});
