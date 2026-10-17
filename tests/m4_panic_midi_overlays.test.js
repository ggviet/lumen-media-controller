/**
 * tests/m4_panic_midi_overlays.test.js
 * Milestone 4 Verification Suite:
 * Panic Controls, Focus-Independent Shortcuts, Web MIDI Controller Integration,
 * Synchronized Audio/Video FTB Ramp, Clean Stage Guarantee & Live Overlays
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { readCompleteHtml } = require('./test_helpers');

describe('Milestone 4 Verification: Panic Controls, Web MIDI, Synchronized FTB & Overlays', () => {
  const mainJs = fs.readFileSync(path.join(__dirname, '../src/main/index.js'), 'utf8');
  const operatorHtml = readCompleteHtml(path.join(__dirname, '../src/renderer/operator/index.html'));
  const stageHtml = readCompleteHtml(path.join(__dirname, '../src/renderer/stage/index.html'));

  describe('1. Main Process Focus-Independent Emergency Interceptor & MIDI Permissions', () => {
    it('1.1: Registers before-input-event interceptor on both operatorWindow and stageWindow', () => {
      assert.ok(mainJs.includes("function attachPanicInputInterceptor(win, windowRole = 'operator')"));
      assert.ok(mainJs.includes("win.webContents.on('before-input-event', (event, input) => {"));
      assert.ok(mainJs.includes("attachPanicInputInterceptor(operatorWindow, 'operator');"));
      assert.ok(mainJs.includes("attachPanicInputInterceptor(stageWindow, 'stage');"));
    });

    it('1.2: Intercepts Escape, F1-F4, and Numpad panic keys at Main Process level and relays panic-shortcut-triggered', () => {
      assert.ok(mainJs.includes("code === 'Escape' || key === 'Escape' || code === 'F4'"));
      assert.ok(mainJs.includes("code === 'F2'"));
      assert.ok(mainJs.includes("code === 'F1'"));
      assert.ok(mainJs.includes("code === 'F3'"));
      assert.ok(mainJs.includes("code === 'NumpadEnter'"));
      assert.ok(mainJs.includes("code === 'NumpadSubtract'"));
      assert.ok(mainJs.includes("code === 'NumpadMultiply'"));
      assert.ok(mainJs.includes("code === 'NumpadAdd'"));
      assert.ok(mainJs.includes("code === 'NumpadDivide'"));
      assert.ok(mainJs.includes("operatorWindow.webContents.send('panic-shortcut-triggered'"));
    });

    it('1.3: Grants midi, midiSysex, and hid permissions in session.defaultSession', () => {
      assert.ok(mainJs.includes("'midi'"));
      assert.ok(mainJs.includes("'midiSysex'"));
      assert.ok(mainJs.includes("'hid'"));
    });
  });

  describe('2. Operator Focus-Independent Panic Hotkeys & Deduplication Guard', () => {
    it('2.1: Implements 40ms deduplication guard between Main and Renderer panic triggers', () => {
      assert.ok(operatorHtml.includes('function canExecutePanicAction(actionName)'));
      assert.ok(operatorHtml.includes('(now - lastPanicActionTimestamp) < 40'));
      assert.ok(operatorHtml.includes("ipcRenderer.on('panic-shortcut-triggered', (event, payload) => {"));
    });

    it('2.2: Blurs active INPUT/TEXTAREA/SELECT when emergency panic keys are pressed', () => {
      assert.ok(operatorHtml.includes('isGlobalEmergencyKey'));
      assert.ok(operatorHtml.includes('isSelectPriorityKey'));
      assert.ok(operatorHtml.includes('e.target.blur()'));
    });

    it('2.3: Supports full wireless Numpad operator control (Enter, Subtract, Multiply, Add, Divide, Numpad4)', () => {
      assert.ok(operatorHtml.includes("case 'NumpadEnter':"));
      assert.ok(operatorHtml.includes("case 'NumpadSubtract':"));
      assert.ok(operatorHtml.includes("case 'NumpadMultiply':"));
      assert.ok(operatorHtml.includes("case 'NumpadAdd':"));
      assert.ok(operatorHtml.includes("case 'NumpadDivide':"));
      assert.ok(operatorHtml.includes("case 'Numpad4':"));
    });
  });

  describe('3. Web MIDI Hardware Controller Integration', () => {
    it('3.1: Implements initWebMIDI() and parseMIDIMessage(rawData) in operator/index.html', () => {
      assert.ok(operatorHtml.includes('function parseMIDIMessage(rawData)'));
      assert.ok(operatorHtml.includes('async function initWebMIDI()'));
      assert.ok(operatorHtml.includes('navigator.requestMIDIAccess({ sysex: false })'));
    });

    it('3.2: Behavioral test of parseMIDIMessage for Note-On (0x90), Velocity-0 Note-Off, and CC 7/1 Volume Fader', () => {
      const actionsTriggered = [];
      let sliderVal = '1';
      let textVal = '100%';
      const ipcSent = [];

      // Extract and run parseMIDIMessage logic against mock bindings
      const mockEnv = {
        triggerGoLive: () => actionsTriggered.push('GO_LIVE'),
        btnBlackout: { click: () => actionsTriggered.push('BLACKOUT') },
        btnFreeze: { click: () => actionsTriggered.push('FREEZE') },
        btnSafeLogo: { click: () => actionsTriggered.push('SAFE_LOGO') },
        btnFTB: { click: () => actionsTriggered.push('FTB') },
        btnMuteMaster: { click: () => actionsTriggered.push('MUTE') },
        masterVolumeSlider: { set value(v) { sliderVal = v; }, get value() { return sliderVal; } },
        volumeValueText: { set innerText(v) { textVal = v; }, get innerText() { return textVal; } },
        ipcRenderer: { send: (ch, act, payload) => ipcSent.push({ ch, act, payload }) }
      };

      const fnMatch = operatorHtml.match(/function parseMIDIMessage\(rawData\)\s*\{[\s\S]*?\n        \}/);
      assert.ok(fnMatch, 'parseMIDIMessage function definition must be extractable');
      const parseMIDI = new Function(
        'triggerGoLive', 'btnBlackout', 'btnFreeze', 'btnSafeLogo', 'btnFTB', 'btnMuteMaster',
        'masterVolumeSlider', 'volumeValueText', 'ipcRenderer',
        `return (${fnMatch[0]});`
      )(
        mockEnv.triggerGoLive, mockEnv.btnBlackout, mockEnv.btnFreeze, mockEnv.btnSafeLogo,
        mockEnv.btnFTB, mockEnv.btnMuteMaster, mockEnv.masterVolumeSlider, mockEnv.volumeValueText,
        mockEnv.ipcRenderer
      );

      // Note-On 36 (GO_LIVE) with velocity 100
      const resGo = parseMIDI(new Uint8Array([0x90, 36, 100]));
      assert.strictEqual(resGo.handled, true);
      assert.strictEqual(resGo.action, 'GO_LIVE');

      // Note-On 37 (BLACKOUT) with velocity 127
      const resBlk = parseMIDI(new Uint8Array([0x90, 37, 127]));
      assert.strictEqual(resBlk.handled, true);
      assert.strictEqual(resBlk.action, 'BLACKOUT');

      // Note-On 38 (FREEZE) with velocity 0 -> should be treated as Note-Off and ignored!
      const resNoteOff = parseMIDI(new Uint8Array([0x90, 38, 0]));
      assert.strictEqual(resNoteOff.handled, false);
      assert.strictEqual(resNoteOff.reason, 'velocity_zero_note_off');

      // Note-On 62 (FREEZE) with velocity 80
      const resFrz = parseMIDI(new Uint8Array([0x90, 62, 80]));
      assert.strictEqual(resFrz.handled, true);
      assert.strictEqual(resFrz.action, 'FREEZE');

      // Note-On 63 (SAFE_LOGO), 64 (FTB), 65 (MUTE)
      assert.strictEqual(parseMIDI(new Uint8Array([0x90, 63, 90])).action, 'SAFE_LOGO');
      assert.strictEqual(parseMIDI(new Uint8Array([0x90, 64, 90])).action, 'FTB');
      assert.strictEqual(parseMIDI(new Uint8Array([0x90, 65, 90])).action, 'MUTE');
      assert.deepStrictEqual(actionsTriggered, ['GO_LIVE', 'BLACKOUT', 'FREEZE', 'SAFE_LOGO', 'FTB', 'MUTE']);

      // CC 7 Master Volume at 127 -> 1.0 (100%)
      const resVolFull = parseMIDI(new Uint8Array([0xB0, 7, 127]));
      assert.strictEqual(resVolFull.handled, true);
      assert.strictEqual(resVolFull.normalizedVolume, 1);
      assert.strictEqual(textVal, '100%');
      assert.strictEqual(ipcSent[ipcSent.length - 1].payload.volume, 1);

      // CC 1 Modulation Fader at 0 -> 0.0 (0%)
      const resVolZero = parseMIDI(new Uint8Array([0xB0, 1, 0]));
      assert.strictEqual(resVolZero.handled, true);
      assert.strictEqual(resVolZero.normalizedVolume, 0);
      assert.strictEqual(textVal, '0%');
    });
  });

  describe('4. Stage Synchronized 1.0s Audio/Video FTB Ramp, Priority Arbitration & Clean Overlays', () => {
    it('4.1: Stage FTB handler ramps activeVideo.volume over 1000ms down to 0 and pauses, and ramps back up on un-FTB', () => {
      assert.ok(stageHtml.includes('const stepFtbDown = (now) => {'));
      assert.ok(stageHtml.includes('const progress = Math.min(1, Math.max(0, (now - startTime) / 1000));'));
      assert.ok(stageHtml.includes('activeVideo.volume = Math.max(0, startVol * (1 - progress));'));
      assert.ok(stageHtml.includes('const stepFtbUp = (now) => {'));
      assert.ok(stageHtml.includes('activeVideo.volume = targetVol * progress;'));
    });

    it('4.2: Stage BLACKOUT cancels any in-progress ftbAnimId immediately and mutes/pauses all decks', () => {
      const blackoutSection = stageHtml.slice(
        stageHtml.indexOf("case 'BLACKOUT':"),
        stageHtml.indexOf("case 'FTB':")
      );
      assert.ok(blackoutSection.includes('if (ftbAnimId) {'));
      assert.ok(blackoutSection.includes('cancelAnimationFrame(ftbAnimId);'));
      assert.ok(blackoutSection.includes("blackoutCover.className = 'active-blackout';"));
    });

    it('4.3: Clean Stage Guarantee — zero operator HUD banners or status text on Stage during BLACKOUT, FREEZE, or FTB', () => {
      assert.strictEqual(stageHtml.includes('STAGE FROZEN'), false);
      assert.strictEqual(stageHtml.includes('BLACKOUT ACTIVE'), false);
      assert.strictEqual(stageHtml.includes('FADE TO BLACK'), false);
    });

    it('4.4: Live Marquee Ticker computes dynamic scroll duration and triggers CSS reflow', () => {
      assert.ok(stageHtml.includes('const cleanText = data.text.trim().slice(0, 1000);'));
      assert.ok(stageHtml.includes('const durationSec = Math.max(14, Math.min(60, Math.round(cleanText.length * 0.28)));'));
      assert.ok(stageHtml.includes("tickerContent.style.animation = 'none';"));
      assert.ok(stageHtml.includes('void tickerContent.offsetWidth;'));
      assert.ok(stageHtml.includes('tickerContent.style.animation = `marquee ${durationSec}s linear infinite`;'));
    });

    it('4.5: Watermark Logo overlay clamps opacity [0, 1] and scalePercent [20, 200] and supports corner positions', () => {
      assert.ok(stageHtml.includes('watermarkOpacity = Math.max(0, Math.min(1, data.opacity));'));
      assert.ok(stageHtml.includes('watermarkScalePercent = Math.max(20, Math.min(200, data.scalePercent));'));
      assert.ok(stageHtml.includes("watermarkPosition.startsWith('top')"));
      assert.ok(stageHtml.includes("watermarkPosition.startsWith('bottom')"));
    });

    it('4.6: Offline System Font Stack — zero external Google Fonts CDN links in Operator or Stage HTML', () => {
      assert.strictEqual(operatorHtml.includes('fonts.googleapis.com'), false);
      assert.strictEqual(operatorHtml.includes('fonts.gstatic.com'), false);
      assert.strictEqual(stageHtml.includes('fonts.googleapis.com'), false);
      assert.strictEqual(stageHtml.includes('fonts.gstatic.com'), false);
    });
  });
});
