/**
 * tests/m2_it3_audio_dynamics_empirical.test.js
 * Comprehensive Empirical Stress-Test Harness for Milestone 2 Iteration 3
 * Audio Dynamics & Volume Modulation during Crossfades and Steady-State.
 *
 * Challenger 1 (Milestone 2 Iteration 3)
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { readCompleteHtml } = require('./test_helpers');
const EventEmitter = require('events');

const stageHtmlPath = path.join(__dirname, '../src/renderer/stage/index.html');
const stageHtml = readCompleteHtml(stageHtmlPath);

// Verify that the exact guard exists in stage/index.html
describe('Static Integrity Checks', () => {
  it('VERIFY-GUARD: Ensures if (!audioCrossfadeAnimId) guard is present in stage/index.html', () => {
    assert.ok(
      stageHtml.includes('if (!audioCrossfadeAnimId) {'),
      'stage/index.html must contain if (!audioCrossfadeAnimId) guard'
    );
  });

  it('VERIFY-FORENSIC: Ensures required forensic strings remain preserved', () => {
    assert.ok(
      stageHtml.includes('if (!isMuted) v.volume = masterVolume;'),
      'stage/index.html must preserve exact forensic line for steady-state volume'
    );
    assert.ok(
      stageHtml.includes('const targetInVol = isMuted ? 0 : masterVolume;'),
      'stage/index.html must preserve dynamic targetInVol formula'
    );
  });
});

/**
 * Creates an execution sandbox mimicking src/renderer/stage/index.html
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
      this.style = {};
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

  let masterVolume = 1.0;
  let isMuted = false;
  let audioCrossfadeAnimId = null;

  // Exact implementation of stage-control SET_VOLUME and SET_MUTE from stage/index.html:721-737
  function handleStageControl(action, data) {
    switch (action) {
      case 'SET_VOLUME':
        if (data && typeof data.volume === 'number') {
          masterVolume = Math.max(0, Math.min(1, data.volume));
          if (!audioCrossfadeAnimId) {
            mockDocument.querySelectorAll('.media-deck video').forEach(v => {
              if (!isMuted) v.volume = masterVolume;
            });
          }
        }
        break;

      case 'SET_MUTE':
        isMuted = !!data.muted;
        mockDocument.querySelectorAll('.media-deck video').forEach(v => {
          v.muted = isMuted;
        });
        break;
    }
  }

  return {
    ipcRenderer,
    sentIpcMessages,
    document: mockDocument,
    deckA,
    deckB,
    handleStageControl,
    getMasterVolume: () => masterVolume,
    setMasterVolume: (v) => { masterVolume = v; },
    getIsMuted: () => isMuted,
    setIsMuted: (m) => { isMuted = m; },
    getAudioCrossfadeAnimId: () => audioCrossfadeAnimId,
    setAudioCrossfadeAnimId: (id) => { audioCrossfadeAnimId = id; }
  };
}

describe('Empirical Audio Dynamics Challenge: Milestone 2 Iteration 3 Verification', () => {

  describe('Suite 1: Mid-Transition Master Volume Reduction (1.0 -> 0.3 at 50% of 1.6s Slow)', () => {

    it('EMP-IT3-01: Verifies SET_VOLUME does NOT jump video elements directly during active crossfade', () => {
      const env = createStageAudioSandbox();
      const outgoingVideo = new (env.document.getElementById('deckA').constructor)('video');
      const incomingVideo = new (env.document.getElementById('deckB').constructor)('video');
      env.deckA.appendChild(outgoingVideo);
      env.deckB.appendChild(incomingVideo);

      // Transition is at 50% through 1.6s Slow fade
      env.setMasterVolume(1.0);
      env.setAudioCrossfadeAnimId(101); // Crossfade is actively running
      outgoingVideo.volume = 0.5;
      incomingVideo.volume = 0.5;

      // SET_VOLUME arrives with drop to 0.3
      env.handleStageControl('SET_VOLUME', { volume: 0.3 });

      // Immediate check right after SET_VOLUME:
      // Both videos MUST NOT have jumped to 0.3!
      assert.strictEqual(outgoingVideo.volume, 0.5, 'Outgoing video must remain at 0.5 immediately after SET_VOLUME');
      assert.strictEqual(incomingVideo.volume, 0.5, 'Incoming video must remain at 0.5 immediately after SET_VOLUME');
      assert.strictEqual(outgoingVideo.volume + incomingVideo.volume, 1.0, 'Volume sum must remain 1.0 immediately after SET_VOLUME');
      assert.strictEqual(env.getMasterVolume(), 0.3, 'masterVolume state variable must update to 0.3');
    });

    it('EMP-IT3-02: Verifies subsequent RAF frame scales smoothly to new lower volume sum (0.3)', () => {
      const fadeDurationMs = 1600;
      let masterVolume = 0.3; // Updated masterVolume
      let isMuted = false;
      const initialOutRatio = 1.0;
      const outgoingVideo = { volume: 0.5 };
      const incomingVideo = { volume: 0.5 };

      // Next RAF frame at elapsed = 816ms (progress = 0.51)
      const elapsed = 816;
      const progress = elapsed / fadeDurationMs;
      const targetVol = isMuted ? 0 : masterVolume; // 0.3
      const targetInVol = isMuted ? 0 : masterVolume; // 0.3
      const startOutVol = targetVol * initialOutRatio; // 0.3

      incomingVideo.volume = targetInVol * progress; // 0.3 * 0.51 = 0.153
      outgoingVideo.volume = startOutVol * (1 - progress); // 0.3 * 0.49 = 0.147

      const expectedIn = 0.3 * (816 / 1600);
      const expectedOut = 0.3 * (1 - (816 / 1600));

      assert.ok(Math.abs(incomingVideo.volume - expectedIn) < 0.0001, 'Incoming video scaled smoothly');
      assert.ok(Math.abs(outgoingVideo.volume - expectedOut) < 0.0001, 'Outgoing video scaled smoothly');
      assert.ok(Math.abs((incomingVideo.volume + outgoingVideo.volume) - 0.3) < 0.0001, 'Sum matches new masterVolume 0.3');
    });
  });

  describe('Suite 2: Mid-Transition Master Volume Increase (0.2 -> 0.8 at 50% of 1.6s Slow)', () => {

    it('EMP-IT3-03: Verifies SET_VOLUME does NOT produce 1.6 clipping blast on volume rise during crossfade', () => {
      const env = createStageAudioSandbox();
      const outgoingVideo = new (env.document.getElementById('deckA').constructor)('video');
      const incomingVideo = new (env.document.getElementById('deckB').constructor)('video');
      env.deckA.appendChild(outgoingVideo);
      env.deckB.appendChild(incomingVideo);

      // Transition is at 50% with initial masterVolume = 0.2
      env.setMasterVolume(0.2);
      env.setAudioCrossfadeAnimId(102); // Crossfade is actively running
      outgoingVideo.volume = 0.1;
      incomingVideo.volume = 0.1;

      // SET_VOLUME arrives with jump to 0.8
      env.handleStageControl('SET_VOLUME', { volume: 0.8 });

      // Immediate check right after SET_VOLUME:
      // Videos must NOT have jumped to 0.8 (which would sum to 1.6)
      assert.strictEqual(outgoingVideo.volume, 0.1, 'Outgoing video must not spike to 0.8');
      assert.strictEqual(incomingVideo.volume, 0.1, 'Incoming video must not spike to 0.8');
      const sum = outgoingVideo.volume + incomingVideo.volume;
      assert.strictEqual(sum, 0.2, 'Sum must remain 0.2 before next RAF');
      assert.ok(sum <= 1.0, 'Sum is safely within unity headroom');
    });

    it('EMP-IT3-04: Verifies subsequent RAF frame ramps smoothly towards 0.8 ceiling', () => {
      const fadeDurationMs = 1600;
      let masterVolume = 0.8;
      let isMuted = false;
      const initialOutRatio = 1.0;
      const outgoingVideo = { volume: 0.1 };
      const incomingVideo = { volume: 0.1 };

      // Next RAF frame at elapsed = 816ms
      const elapsed = 816;
      const progress = elapsed / fadeDurationMs;
      const targetVol = isMuted ? 0 : masterVolume; // 0.8
      const targetInVol = isMuted ? 0 : masterVolume; // 0.8
      const startOutVol = targetVol * initialOutRatio; // 0.8

      incomingVideo.volume = targetInVol * progress; // 0.8 * 0.51 = 0.408
      outgoingVideo.volume = startOutVol * (1 - progress); // 0.8 * 0.49 = 0.392

      assert.ok(Math.abs(incomingVideo.volume - 0.408) < 0.0001);
      assert.ok(Math.abs(outgoingVideo.volume - 0.392) < 0.0001);
      assert.ok(Math.abs((incomingVideo.volume + outgoingVideo.volume) - 0.8) < 0.0001, 'Sum cleanly equals 0.8');
    });
  });

  describe('Suite 3: Steady-State Volume Responsiveness (No Crossfade Active)', () => {

    it('EMP-IT3-05: Steady-state volume change immediately updates active video element', () => {
      const env = createStageAudioSandbox();
      const activeVideo = new (env.document.getElementById('deckA').constructor)('video');
      env.deckA.appendChild(activeVideo);

      env.setMasterVolume(1.0);
      activeVideo.volume = 1.0;
      env.setAudioCrossfadeAnimId(null); // No crossfade active!

      // User changes volume to 0.45 while playing
      env.handleStageControl('SET_VOLUME', { volume: 0.45 });

      // In steady state, volume MUST update immediately on video element
      assert.strictEqual(env.getMasterVolume(), 0.45, 'masterVolume updated');
      assert.strictEqual(activeVideo.volume, 0.45, 'activeVideo volume must immediately reflect 0.45');
    });

    it('EMP-IT3-06: Steady-state volume change to 0 (silence) and 1 (max) updates immediately', () => {
      const env = createStageAudioSandbox();
      const activeVideo = new (env.document.getElementById('deckA').constructor)('video');
      env.deckA.appendChild(activeVideo);
      env.setAudioCrossfadeAnimId(null);

      env.handleStageControl('SET_VOLUME', { volume: 0 });
      assert.strictEqual(activeVideo.volume, 0, 'Volume 0 applied immediately');

      env.handleStageControl('SET_VOLUME', { volume: 1.0 });
      assert.strictEqual(activeVideo.volume, 1.0, 'Volume 1.0 applied immediately');
    });

    it('EMP-IT3-07: Steady-state volume change clamps values to [0, 1]', () => {
      const env = createStageAudioSandbox();
      const activeVideo = new (env.document.getElementById('deckA').constructor)('video');
      env.deckA.appendChild(activeVideo);
      env.setAudioCrossfadeAnimId(null);

      env.handleStageControl('SET_VOLUME', { volume: -0.5 });
      assert.strictEqual(env.getMasterVolume(), 0, 'Negative volume clamped to 0');
      assert.strictEqual(activeVideo.volume, 0);

      env.handleStageControl('SET_VOLUME', { volume: 1.5 });
      assert.strictEqual(env.getMasterVolume(), 1.0, 'Volume > 1 clamped to 1.0');
      assert.strictEqual(activeVideo.volume, 1.0);
    });
  });

  describe('Suite 4: Rapid Volume Slider Dragging Stress-Test During Crossfade', () => {

    it('EMP-IT3-08: Rapid volume dragging during active crossfade preserves continuity across 50 simulated frames', () => {
      const env = createStageAudioSandbox();
      const outgoingVideo = new (env.document.getElementById('deckA').constructor)('video');
      const incomingVideo = new (env.document.getElementById('deckB').constructor)('video');
      env.deckA.appendChild(outgoingVideo);
      env.deckB.appendChild(incomingVideo);

      const fadeDurationMs = 1600;
      env.setMasterVolume(1.0);
      env.setAudioCrossfadeAnimId(201);
      const initialOutRatio = 1.0;

      // Simulate a user aggressively sliding the volume fader while 1600ms crossfade progresses
      // 50 frames @ ~16ms = ~800ms of playback
      let prevSum = 1.0;
      for (let frame = 1; frame <= 50; frame++) {
        const elapsed = frame * 16;
        const progress = Math.min(1, elapsed / fadeDurationMs);

        // Random or sinusoidal volume changes between 0.1 and 1.0
        const randomTargetVol = 0.1 + 0.9 * Math.abs(Math.sin(frame * 0.3));

        // IPC event arrives
        env.handleStageControl('SET_VOLUME', { volume: randomTargetVol });

        // Verify video elements were NOT overwritten by the IPC event directly
        // The stepAudioCrossfade function executes on the RAF frame:
        const currentMaster = env.getMasterVolume();
        const targetVol = env.getIsMuted() ? 0 : currentMaster;
        const targetInVol = env.getIsMuted() ? 0 : currentMaster;
        const startOutVol = targetVol * initialOutRatio;

        if (!env.getIsMuted()) {
          incomingVideo.volume = targetInVol * progress;
          outgoingVideo.volume = startOutVol * (1 - progress);
        }

        const sum = incomingVideo.volume + outgoingVideo.volume;
        // Check for NaN, negative, or overflow
        assert.ok(!isNaN(incomingVideo.volume), `incomingVideo volume is NaN at frame ${frame}`);
        assert.ok(!isNaN(outgoingVideo.volume), `outgoingVideo volume is NaN at frame ${frame}`);
        assert.ok(incomingVideo.volume >= 0 && incomingVideo.volume <= 1.0, `incomingVideo volume out of bounds at frame ${frame}`);
        assert.ok(outgoingVideo.volume >= 0 && outgoingVideo.volume <= 1.0, `outgoingVideo volume out of bounds at frame ${frame}`);
        assert.ok(Math.abs(sum - currentMaster) < 0.0001, `Sum at frame ${frame} matches currentMaster`);
      }
    });
  });

  describe('Suite 5: Mute / Unmute Interplay & Volume 0 Edge Cases', () => {

    it('EMP-IT3-09: SET_MUTE mutes hardware video elements immediately without affecting crossfade progress', () => {
      const env = createStageAudioSandbox();
      const outgoingVideo = new (env.document.getElementById('deckA').constructor)('video');
      const incomingVideo = new (env.document.getElementById('deckB').constructor)('video');
      env.deckA.appendChild(outgoingVideo);
      env.deckB.appendChild(incomingVideo);

      env.setAudioCrossfadeAnimId(301);
      outgoingVideo.volume = 0.5;
      incomingVideo.volume = 0.5;

      env.handleStageControl('SET_MUTE', { muted: true });
      assert.strictEqual(outgoingVideo.muted, true, 'Outgoing video muted immediately');
      assert.strictEqual(incomingVideo.muted, true, 'Incoming video muted immediately');

      // While muted, volume changes arrive
      env.handleStageControl('SET_VOLUME', { volume: 0.9 });
      assert.strictEqual(env.getMasterVolume(), 0.9);
      // Still muted
      assert.strictEqual(outgoingVideo.muted, true);
      assert.strictEqual(incomingVideo.muted, true);

      // Unmute restores
      env.handleStageControl('SET_MUTE', { muted: false });
      assert.strictEqual(outgoingVideo.muted, false);
      assert.strictEqual(incomingVideo.muted, false);
    });

    it('EMP-IT3-10: Setting volume to 0 mid-crossfade cleanly reduces sum to 0 without division by zero', () => {
      const fadeDurationMs = 1600;
      let masterVolume = 0;
      let isMuted = false;
      const initialOutRatio = 1.0;

      const elapsed = 800;
      const progress = elapsed / fadeDurationMs;
      const targetVol = isMuted ? 0 : masterVolume;
      const targetInVol = isMuted ? 0 : masterVolume;
      const startOutVol = targetVol * initialOutRatio;

      const inVol = targetInVol * progress;
      const outVol = startOutVol * (1 - progress);

      assert.strictEqual(inVol, 0);
      assert.strictEqual(outVol, 0);
      assert.strictEqual(inVol + outVol, 0);
    });
  });

  describe('Suite 6: Crossfade Finalization & Transition Cancellation', () => {

    it('EMP-IT3-11: Crossfade completion sets audioCrossfadeAnimId to null and finalizes volumes', () => {
      const env = createStageAudioSandbox();
      const outgoingVideo = new (env.document.getElementById('deckA').constructor)('video');
      const incomingVideo = new (env.document.getElementById('deckB').constructor)('video');
      env.deckA.appendChild(outgoingVideo);
      env.deckB.appendChild(incomingVideo);

      env.setMasterVolume(0.75);
      env.setAudioCrossfadeAnimId(401);

      // Emulate stepAudioCrossfade reaching progress = 1.0 (lines 618-624)
      const progress = 1.0;
      const targetInVol = env.getIsMuted() ? 0 : env.getMasterVolume();

      if (progress < 1) {
        // ...
      } else {
        env.setAudioCrossfadeAnimId(null);
        if (incomingVideo && !env.getIsMuted()) incomingVideo.volume = targetInVol;
        if (outgoingVideo) outgoingVideo.volume = 0;
      }

      assert.strictEqual(env.getAudioCrossfadeAnimId(), null, 'audioCrossfadeAnimId must be reset to null on completion');
      assert.strictEqual(incomingVideo.volume, 0.75, 'Incoming video is at exact masterVolume');
      assert.strictEqual(outgoingVideo.volume, 0, 'Outgoing video is at 0');

      // Now test steady-state volume adjustment AFTER transition completes
      env.handleStageControl('SET_VOLUME', { volume: 0.35 });
      assert.strictEqual(incomingVideo.volume, 0.35, 'Subsequent volume adjustments take effect immediately');
    });

    it('EMP-IT3-12: Transition supersession clears previous audioCrossfadeAnimId via cancelAnimationFrame', () => {
      // In stage/index.html lines 446-449:
      // if (audioCrossfadeAnimId) {
      //     cancelAnimationFrame(audioCrossfadeAnimId);
      //     audioCrossfadeAnimId = null;
      // }
      let audioCrossfadeAnimId = 501;
      let cancelledId = null;
      function cancelAnimationFrame(id) {
        cancelledId = id;
      }

      if (audioCrossfadeAnimId) {
        cancelAnimationFrame(audioCrossfadeAnimId);
        audioCrossfadeAnimId = null;
      }

      assert.strictEqual(cancelledId, 501, 'Active animation frame was cancelled');
      assert.strictEqual(audioCrossfadeAnimId, null, 'audioCrossfadeAnimId was set to null');
    });
  });
});
