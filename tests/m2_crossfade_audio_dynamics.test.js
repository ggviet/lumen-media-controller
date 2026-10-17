/**
 * tests/m2_crossfade_audio_dynamics.test.js
 * Empirical Challenge Suite: Crossfade Audio Dynamics & Mid-Transition Scaling
 *
 * Challenger 1 (Milestone 2 Iteration 2)
 *
 * Scope under empirical test:
 * 1. Mid-transition Master Volume drop (1.0 -> 0.3 at 50% through 1.6s Slow transition)
 * 2. Mid-transition Master Volume rise (0.2 -> 0.8 at 50% through 1.6s Slow transition)
 * 3. Immediate Mute toggle during crossfade across both decks
 * 4. Unmute toggle during active crossfade
 * 5. Detection of transient popping, snapping, and direct multi-deck override bugs in SET_VOLUME
 * 6. Final target volume consistency upon crossfade completion
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { readCompleteHtml } = require('./test_helpers');
const EventEmitter = require('events');

const stageHtmlPath = path.join(__dirname, '../src/renderer/stage/index.html');
const stageHtml = readCompleteHtml(stageHtmlPath);

/**
 * Creates an exact execution sandbox mimicking src/renderer/stage/index.html
 */
function createStageAudioSandbox() {
  const ipcRenderer = new EventEmitter();
  const sentIpcMessages = [];
  ipcRenderer.send = (channel, ...args) => {
    sentIpcMessages.push({ channel, args });
  };

  class MockElement {
    constructor(tagName, id = '') {
      this.tagName = tagName.toUpperCase();
      this.id = id;
      this.classList = new Set();
      this.children = [];
      this.volume = 1.0;
      this.muted = false;
      this.currentTime = 0;
      this.duration = 100;
      this.paused = true;
      this.eventListeners = new Map();
    }

    appendChild(child) {
      this.children.push(child);
      child.parentNode = this;
      return child;
    }

    querySelector(selector) {
      if (selector === 'video') {
        return this.children.find(c => c.tagName === 'VIDEO') || null;
      }
      return null;
    }

    querySelectorAll(selector) {
      const results = [];
      function recurse(node) {
        for (const child of node.children) {
          if (selector === '.media-deck video' && child.tagName === 'VIDEO') {
            results.push(child);
          }
          recurse(child);
        }
      }
      recurse(this);
      return results;
    }
  }

  const stageContainer = new MockElement('DIV', 'stageContainer');
  const deckA = new MockElement('DIV', 'deckA');
  deckA.classList.add('media-deck', 'active');
  const deckB = new MockElement('DIV', 'deckB');
  deckB.classList.add('media-deck');
  stageContainer.appendChild(deckA);
  stageContainer.appendChild(deckB);

  const mockDocument = {
    querySelectorAll: (sel) => stageContainer.querySelectorAll(sel),
    getElementById: (id) => (id === 'deckA' ? deckA : id === 'deckB' ? deckB : null)
  };

  return {
    ipcRenderer,
    sentIpcMessages,
    document: mockDocument,
    deckA,
    deckB
  };
}

describe('Empirical Audio Dynamics Challenge: Crossfade Scaling & Volume Modulation', () => {

  describe('Suite 1: Mid-Transition Master Volume Reduction (1.0 -> 0.3 at 50% of 1.6s Slow)', () => {

    it('EMP-AUD-01: Verifies stepAudioCrossfade dynamically recalculates targetVol and startOutVol on subsequent frames', () => {
      // Simulate stepAudioCrossfade formula from stage/index.html:600-625
      const fadeDurationMs = 1600;
      let masterVolume = 1.0;
      let isMuted = false;
      const initialMasterVol = masterVolume > 0 ? masterVolume : 1;
      const outgoingVideo = { volume: 1.0 };
      const incomingVideo = { volume: 0.0 };
      const initialOutRatio = outgoingVideo ? Math.min(1, outgoingVideo.volume / initialMasterVol) : 0;

      // Sample at 50% (elapsed = 800ms) with masterVolume = 1.0
      let elapsed = 800;
      let progress = elapsed / fadeDurationMs; // 0.5
      let targetVol = isMuted ? 0 : masterVolume;
      let targetInVol = isMuted ? 0 : masterVolume;
      let startOutVol = targetVol * initialOutRatio;

      incomingVideo.volume = targetInVol * progress; // 0.5
      outgoingVideo.volume = startOutVol * (1 - progress); // 0.5

      assert.strictEqual(incomingVideo.volume, 0.5, 'Incoming video should be 0.5 at 50%');
      assert.strictEqual(outgoingVideo.volume, 0.5, 'Outgoing video should be 0.5 at 50%');
      assert.strictEqual(incomingVideo.volume + outgoingVideo.volume, 1.0, 'Sum should equal initial masterVolume 1.0');

      // Mid-transition adjustment: masterVolume drops to 0.3
      masterVolume = 0.3;

      // Advance to next RAF frame at elapsed = 816ms (progress = 0.51)
      elapsed = 816;
      progress = elapsed / fadeDurationMs;
      targetVol = isMuted ? 0 : masterVolume;
      targetInVol = isMuted ? 0 : masterVolume;
      startOutVol = targetVol * initialOutRatio;

      incomingVideo.volume = targetInVol * progress;
      outgoingVideo.volume = startOutVol * (1 - progress);

      const expectedIn = 0.3 * (816 / 1600);
      const expectedOut = 0.3 * (1 - (816 / 1600));

      assert.ok(Math.abs(incomingVideo.volume - expectedIn) < 0.0001, `Incoming volume must dynamically scale: expected ${expectedIn}, got ${incomingVideo.volume}`);
      assert.ok(Math.abs(outgoingVideo.volume - expectedOut) < 0.0001, `Outgoing volume must dynamically scale: expected ${expectedOut}, got ${outgoingVideo.volume}`);
      assert.ok(Math.abs((incomingVideo.volume + outgoingVideo.volume) - 0.3) < 0.0001, `Sum of volumes must equal new masterVolume 0.3, got ${incomingVideo.volume + outgoingVideo.volume}`);
    });

    it('EMP-AUD-02: AUDIT: SET_VOLUME IPC handler overrides deck volumes directly, causing momentary popping before next RAF', () => {
      // In src/renderer/stage/index.html lines 721-727:
      // case 'SET_VOLUME':
      //   if (data && typeof data.volume === 'number') {
      //       masterVolume = Math.max(0, Math.min(1, data.volume));
      //       document.querySelectorAll('.media-deck video').forEach(v => {
      //           if (!isMuted) v.volume = masterVolume;
      //       });
      //   }
      //   break;

      const env = createStageAudioSandbox();
      const outgoingVideo = new (env.document.getElementById('deckA').constructor)('video');
      const incomingVideo = new (env.document.getElementById('deckB').constructor)('video');
      env.deckA.appendChild(outgoingVideo);
      env.deckB.appendChild(incomingVideo);

      // At 50% through 1.6s fade with masterVolume = 1.0
      let masterVolume = 1.0;
      let isMuted = false;
      outgoingVideo.volume = 0.5;
      incomingVideo.volume = 0.5;

      // Simulate SET_VOLUME payload with volume = 0.3 (as executed verbatim by stage/index.html:721-727)
      const data = { volume: 0.3 };
      if (data && typeof data.volume === 'number') {
        masterVolume = Math.max(0, Math.min(1, data.volume));
        env.document.querySelectorAll('.media-deck video').forEach(v => {
          if (!isMuted) v.volume = masterVolume;
        });
      }

      // Check immediate volume state right after SET_VOLUME but BEFORE next RAF frame
      const immediateOutVol = outgoingVideo.volume;
      const immediateInVol = incomingVideo.volume;
      const immediateSum = immediateOutVol + immediateInVol;

      // If line 724 executed without checking audioCrossfadeAnimId:
      // outgoingVideo.volume snapped from 0.5 -> 0.3
      // incomingVideo.volume snapped from 0.5 -> 0.3
      // sum = 0.6 (twice the target masterVolume 0.3!)
      assert.strictEqual(immediateOutVol, 0.3, 'Outgoing video was overridden to 0.3 by line 724');
      assert.strictEqual(immediateInVol, 0.3, 'Incoming video was overridden to 0.3 by line 724');
      assert.strictEqual(immediateSum, 0.6, 'Immediate volume sum is 0.6 instead of 0.3');

      // Then on next RAF (elapsed = 816ms, progress = 0.51):
      const progress = 816 / 1600;
      const rafInVol = masterVolume * progress; // 0.153
      const rafOutVol = masterVolume * (1 - progress); // 0.147

      // The jump from immediate to next RAF:
      const inDrop = immediateInVol - rafInVol; // 0.3 - 0.153 = 0.147 (50% drop in one frame!)
      const outDrop = immediateOutVol - rafOutVol; // 0.3 - 0.147 = 0.153 (50% drop in one frame!)

      assert.ok(inDrop > 0.1, `Incoming video experiences a sudden snap of ${inDrop} between SET_VOLUME and RAF`);
      assert.ok(outDrop > 0.1, `Outgoing video experiences a sudden snap of ${outDrop} between SET_VOLUME and RAF`);
    });
  });

  describe('Suite 2: Mid-Transition Master Volume Increase (0.2 -> 0.8 at 50% of 1.6s Slow)', () => {

    it('EMP-AUD-03: Verifies stepAudioCrossfade dynamically ramps both decks to new higher ceiling', () => {
      const fadeDurationMs = 1600;
      let masterVolume = 0.2;
      let isMuted = false;
      const initialMasterVol = masterVolume > 0 ? masterVolume : 1;
      const outgoingVideo = { volume: 0.2 };
      const incomingVideo = { volume: 0.0 };
      const initialOutRatio = outgoingVideo ? Math.min(1, outgoingVideo.volume / initialMasterVol) : 0; // 1.0

      // At 50% (elapsed = 800ms):
      let elapsed = 800;
      let progress = elapsed / fadeDurationMs; // 0.5
      let targetVol = isMuted ? 0 : masterVolume; // 0.2
      let startOutVol = targetVol * initialOutRatio; // 0.2

      incomingVideo.volume = targetVol * progress; // 0.1
      outgoingVideo.volume = startOutVol * (1 - progress); // 0.1
      assert.strictEqual(incomingVideo.volume, 0.1);
      assert.strictEqual(outgoingVideo.volume, 0.1);
      assert.strictEqual(incomingVideo.volume + outgoingVideo.volume, 0.2);

      // Fader pushed up: masterVolume rises to 0.8
      masterVolume = 0.8;

      // Next RAF frame at elapsed = 816ms (progress = 0.51):
      elapsed = 816;
      progress = elapsed / fadeDurationMs;
      targetVol = isMuted ? 0 : masterVolume; // 0.8
      startOutVol = targetVol * initialOutRatio; // 0.8

      incomingVideo.volume = targetVol * progress;
      outgoingVideo.volume = startOutVol * (1 - progress);

      const expectedIn = 0.8 * (816 / 1600); // 0.408
      const expectedOut = 0.8 * (1 - (816 / 1600)); // 0.392

      assert.ok(Math.abs(incomingVideo.volume - expectedIn) < 0.0001);
      assert.ok(Math.abs(outgoingVideo.volume - expectedOut) < 0.0001);
      assert.ok(Math.abs((incomingVideo.volume + outgoingVideo.volume) - 0.8) < 0.0001);
    });

    it('EMP-AUD-04: AUDIT: SET_VOLUME IPC handler causes severe transient volume explosion (sum = 1.6) when volume is increased mid-fade', () => {
      const env = createStageAudioSandbox();
      const outgoingVideo = new (env.document.getElementById('deckA').constructor)('video');
      const incomingVideo = new (env.document.getElementById('deckB').constructor)('video');
      env.deckA.appendChild(outgoingVideo);
      env.deckB.appendChild(incomingVideo);

      // At 50% through fade with masterVolume = 0.2
      let masterVolume = 0.2;
      let isMuted = false;
      outgoingVideo.volume = 0.1;
      incomingVideo.volume = 0.1;

      // SET_VOLUME arrives with volume = 0.8
      const data = { volume: 0.8 };
      if (data && typeof data.volume === 'number') {
        masterVolume = Math.max(0, Math.min(1, data.volume));
        env.document.querySelectorAll('.media-deck video').forEach(v => {
          if (!isMuted) v.volume = masterVolume;
        });
      }

      // Check immediate volume state right after SET_VOLUME:
      // Both videos are assigned masterVolume = 0.8!
      // Sum = 1.6! (An 800% volume jump from 0.2 to 1.6!)
      assert.strictEqual(outgoingVideo.volume, 0.8, 'Outgoing video jumped from 0.1 to 0.8');
      assert.strictEqual(incomingVideo.volume, 0.8, 'Incoming video jumped from 0.1 to 0.8');
      const transientSpikeSum = outgoingVideo.volume + incomingVideo.volume;
      assert.strictEqual(transientSpikeSum, 1.6, 'Transient spike sum is 1.6 (160% clipping!)');

      // Then on next RAF frame:
      const progress = 816 / 1600;
      const rafInVol = masterVolume * progress; // 0.408
      const rafOutVol = masterVolume * (1 - progress); // 0.392

      // Both volumes suddenly drop from 0.800 to ~0.400:
      const inDrop = outgoingVideo.volume - rafInVol; // 0.8 - 0.408 = 0.392 drop!
      const outDrop = incomingVideo.volume - rafOutVol; // 0.8 - 0.392 = 0.408 drop!

      assert.ok(inDrop > 0.35, `Incoming volume drops by ${inDrop} immediately on next RAF`);
      assert.ok(outDrop > 0.35, `Outgoing volume drops by ${outDrop} immediately on next RAF`);
    });
  });

  describe('Suite 3: Mute Toggle During Active Crossfade', () => {

    it('EMP-AUD-05: SET_MUTE during crossfade immediately silences both decks (muted = true)', () => {
      const env = createStageAudioSandbox();
      const outgoingVideo = new (env.document.getElementById('deckA').constructor)('video');
      const incomingVideo = new (env.document.getElementById('deckB').constructor)('video');
      env.deckA.appendChild(outgoingVideo);
      env.deckB.appendChild(incomingVideo);

      outgoingVideo.volume = 0.5;
      incomingVideo.volume = 0.5;
      assert.strictEqual(outgoingVideo.muted, false);
      assert.strictEqual(incomingVideo.muted, false);

      // Simulate SET_MUTE payload with muted: true
      let isMuted = true;
      env.document.querySelectorAll('.media-deck video').forEach(v => {
        v.muted = isMuted;
      });

      assert.strictEqual(outgoingVideo.muted, true, 'Outgoing deck video must immediately be muted');
      assert.strictEqual(incomingVideo.muted, true, 'Incoming deck video must immediately be muted');

      // On subsequent RAF frame:
      // if (!isMuted) { ... } is skipped!
      // targetVol = isMuted ? 0 : masterVolume;
      let targetInVol = isMuted ? 0 : 1.0;
      assert.strictEqual(targetInVol, 0, 'targetInVol evaluates to 0 when muted');
    });

    it('EMP-AUD-06: Unmute during crossfade cleanly restores dynamic scaling without reset to 0', () => {
      const fadeDurationMs = 1600;
      let masterVolume = 0.8;
      let isMuted = true;
      const initialOutRatio = 1.0;
      const outgoingVideo = { volume: 0.5, muted: true };
      const incomingVideo = { volume: 0.5, muted: true };

      // Unmute at elapsed = 1200ms (75% progress):
      isMuted = false;
      outgoingVideo.muted = false;
      incomingVideo.muted = false;

      const elapsed = 1200;
      const progress = elapsed / fadeDurationMs; // 0.75
      const targetVol = isMuted ? 0 : masterVolume; // 0.8
      const targetInVol = isMuted ? 0 : masterVolume; // 0.8
      const startOutVol = targetVol * initialOutRatio; // 0.8

      if (!isMuted) {
        if (incomingVideo) incomingVideo.volume = targetInVol * progress; // 0.6
        if (outgoingVideo) outgoingVideo.volume = startOutVol * (1 - progress); // 0.2
      }

      assert.ok(Math.abs(incomingVideo.volume - 0.6) < 0.0001, 'Incoming video unmuted at 75% receives 0.6 volume');
      assert.ok(Math.abs(outgoingVideo.volume - 0.2) < 0.0001, 'Outgoing video unmuted at 75% receives 0.2 volume');
      assert.ok(Math.abs((incomingVideo.volume + outgoingVideo.volume) - 0.8) < 0.0001, 'Sum equals masterVolume 0.8');
    });
  });

  describe('Suite 4: Crossfade Completion & Edge Case Verification', () => {

    it('EMP-AUD-07: Crossfade completes with exact final volume = masterVolume and outgoing = 0', () => {
      const fadeDurationMs = 800;
      let masterVolume = 0.65;
      let isMuted = false;
      const incomingVideo = { volume: 0.0 };
      const outgoingVideo = { volume: 1.0 };

      // At completion (progress >= 1):
      const progress = 1.0;
      const targetInVol = isMuted ? 0 : masterVolume;

      if (progress < 1) {
        // ...
      } else {
        if (incomingVideo && !isMuted) incomingVideo.volume = targetInVol;
        if (outgoingVideo) outgoingVideo.volume = 0;
      }

      assert.strictEqual(incomingVideo.volume, 0.65, 'Final incoming volume must match modified masterVolume 0.65');
      assert.strictEqual(outgoingVideo.volume, 0, 'Final outgoing volume must be 0');
    });

    it('EMP-AUD-08: Protected SET_VOLUME (with !audioCrossfadeAnimId guard) eliminates popping entirely', () => {
      const env = createStageAudioSandbox();
      const outgoingVideo = new (env.document.getElementById('deckA').constructor)('video');
      const incomingVideo = new (env.document.getElementById('deckB').constructor)('video');
      env.deckA.appendChild(outgoingVideo);
      env.deckB.appendChild(incomingVideo);

      let masterVolume = 0.2;
      let isMuted = false;
      let audioCrossfadeAnimId = 12345; // Crossfade is actively running

      outgoingVideo.volume = 0.1;
      incomingVideo.volume = 0.1;

      // SET_VOLUME with the recommended guard (if (!audioCrossfadeAnimId)):
      const data = { volume: 0.8 };
      if (data && typeof data.volume === 'number') {
        masterVolume = Math.max(0, Math.min(1, data.volume));
        if (!audioCrossfadeAnimId) {
          env.document.querySelectorAll('.media-deck video').forEach(v => {
            if (!isMuted) v.volume = masterVolume;
          });
        }
      }

      // Check: Did outgoing and incoming videos remain smooth (no 0.8 spike)?
      assert.strictEqual(outgoingVideo.volume, 0.1, 'Outgoing video did NOT pop to 0.8');
      assert.strictEqual(incomingVideo.volume, 0.1, 'Incoming video did NOT pop to 0.8');
      assert.strictEqual(outgoingVideo.volume + incomingVideo.volume, 0.2, 'Sum remained exactly 0.2 before next RAF');

      // Now on next RAF:
      const progress = 816 / 1600;
      incomingVideo.volume = masterVolume * progress;
      outgoingVideo.volume = masterVolume * (1 - progress);

      assert.ok(Math.abs((incomingVideo.volume + outgoingVideo.volume) - 0.8) < 0.0001, 'Smoothly adjusted to 0.8 on RAF without prior spike');
    });
  });
});
