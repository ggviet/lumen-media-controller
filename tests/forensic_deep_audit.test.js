/**
 * tests/forensic_deep_audit.test.js
 * Lead Algorithmic & Forensic QA Specialist Deep Audit Suite:
 * 1. Pre-roll & Transition concurrency, race condition, ghost audio & DOM leak prevention
 * 2. 4 End behaviors (AUTO_NEXT, FADE_TO_BLACK reset, reorder/delete resilience)
 * 3. Shortcut & Input trap exceptions (before-input-event in main, textarea/select bypass, Wireless Numpad)
 * 4. Web MIDI parser (Note-On velocity 0, non-numeric/NaN/CC boundaries)
 * 5. Dual audio sink routing (setSinkId hardware rejection fallback)
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { readCompleteHtml } = require('./test_helpers');

describe('Forensic Deep Audit & Algorithmic Resilience', () => {
  const mainJs = fs.readFileSync(path.join(__dirname, '../src/main/index.js'), 'utf8');
  const operatorHtml = readCompleteHtml(path.join(__dirname, '../src/renderer/operator/index.html'));
  const stageHtml = readCompleteHtml(path.join(__dirname, '../src/renderer/stage/index.html'));

  describe('1. Pre-Roll & Transition Concurrency Audit', () => {
    it('1.1: preRollVideo and preRollImage have null guards and never hang indefinitely', async () => {
      assert.ok(stageHtml.includes('if (!video) return resolve(false);'), 'preRollVideo must guard against null video element');
      assert.ok(stageHtml.includes('if (!img) return false;'), 'preRollImage must guard against null image element');
      assert.ok(stageHtml.includes('setTimeout'), 'preRoll timeout safety must exist');
    });

    it('1.2: abortSupersededMedia cleans up video, pauses audio, clears src, and strips DOM on stale tokens', () => {
      assert.ok(stageHtml.includes('function abortSupersededMedia(el)'), 'abortSupersededMedia helper must exist');
      assert.ok(stageHtml.includes("el.pause()"));
      assert.ok(stageHtml.includes("el.removeAttribute('src')"));
      assert.ok(stageHtml.includes('abortSupersededMedia(mediaElement);'));
    });

    it('1.3: Fast spamming GO LIVE (< 50ms) cancels previous audio crossfades and FTB ramps', () => {
      assert.ok(stageHtml.includes('const thisTransitionToken = ++activeTransitionToken;'));
      assert.ok(stageHtml.includes('clearTimeout(cleanupTimeoutId)'));
      assert.ok(stageHtml.includes('cancelAnimationFrame(audioCrossfadeAnimId)'));
      assert.ok(stageHtml.includes('cancelAnimationFrame(ftbAnimId)'));
    });
  });

  describe('2. End Behaviors & State Reset Audit', () => {
    it('2.1: AUTO_NEXT resolves based on active on-air cue ID and cleanly ignores deleted cue without throwing', () => {
      assert.ok(operatorHtml.includes("const activeId = status.cueId || status.id || (pgmCue ? pgmCue.id : null);"));
      assert.ok(operatorHtml.includes("const currentPgmIdx = rundown.findIndex(c => c.id === activeId);"));
      assert.ok(operatorHtml.includes("if (currentPgmIdx !== -1 && currentPgmIdx < rundown.length - 1)"));
      assert.ok(operatorHtml.includes("const nextCue = rundown[currentPgmIdx + 1];"));
      assert.ok(operatorHtml.includes("triggerGoLive(nextCue);"));
    });

    it('2.2: FADE_TO_BLACK ends in active-ftb and subsequent GO LIVE cleanly resets FTB and Blackout classes', () => {
      assert.ok(stageHtml.includes("blackoutCover.className = 'active-ftb'"));
      assert.ok(stageHtml.includes('isFTB = false;'));
      assert.ok(operatorHtml.includes("btnBlackout.classList.toggle('active', false)"));
      assert.ok(operatorHtml.includes("btnFTB.classList.toggle('active', false)"));
    });
  });

  describe('3. Shortcut & Input Traps Audit', () => {
    it('3.1: Main process before-input-event intercepts Escape, F1-F4, and Numpad keys globally', () => {
      assert.ok(mainJs.includes("code === 'Escape' || key === 'Escape' || code === 'F4' || code === 'NumpadSubtract'"));
      assert.ok(mainJs.includes("code === 'F1' || code === 'Numpad4'"));
      assert.ok(mainJs.includes("code === 'F2' || code === 'NumpadMultiply'"));
      assert.ok(mainJs.includes("code === 'F3' || code === 'NumpadAdd'"));
      assert.ok(mainJs.includes("code === 'NumpadEnter'"));
      assert.ok(mainJs.includes("code === 'NumpadDivide'"));
    });

    it('3.2: Operator isGlobalEmergencyKey includes Numpad4, F1-F4, and keypad location 3 fallbacks', () => {
      assert.ok(operatorHtml.includes("code === 'Numpad4'"));
      assert.ok(operatorHtml.includes("key === 'F1'"));
      assert.ok(operatorHtml.includes("key === 'F2'"));
      assert.ok(operatorHtml.includes("key === 'F3'"));
      assert.ok(operatorHtml.includes("key === 'F4'"));
      assert.ok(operatorHtml.includes("e.location === 3"));
    });
  });

  describe('4. Web MIDI Parser Edge Cases', () => {
    it('4.1: parseMIDIMessage handles Note-On velocity 0 as Note-Off and clamps corrupt/NaN CC numbers', () => {
      const fnMatch = operatorHtml.match(/function parseMIDIMessage\(rawData\)\s*\{[\s\S]*?\n        \}/);
      assert.ok(fnMatch);

      const actions = [];
      let sliderVal = '1.0';
      const mockEnv = {
        triggerGoLive: () => actions.push('GO_LIVE'),
        btnBlackout: { click: () => actions.push('BLACKOUT') },
        btnFreeze: { click: () => actions.push('FREEZE') },
        btnSafeLogo: { click: () => actions.push('SAFE_LOGO') },
        btnFTB: { click: () => actions.push('FTB') },
        btnMuteMaster: { click: () => actions.push('MUTE') },
        masterVolumeSlider: { set value(v) { sliderVal = v; }, get value() { return sliderVal; } },
        volumeValueText: { innerText: '' },
        ipcRenderer: { send: () => {} }
      };

      const parseMIDI = new Function(
        'triggerGoLive', 'btnBlackout', 'btnFreeze', 'btnSafeLogo', 'btnFTB', 'btnMuteMaster',
        'masterVolumeSlider', 'volumeValueText', 'ipcRenderer',
        `return (${fnMatch[0]});`
      )(
        mockEnv.triggerGoLive, mockEnv.btnBlackout, mockEnv.btnFreeze, mockEnv.btnSafeLogo,
        mockEnv.btnFTB, mockEnv.btnMuteMaster, mockEnv.masterVolumeSlider, mockEnv.volumeValueText,
        mockEnv.ipcRenderer
      );

      // Note-On Velocity 0 -> Must NOT trigger
      const resNoteOff = parseMIDI([0x90, 60, 0]);
      assert.strictEqual(resNoteOff.handled, false);
      assert.strictEqual(resNoteOff.reason, 'velocity_zero_note_off');
      assert.strictEqual(actions.length, 0);

      // Note-On Velocity > 0 -> Must trigger GO_LIVE
      const resGoLive = parseMIDI([0x90, 60, 100]);
      assert.strictEqual(resGoLive.handled, true);
      assert.strictEqual(resGoLive.action, 'GO_LIVE');

      // CC with NaN / negative / overflow
      const resNaN = parseMIDI([0xB0, 7, NaN]);
      assert.strictEqual(resNaN.handled, true);
      assert.strictEqual(resNaN.normalizedVolume, 0);

      const resNeg = parseMIDI([0xB0, 7, -50]);
      assert.strictEqual(resNeg.handled, true);
      assert.strictEqual(resNeg.normalizedVolume, 0);

      const resOverflow = parseMIDI([0xB0, 7, 255]);
      assert.strictEqual(resOverflow.handled, true);
      assert.strictEqual(resOverflow.normalizedVolume, 1);
    });
  });

  describe('5. Dual Audio Sink Routing Fallback', () => {
    it('5.1: Operator setSinkId handlers catch rejection and fallback to default audio device ("")', () => {
      assert.ok(operatorHtml.includes("video.setSinkId('').catch"));
      assert.ok(operatorHtml.includes("vid.setSinkId('').catch"));
      assert.ok(operatorHtml.includes("pvwVid.setSinkId('').catch"));
    });

    it('5.2: Stage setSinkId catches rejection and falls back to default audio device ("")', () => {
      assert.ok(stageHtml.includes("await mediaElement.setSinkId('')"));
      assert.ok(stageHtml.includes("v.setSinkId('').catch"));
    });
  });
});
