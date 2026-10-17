/**
 * Adversarial Empirical Challenge Suite: M1-It2
 * 
 * Verifies:
 * 1. Rapid typing in <textarea id="liveTickerInput"> / <textarea id="tickerInput"> and inputs
 *    across lowercase, uppercase, and modifier combinations never triggers audio controls or blurs the input.
 * 2. When focus is on body, tactile shortcuts (Shift+Space, Numpad5, KeyP, Shift+T, Numpad., KeyO)
 *    execute sub-50ms audio actions.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const hotkeysSrc = fs.readFileSync(path.join(__dirname, '../src/renderer/operator/scripts/hotkeys.js'), 'utf8');
const mainSrc = fs.readFileSync(path.join(__dirname, '../src/main/index.js'), 'utf8');

// --- Harness for Renderer Hotkeys ---
function createRendererHarness() {
  let keydownHandler = null;
  let panicHandler = null;

  let playPauseCalls = 0;
  let fadeOutCalls = 0;
  let fadeOutDurations = [];
  let blackoutClicks = 0;
  let freezeClicks = 0;
  let safeLogoClicks = 0;
  let ftbClicks = 0;
  let muteClicks = 0;
  let goLiveCalls = 0;
  let stopAudioDeckCalls = 0;

  const sandbox = {
    window: {
      addEventListener: (type, handler) => {
        if (type === 'keydown') keydownHandler = handler;
      }
    },
    document: {
      activeElement: null
    },
    ipcRenderer: {
      on: (channel, handler) => {
        if (channel === 'panic-shortcut-triggered') panicHandler = handler;
      },
      send: (channel, payload) => {}
    },
    toggleAudioDeckPlayPause: () => { playPauseCalls++; },
    startAudioDeckFadeOut: (dur) => { fadeOutCalls++; fadeOutDurations.push(dur); },
    stopAudioDeck: () => { stopAudioDeckCalls++; },
    triggerGoLive: () => { goLiveCalls++; },
    canExecutePanicAction: () => true,
    selectedIndex: 0,
    rundown: [],
    reorderRundown: () => {},
    selectCue: () => {},
    deleteSelectedCue: () => {},
    btnBlackout: { click: () => { blackoutClicks++; }, addEventListener: () => {}, classList: { toggle: () => {} } },
    btnFreeze: { click: () => { freezeClicks++; }, addEventListener: () => {}, classList: { toggle: () => {} } },
    btnSafeLogo: { click: () => { safeLogoClicks++; }, addEventListener: () => {}, classList: { toggle: () => {} } },
    btnFTB: { click: () => { ftbClicks++; }, addEventListener: () => {}, classList: { toggle: () => {} } },
    btnMuteMaster: { click: () => { muteClicks++; }, addEventListener: () => {}, classList: { toggle: () => {} } },
    isPanicLocked: false
  };

  const keys = Object.keys(sandbox);
  const fn = new Function(...keys, hotkeysSrc);
  fn(...Object.values(sandbox));

  return {
    sandbox,
    dispatchKeydown: (opts) => {
      const e = {
        code: opts.code || '',
        key: opts.key || '',
        shiftKey: !!opts.shiftKey,
        ctrlKey: !!opts.ctrlKey,
        altKey: !!opts.altKey,
        metaKey: !!opts.metaKey,
        location: opts.location || 0,
        target: opts.target || { tagName: 'BODY' },
        defaultPrevented: false,
        preventDefault() { this.defaultPrevented = true; }
      };
      if (keydownHandler) keydownHandler(e);
      return e;
    },
    dispatchPanicRelay: (payload) => {
      if (panicHandler) panicHandler({}, payload);
    },
    getStats: () => ({
      playPauseCalls,
      fadeOutCalls,
      fadeOutDurations,
      blackoutClicks,
      freezeClicks,
      safeLogoClicks,
      ftbClicks,
      muteClicks,
      goLiveCalls,
      stopAudioDeckCalls
    }),
    reset: () => {
      playPauseCalls = 0;
      fadeOutCalls = 0;
      fadeOutDurations = [];
      blackoutClicks = 0;
      freezeClicks = 0;
      safeLogoClicks = 0;
      ftbClicks = 0;
      muteClicks = 0;
      goLiveCalls = 0;
      stopAudioDeckCalls = 0;
    }
  };
}

// --- Harness for Main Process before-input-event Interceptor ---
function createMainProcessHarness() {
  let beforeInputHandler = null;
  const sentIpc = [];

  const mockWin = {
    isDestroyed: () => false,
    webContents: {
      on: (type, handler) => {
        if (type === 'before-input-event') beforeInputHandler = handler;
      },
      send: (channel, data) => {
        sentIpc.push({ channel, data });
      }
    }
  };

  const fnMatch = mainSrc.match(/function attachPanicInputInterceptor[\s\S]*?\n\}/);
  if (!fnMatch) throw new Error('attachPanicInputInterceptor not found in main/index.js');

  const attachFn = new Function('screen', 'operatorWindow', `${fnMatch[0]}; return attachPanicInputInterceptor;`)(
    {},
    mockWin
  );

  attachFn(mockWin, 'operator');

  return {
    dispatchInput: (input) => {
      const start = process.hrtime.bigint();
      if (beforeInputHandler) {
        beforeInputHandler({ preventDefault: () => {} }, {
          type: 'keyDown',
          code: input.code || '',
          key: input.key || '',
          shiftKey: !!input.shiftKey,
          ctrlKey: !!input.ctrlKey,
          altKey: !!input.altKey,
          metaKey: !!input.metaKey
        });
      }
      const end = process.hrtime.bigint();
      const elapsedMs = Number(end - start) / 1e6;
      return { elapsedMs };
    },
    getSentIpc: () => sentIpc,
    reset: () => { sentIpc.length = 0; }
  };
}

describe('Adversarial Challenge: Rapid Typing in <textarea id="liveTickerInput">', () => {

  it('1.1: Rapid typing of lowercase alphabet (a-z) in <textarea id="liveTickerInput"> does NOT blur or trigger audio', () => {
    const harness = createRendererHarness();
    let blurCount = 0;
    const tickerInput = {
      tagName: 'TEXTAREA',
      id: 'liveTickerInput',
      value: '',
      blur() { blurCount++; }
    };
    harness.sandbox.document.activeElement = tickerInput;

    const alphabet = 'abcdefghijklmnopqrstuvwxyz';
    for (const char of alphabet) {
      const code = `Key${char.toUpperCase()}`;
      const evt = harness.dispatchKeydown({ code, key: char, shiftKey: false, target: tickerInput });
      assert.strictEqual(evt.defaultPrevented, false, `Letter ${char} should not be prevented`);
    }

    assert.strictEqual(blurCount, 0, 'Textarea must never blur on lowercase a-z');
    const stats = harness.getStats();
    assert.strictEqual(stats.playPauseCalls, 0, 'No play/pause on lowercase typing');
    assert.strictEqual(stats.fadeOutCalls, 0, 'No fadeout on lowercase typing');
  });

  it('1.2: EMPIRICAL VERIFICATION: Uppercase letter typing and input blur detection', () => {
    const harness = createRendererHarness();
    let blurCount = 0;
    const blurredKeys = [];
    const tickerInput = {
      tagName: 'TEXTAREA',
      id: 'liveTickerInput',
      value: '',
      blur() {
        blurCount++;
        blurredKeys.push(currentKey);
      }
    };
    harness.sandbox.document.activeElement = tickerInput;

    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const triggeredActions = [];

    let currentKey = '';
    for (const char of alphabet) {
      currentKey = char;
      const code = `Key${char}`;
      harness.reset();
      const evt = harness.dispatchKeydown({ code, key: char, shiftKey: true, target: tickerInput });
      const stats = harness.getStats();
      if (stats.playPauseCalls > 0 || stats.fadeOutCalls > 0 || stats.blackoutClicks > 0 || evt.defaultPrevented) {
        triggeredActions.push({ char, code, stats, defaultPrevented: evt.defaultPrevented });
      }
    }

    console.log('[AUDIT 1.2] Uppercase keys blurring textarea / triggering audio/panic:', {
      blurredKeys,
      triggeredActions
    });

    // Verification findings:
    // Key 'T' (Shift+KeyT) blurs textarea and triggers startAudioDeckFadeOut
    // Key 'B' (Shift+KeyB) blurs textarea and triggers blackoutClicks & stopAudioDeckCalls
    assert.ok(blurredKeys.includes('T'), 'CONFIRMED VULNERABILITY: Shift+KeyT blurs input');
    assert.ok(blurredKeys.includes('B'), 'CONFIRMED VULNERABILITY: Shift+KeyB blurs input');
    const tAction = triggeredActions.find(a => a.char === 'T');
    assert.ok(tAction && tAction.stats.fadeOutCalls === 1, 'CONFIRMED VULNERABILITY: Shift+KeyT triggers fadeout');
    const bAction = triggeredActions.find(a => a.char === 'B');
    assert.ok(bAction && bAction.stats.blackoutClicks === 1, 'CONFIRMED VULNERABILITY: Shift+KeyB triggers blackout');
  });

  it('1.3: EMPIRICAL VERIFICATION: Main Process before-input-event interceptor during uppercase typing', () => {
    const mainHarness = createMainProcessHarness();
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const intercepted = [];

    for (const char of alphabet) {
      const code = `Key${char}`;
      mainHarness.reset();
      mainHarness.dispatchInput({ code, key: char, shiftKey: true });
      const sent = mainHarness.getSentIpc();
      if (sent.length > 0) {
        intercepted.push({ char, code, sent: sent.map(s => s.data) });
      }
    }

    console.log('[AUDIT 1.3] Main process emergency bypass intercepted uppercase keys:', intercepted);
    const interceptedT = intercepted.find(i => i.char === 'T');
    assert.ok(interceptedT, 'CONFIRMED VULNERABILITY: Main process intercepts Shift+KeyT as emergencyAction');
    assert.strictEqual(interceptedT.sent[0].action, 'AUDIO_FADE_OUT');
  });

  it('1.4: EMPIRICAL VERIFICATION: Shift+Space inside <textarea id="liveTickerInput">', () => {
    const harness = createRendererHarness();
    const mainHarness = createMainProcessHarness();
    let blurCount = 0;
    const tickerInput = {
      tagName: 'TEXTAREA',
      id: 'liveTickerInput',
      value: '',
      blur() { blurCount++; }
    };
    harness.sandbox.document.activeElement = tickerInput;

    // Renderer check
    const evt = harness.dispatchKeydown({ code: 'Space', key: ' ', shiftKey: true, target: tickerInput });
    const stats = harness.getStats();

    // Main process check
    mainHarness.reset();
    mainHarness.dispatchInput({ code: 'Space', key: ' ', shiftKey: true });
    const mainSent = mainHarness.getSentIpc();

    console.log('[AUDIT 1.4] Shift+Space inside tickerInput:', {
      blurCount,
      defaultPrevented: evt.defaultPrevented,
      playPauseCalls: stats.playPauseCalls,
      mainSent: mainSent.map(s => s.data)
    });

    assert.ok(blurCount > 0, 'CONFIRMED VULNERABILITY: Shift+Space blurs input');
    assert.strictEqual(evt.defaultPrevented, true, 'CONFIRMED VULNERABILITY: Shift+Space prevents typing space');
    assert.strictEqual(stats.playPauseCalls, 1, 'CONFIRMED VULNERABILITY: Shift+Space triggers playPause in renderer');
    assert.ok(mainSent.length > 0 && mainSent[0].data.action === 'AUDIO_PLAY_PAUSE', 'CONFIRMED VULNERABILITY: Shift+Space triggers AUDIO_PLAY_PAUSE in main process');
  });

  it('1.5: EMPIRICAL VERIFICATION: Real-world sentence typing: "The 2026 Tech Summit Broadcast"', () => {
    const harness = createRendererHarness();
    const mainHarness = createMainProcessHarness();

    let blurCount = 0;
    const tickerInput = {
      tagName: 'TEXTAREA',
      id: 'liveTickerInput',
      value: '',
      blur() { blurCount++; }
    };
    harness.sandbox.document.activeElement = tickerInput;

    const sentence = "The 2026 Tech Summit Broadcast";
    const failures = [];

    for (let i = 0; i < sentence.length; i++) {
      const char = sentence[i];
      const isUpper = char >= 'A' && char <= 'Z';
      const isSpace = char === ' ';
      const code = isSpace ? 'Space' : (char >= '0' && char <= '9' ? `Digit${char}` : `Key${char.toUpperCase()}`);
      const shiftKey = isUpper;

      // 1. Check main process
      mainHarness.reset();
      mainHarness.dispatchInput({ code, key: char, shiftKey });
      const mainSent = mainHarness.getSentIpc();
      if (mainSent.length > 0) {
        failures.push({ charIndex: i, char, layer: 'main', sent: mainSent });
      }

      // 2. Check renderer keydown
      harness.reset();
      const prevBlur = blurCount;
      const evt = harness.dispatchKeydown({ code, key: char, shiftKey, target: tickerInput });
      const stats = harness.getStats();
      if (blurCount > prevBlur || stats.playPauseCalls > 0 || stats.fadeOutCalls > 0 || stats.blackoutClicks > 0 || evt.defaultPrevented) {
        failures.push({ charIndex: i, char, layer: 'renderer', stats, blurred: blurCount > prevBlur, defaultPrevented: evt.defaultPrevented });
      }
    }

    console.log('[AUDIT 1.5] Failures during sentence typing:', failures.length);
    assert.ok(failures.length > 0, 'CONFIRMED VULNERABILITY: Real-world sentence typing triggers unwanted actions and blurs');
  });
});

describe('Adversarial Challenge: Tactile Shortcuts Sub-50ms Execution', () => {
  it('2.1: Tactile shortcuts from BODY execute sub-50ms audio actions', () => {
    const harness = createRendererHarness();
    const mainHarness = createMainProcessHarness();
    const bodyTarget = { tagName: 'BODY' };
    harness.sandbox.document.activeElement = bodyTarget;

    const shortcuts = [
      { name: 'Shift+Space', code: 'Space', key: ' ', shiftKey: true, expectedAction: 'playPause' },
      { name: 'Numpad5', code: 'Numpad5', key: '5', shiftKey: false, expectedAction: 'playPause' },
      { name: 'KeyP', code: 'KeyP', key: 'p', shiftKey: false, expectedAction: 'playPause' },
      { name: 'Shift+T', code: 'KeyT', key: 'T', shiftKey: true, expectedAction: 'fadeOut' },
      { name: 'Numpad.', code: 'NumpadDecimal', key: '.', shiftKey: false, expectedAction: 'fadeOut' },
      { name: 'KeyO', code: 'KeyO', key: 'o', shiftKey: false, expectedAction: 'fadeOut' }
    ];

    for (const sc of shortcuts) {
      harness.reset();
      const start = process.hrtime.bigint();
      const evt = harness.dispatchKeydown({ code: sc.code, key: sc.key, shiftKey: sc.shiftKey, target: bodyTarget });
      const end = process.hrtime.bigint();
      const durationMs = Number(end - start) / 1e6;

      const stats = harness.getStats();
      if (sc.expectedAction === 'playPause') {
        assert.strictEqual(stats.playPauseCalls, 1, `${sc.name} must trigger toggleAudioDeckPlayPause`);
      } else if (sc.expectedAction === 'fadeOut') {
        assert.strictEqual(stats.fadeOutCalls, 1, `${sc.name} must trigger startAudioDeckFadeOut`);
      }
      assert.strictEqual(evt.defaultPrevented, true, `${sc.name} must prevent default when on body`);
      assert.ok(durationMs < 50, `${sc.name} execution time must be < 50ms (got ${durationMs.toFixed(3)}ms)`);
      console.log(`[PASS 2.1] ${sc.name} executed in ${durationMs.toFixed(3)}ms (target < 50ms)`);
    }
  });
});
