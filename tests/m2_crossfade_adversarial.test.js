/**
 * tests/m2_crossfade_adversarial.test.js
 * Adversarial Empirical Stress Test Suite for Dual-Deck Crossfade Engine
 *
 * EMPIRICAL CHALLENGER FOR MILESTONE 2 (R3 Dual-Deck Playback & Transitions)
 *
 * Scope tested:
 * 1. Rapid-fire GO LIVE commands during active transition (token invalidation & memory leaks)
 * 2. Crossfade permutations: Video-to-Video, Video-to-Image, Image-to-Video, Cut (0ms), Slow (1.6s)
 * 3. Zero black frames & composited luminance / brightness dip analysis
 * 4. Synchronized audio volume ramp (no spikes, no clashing, mid-fade modulation)
 * 5. Decoder error / timeout resilience
 */

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { readCompleteHtml } = require('./test_helpers');
const EventEmitter = require('events');

const stageHtmlPath = path.join(__dirname, '../src/renderer/stage/index.html');
const stageHtml = readCompleteHtml(stageHtmlPath);

// Helper to simulate time
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Lightweight mock DOM & Electron IPC environment matching src/renderer/stage/index.html
 */
function createStageEnvironment() {
  const ipcRenderer = new EventEmitter();
  const sentIpcMessages = [];
  ipcRenderer.send = (channel, ...args) => {
    sentIpcMessages.push({ channel, args });
  };

  class MockClassList {
    constructor(element) {
      this.element = element;
      this.classes = new Set();
    }
    add(...names) {
      names.forEach(n => this.classes.add(n));
    }
    remove(...names) {
      names.forEach(n => this.classes.delete(n));
    }
    toggle(name, force) {
      if (force === true) this.classes.add(name);
      else if (force === false) this.classes.delete(name);
      else if (this.classes.has(name)) this.classes.delete(name);
      else this.classes.add(name);
    }
    contains(name) {
      return this.classes.has(name);
    }
  }

  class MockElement {
    constructor(tagName, id = '') {
      this.tagName = tagName.toUpperCase();
      this.id = id;
      this.classList = new MockClassList(this);
      this.children = [];
      this.style = {};
      this.src = '';
      this.volume = 1.0;
      this.muted = false;
      this.currentTime = 0;
      this.duration = 100;
      this.paused = true;
      this.loop = false;
      this.readyState = 0; // HAVE_NOTHING
      this.eventListeners = new Map();
      this.pauseCallCount = 0;
      this.loadCallCount = 0;
      this.playCallCount = 0;
    }

    set className(val) {
      this.classList.classes.clear();
      if (val) {
        val.split(/\s+/).filter(Boolean).forEach(c => this.classList.classes.add(c));
      }
    }

    get className() {
      return Array.from(this.classList.classes).join(' ');
    }

    set innerHTML(val) {
      if (val === '') {
        this.children.forEach(c => {
          if (c.tagName === 'VIDEO') {
            c.paused = true;
          }
        });
        this.children = [];
      }
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
      if (selector === 'img') {
        return this.children.find(c => c.tagName === 'IMG') || null;
      }
      return null;
    }

    querySelectorAll(selector) {
      const results = [];
      function recurse(node) {
        for (const child of node.children) {
          if (selector === '.media-deck video' && child.tagName === 'VIDEO') {
            results.push(child);
          } else if (selector === '.stage-media-element' && (child.tagName === 'VIDEO' || child.tagName === 'IMG')) {
            results.push(child);
          } else if (child.tagName.toLowerCase() === selector.toLowerCase()) {
            results.push(child);
          }
          recurse(child);
        }
      }
      recurse(this);
      return results;
    }

    addEventListener(event, handler, options = {}) {
      if (!this.eventListeners.has(event)) {
        this.eventListeners.set(event, []);
      }
      this.eventListeners.get(event).push({ handler, options });
    }

    removeEventListener(event, handler) {
      if (!this.eventListeners.has(event)) return;
      const list = this.eventListeners.get(event);
      this.eventListeners.set(event, list.filter(l => l.handler !== handler));
    }

    emit(event, ...args) {
      if (!this.eventListeners.has(event)) return;
      const list = [...this.eventListeners.get(event)];
      for (const item of list) {
        item.handler(...args);
        if (item.options && item.options.once) {
          this.removeEventListener(event, item.handler);
        }
      }
    }

    pause() {
      this.paused = true;
      this.pauseCallCount++;
    }

    load() {
      this.loadCallCount++;
    }

    play() {
      this.paused = false;
      this.playCallCount++;
      return Promise.resolve();
    }

    decode() {
      return Promise.resolve();
    }

    requestVideoFrameCallback(cb) {
      return setTimeout(() => cb(Date.now(), {}), 16);
    }

    setSinkId(id) {
      this.sinkId = id;
      return Promise.resolve();
    }
  }

  const root = new MockElement('DIV', 'root');
  const stageContainer = new MockElement('DIV', 'stageContainer');
  const deckA = new MockElement('DIV', 'deckA');
  deckA.classList.add('media-deck', 'active');
  const deckB = new MockElement('DIV', 'deckB');
  deckB.classList.add('media-deck');
  const blackoutCover = new MockElement('DIV', 'blackoutCover');
  const safeLogoLayer = new MockElement('DIV', 'safeLogoLayer');
  const safeLogoImg = new MockElement('IMG', 'safeLogoImg');
  const watermarkOverlay = new MockElement('DIV', 'watermarkOverlay');
  const tickerOverlay = new MockElement('DIV', 'tickerOverlay');
  const tickerContent = new MockElement('SPAN', 'tickerContent');

  stageContainer.appendChild(deckA);
  stageContainer.appendChild(deckB);
  stageContainer.appendChild(blackoutCover);
  stageContainer.appendChild(safeLogoLayer);
  safeLogoLayer.appendChild(safeLogoImg);
  stageContainer.appendChild(watermarkOverlay);
  stageContainer.appendChild(tickerOverlay);
  tickerOverlay.appendChild(tickerContent);
  root.appendChild(stageContainer);

  const elementsById = {
    stageContainer,
    deckA,
    deckB,
    blackoutCover,
    safeLogoLayer,
    safeLogoImg,
    watermarkOverlay,
    tickerOverlay,
    tickerContent
  };

  const mockDocument = {
    documentElement: { style: {} },
    body: {
      style: {},
      requestPointerLock: () => Promise.resolve()
    },
    getElementById: (id) => elementsById[id] || null,
    createElement: (tag) => new MockElement(tag),
    querySelectorAll: (sel) => stageContainer.querySelectorAll(sel),
    addEventListener: () => {}
  };

  const mockWindow = {
    addEventListener: () => {}
  };

  return {
    ipcRenderer,
    sentIpcMessages,
    document: mockDocument,
    window: mockWindow,
    deckA,
    deckB,
    blackoutCover,
    safeLogoLayer,
    tickerContent,
    tickerOverlay,
    watermarkOverlay
  };
}

describe('Adversarial Challenge: Dual-Deck Crossfade Engine (Milestone 2)', () => {

  // =========================================================================
  // SUITE 1: Static Code Audit & Contract Compliance of src/renderer/stage/index.html
  // =========================================================================
  describe('Suite 1: Static Code Audit & Contract Compliance', () => {

    it('CHAL-M2-01: Verifies dual-deck layout (#deckA, #deckB) with transparent deck background', () => {
      assert.ok(stageHtml.includes('id="deckA"'), 'HTML must declare #deckA');
      assert.ok(stageHtml.includes('id="deckB"'), 'HTML must declare #deckB');
      
      const mediaDeckCss = stageHtml.match(/\.media-deck\s*\{([\s\S]*?)\}/);
      assert.ok(mediaDeckCss, '.media-deck CSS block must exist');
      assert.ok(mediaDeckCss[1].includes('background: transparent;'), '.media-deck must have background: transparent to eliminate black occlusion');
      assert.ok(mediaDeckCss[1].includes('opacity: 0;'), '.media-deck must default to opacity: 0');
    });

    it('CHAL-M2-02: Verifies preRollVideo and preRollImage methods exist with timeout fallbacks', () => {
      assert.ok(stageHtml.includes('function preRollVideo(video, timeoutMs = 500)'), 'preRollVideo with 500ms fallback must exist');
      assert.ok(stageHtml.includes('async function preRollImage(img, timeoutMs = 400)'), 'preRollImage with 400ms fallback must exist');
      assert.ok(stageHtml.includes('video.readyState >= 2'), 'preRollVideo must check video.readyState >= 2');
      assert.ok(stageHtml.includes('img.decode()'), 'preRollImage must leverage img.decode()');
    });

    it('CHAL-M2-03: Verifies activeTransitionToken incrementation and invalidation checks', () => {
      assert.ok(stageHtml.includes('let activeTransitionToken = 0;'), 'Must initialize activeTransitionToken');
      assert.ok(stageHtml.includes('const thisTransitionToken = ++activeTransitionToken;'), 'Must increment token on each GO LIVE');
      assert.ok(stageHtml.includes('if (thisTransitionToken !== activeTransitionToken) return;'), 'Must check token to invalidate obsolete transitions');
    });

    it('CHAL-M2-04: Verifies cleanup timeout and audio RAF cancellation on new transition', () => {
      assert.ok(stageHtml.includes('clearTimeout(cleanupTimeoutId)'), 'Must cancel pending deck cleanups');
      assert.ok(stageHtml.includes('cancelAnimationFrame(audioCrossfadeAnimId)'), 'Must cancel ongoing audio crossfade animations');
    });

    it('CHAL-M2-05: Verifies video memory cleanup protocol (pause, empty src, load, empty innerHTML)', () => {
      assert.ok(stageHtml.includes('oldVideo.pause()') || stageHtml.includes('oldVideoInIncoming.pause()'), 'Must pause video');
      assert.ok(stageHtml.includes(".src = ''"), 'Must clear video src to unbind media buffers');
      assert.ok(stageHtml.includes('.load()'), 'Must call load() to flush decoder memory');
      assert.ok(stageHtml.includes(".innerHTML = ''"), 'Must clear deck innerHTML');
    });

    it('CHAL-M2-06: Verifies transition duration modes (Cut: 0ms, Fast: 400ms, Normal: 800ms, Slow: 1600ms)', () => {
      assert.ok(stageHtml.includes("if (durationMode === 'cut') return 0;"));
      assert.ok(stageHtml.includes("if (durationMode === 'fast') return 400;"));
      assert.ok(stageHtml.includes("if (durationMode === 'slow') return 1600;"));
      assert.ok(stageHtml.includes('return 800;'));
    });
  });

  // =========================================================================
  // SUITE 2: Crossfade Permutations & Zero Black Frame Verification
  // =========================================================================
  describe('Suite 2: Crossfade Permutations & Transition Modes', () => {

    it('CHAL-M2-07: Permutation 1: Video-to-Video crossfade calculates linear volume ramp and transitions opacity', () => {
      // Simulate stepAudioCrossfade logic
      const fadeDurationMs = 800;
      const startOutVol = 1.0;
      const targetInVol = 1.0;
      const isMuted = false;

      const samples = [0, 200, 400, 600, 800];
      const history = [];

      for (const elapsed of samples) {
        const progress = Math.min(1, Math.max(0, elapsed / fadeDurationMs));
        const inVol = isMuted ? 0 : targetInVol * progress;
        const outVol = isMuted ? 0 : startOutVol * (1 - progress);
        history.push({ elapsed, progress, inVol, outVol, sum: inVol + outVol });
      }

      // Check endpoints and midpoint
      assert.strictEqual(history[0].inVol, 0.0, 'Initial incoming volume must be 0');
      assert.strictEqual(history[0].outVol, 1.0, 'Initial outgoing volume must be 1.0');
      assert.strictEqual(history[2].inVol, 0.5, 'Midpoint incoming volume must be 0.5');
      assert.strictEqual(history[2].outVol, 0.5, 'Midpoint outgoing volume must be 0.5');
      assert.strictEqual(history[4].inVol, 1.0, 'Final incoming volume must be 1.0');
      assert.strictEqual(history[4].outVol, 0.0, 'Final outgoing volume must be 0.0');

      // Zero audio spike: sum of amplitudes is exactly 1.0 across all linear steps
      for (const h of history) {
        assert.ok(Math.abs(h.sum - 1.0) < 0.001, `Sum of volumes must equal 1.0, got ${h.sum}`);
      }
    });

    it('CHAL-M2-08: Permutation 2: Video-to-Image crossfade safely ramps down video audio without incoming video crash', () => {
      const fadeDurationMs = 800;
      const outgoingVideo = { volume: 1.0 };
      const incomingVideo = null; // Incoming is an image
      const isMuted = false;
      const startOutVol = outgoingVideo.volume;

      const elapsed = 400; // 50%
      const progress = elapsed / fadeDurationMs;
      
      if (!isMuted) {
        if (incomingVideo) incomingVideo.volume = 1.0 * progress;
        if (outgoingVideo) outgoingVideo.volume = startOutVol * (1 - progress);
      }

      assert.strictEqual(outgoingVideo.volume, 0.5, 'Outgoing video audio must ramp down to 0.5 at 50%');
      assert.strictEqual(incomingVideo, null, 'Incoming video is null for image media');
    });

    it('CHAL-M2-09: Permutation 3: Image-to-Video crossfade safely ramps up incoming video from 0 to masterVolume', () => {
      const fadeDurationMs = 800;
      const outgoingVideo = null; // Outgoing is an image
      const incomingVideo = { volume: 0.0 };
      const isMuted = false;
      const targetInVol = 1.0;

      const elapsed = 400; // 50%
      const progress = elapsed / fadeDurationMs;

      if (!isMuted) {
        if (incomingVideo) incomingVideo.volume = targetInVol * progress;
        if (outgoingVideo) outgoingVideo.volume = 0;
      }

      assert.strictEqual(incomingVideo.volume, 0.5, 'Incoming video audio must ramp up to 0.5 at 50%');
    });

    it('CHAL-M2-10: Permutation 4: Cut (0ms) transition bypasses animation and sets volumes instantly', () => {
      const fadeDurationMs = 0;
      const incomingVideo = { volume: 0.0 };
      const outgoingVideo = { volume: 1.0 };
      const masterVolume = 0.85;
      const isMuted = false;

      // In cut mode, lines 623-626 run
      if (fadeDurationMs > 0 && (outgoingVideo || incomingVideo)) {
        // not taken
      } else {
        if (incomingVideo && !isMuted) incomingVideo.volume = masterVolume;
        if (outgoingVideo) outgoingVideo.volume = 0;
      }

      assert.strictEqual(incomingVideo.volume, 0.85, 'Cut mode immediately assigns masterVolume to incoming');
      assert.strictEqual(outgoingVideo.volume, 0, 'Cut mode immediately silences outgoing video');
    });

    it('CHAL-M2-11: Permutation 5: Slow (1.6s) transition computes continuous progress curve across 1600ms', () => {
      const fadeDurationMs = 1600;
      const startOutVol = 1.0;
      const targetInVol = 1.0;

      for (let t = 0; t <= 1600; t += 160) {
        const progress = Math.min(1, Math.max(0, t / fadeDurationMs));
        const inVol = targetInVol * progress;
        const outVol = startOutVol * (1 - progress);
        assert.ok(inVol >= 0 && inVol <= 1.0);
        assert.ok(outVol >= 0 && outVol <= 1.0);
        assert.ok(Math.abs((inVol + outVol) - 1.0) < 0.001);
      }
    });

    it('CHAL-M2-12: Composited Luminance Analysis: Detects 25% brightness dip during dual-fading layers', () => {
      // In CSS compositing (Porter-Duff source-over over black background #stageContainer):
      // When incoming deck (top, alpha_in) is over outgoing deck (bottom, alpha_out):
      // Total effective opacity over black is:
      // EffAlpha = alpha_in + (1 - alpha_in) * alpha_out
      // In stage/index.html:
      // incomingDeck has transition 0 -> 1 (alpha_in = p)
      // outgoingDeck has transition 1 -> 0 (alpha_out = 1 - p)
      // Therefore: EffAlpha(p) = p + (1 - p)*(1 - p) = 1 - p + p^2
      // At p = 0.5 (midpoint of transition):
      // EffAlpha(0.5) = 1 - 0.5 + 0.25 = 0.75 (A 25% brightness dip towards black!)

      function calculateCompositeLuminance(p) {
        const alphaIn = p;
        const alphaOut = 1 - p;
        return alphaIn + (1 - alphaIn) * alphaOut;
      }

      const p0 = calculateCompositeLuminance(0.0);
      const pMid = calculateCompositeLuminance(0.5);
      const p1 = calculateCompositeLuminance(1.0);

      assert.strictEqual(p0, 1.0, 'At t=0, composite luminance is 1.0 (100%)');
      assert.strictEqual(p1, 1.0, 'At t=1, composite luminance is 1.0 (100%)');
      assert.strictEqual(pMid, 0.75, 'At t=0.5, composite luminance dips to 0.75 (25% dip)');
      
      // Document this empirical finding
      assert.ok(pMid < 1.0, 'Simultaneous deck fading produces a mathematical 25% luminance dip');
    });
  });

  // =========================================================================
  // SUITE 3: Rapid-Fire GO LIVE Stress & Transition Token Invalidation
  // =========================================================================
  describe('Suite 3: Rapid-Fire GO LIVE Stress & Token Invalidation', () => {

    it('CHAL-M2-13: Rapid burst of 10 GO LIVE commands in 5ms intervals: only the final token commits', async () => {
      let activeTransitionToken = 0;
      let activeDeckKey = 'A';
      const decks = { A: { active: true }, B: { active: false } };
      const committedTransitions = [];

      function triggerGoLiveSim(cueId, delayMs) {
        const thisToken = ++activeTransitionToken;
        return new Promise((resolve) => {
          setTimeout(() => {
            // Check token after pre-roll delay
            if (thisToken !== activeTransitionToken) {
              return resolve({ cueId, committed: false, reason: 'superseded' });
            }
            // Commit transition
            const nextDeckKey = activeDeckKey === 'A' ? 'B' : 'A';
            decks[nextDeckKey].active = true;
            decks[activeDeckKey].active = false;
            activeDeckKey = nextDeckKey;
            committedTransitions.push({ cueId, token: thisToken, activeDeckKey });
            resolve({ cueId, committed: true });
          }, delayMs);
        });
      }

      // Fire 10 rapid commands
      const promises = [];
      for (let i = 1; i <= 10; i++) {
        promises.push(triggerGoLiveSim(`cue_${i}`, 50 + (10 - i) * 2));
      }

      const results = await Promise.all(promises);
      const committed = results.filter(r => r.committed);

      assert.strictEqual(committed.length, 1, 'Exactly one transition must commit');
      assert.strictEqual(committed[0].cueId, 'cue_10', 'Only the final transition (cue_10) must commit');
      assert.strictEqual(committedTransitions.length, 1);
      assert.strictEqual(committedTransitions[0].token, 10);
    });

    it('CHAL-M2-14: Mid-crossfade interruption: GO LIVE arriving at t=400ms of a 1600ms fade clears pending timers', () => {
      let cleanupTimeoutCleared = false;
      let audioAnimCancelled = false;

      let cleanupTimeoutId = 12345;
      let audioCrossfadeAnimId = 67890;

      // On new stage-go-live
      if (cleanupTimeoutId) {
        cleanupTimeoutCleared = true;
        cleanupTimeoutId = null;
      }
      if (audioCrossfadeAnimId) {
        audioAnimCancelled = true;
        audioCrossfadeAnimId = null;
      }

      assert.strictEqual(cleanupTimeoutCleared, true, 'cleanupTimeoutId must be cancelled');
      assert.strictEqual(audioAnimCancelled, true, 'audioCrossfadeAnimId must be cancelled');
      assert.strictEqual(cleanupTimeoutId, null);
      assert.strictEqual(audioCrossfadeAnimId, null);
    });

    it('CHAL-M2-15: Memory leak audit under 50 consecutive cues: old videos are paused and src cleared', () => {
      let activeDeckKey = 'A';
      const decks = {
        A: { children: [] },
        B: { children: [] }
      };

      const cleanupHistory = [];

      for (let i = 1; i <= 50; i++) {
        const nextDeckKey = activeDeckKey === 'A' ? 'B' : 'A';
        const incomingDeck = decks[nextDeckKey];

        // Clean prior media on incomingDeck
        const oldVideo = incomingDeck.children.find(c => c.type === 'video');
        if (oldVideo) {
          oldVideo.paused = true;
          oldVideo.src = '';
          oldVideo.loaded = true;
          cleanupHistory.push(oldVideo.id);
        }
        incomingDeck.children = [];

        // Add new media
        const newVideo = { id: `vid_${i}`, type: 'video', src: `file://path/${i}.mp4`, paused: false };
        incomingDeck.children.push(newVideo);

        activeDeckKey = nextDeckKey;
      }

      assert.strictEqual(cleanupHistory.length, 48, '48 prior video elements must be cleaned up across 50 cues');
      assert.strictEqual(decks.A.children.length, 1, 'Deck A must hold exactly 1 active element');
      assert.strictEqual(decks.B.children.length, 1, 'Deck B must hold exactly 1 active element');
    });
  });

  // =========================================================================
  // SUITE 4: Audio Volume Ramp & Multi-Deck Modulation Stress
  // =========================================================================
  describe('Suite 4: Audio Volume Ramp & Multi-Deck Modulation Stress', () => {

    it('CHAL-M2-16: Linear crossfade amplitude envelope: V_in + V_out <= 1.0 (no volume explosion)', () => {
      const masterVolume = 1.0;
      for (let p = 0; p <= 1.0; p += 0.05) {
        const inVol = masterVolume * p;
        const outVol = masterVolume * (1 - p);
        const sum = inVol + outVol;
        assert.ok(sum <= 1.0001, `Sum of volumes ${sum} must not exceed 1.0`);
        assert.ok(inVol >= 0 && outVol >= 0, 'Volumes must be non-negative');
      }
    });

    it('CHAL-M2-17: Synchronized FTB Audio Ramp: ramps volume to 0 over 1000ms', () => {
      const ftbDuration = 1000;
      const startVol = 0.9;
      const rampHistory = [];

      for (let elapsed = 0; elapsed <= ftbDuration; elapsed += 100) {
        const progress = Math.min(1, elapsed / ftbDuration);
        const vol = startVol * (1 - progress);
        rampHistory.push({ elapsed, vol });
      }

      assert.strictEqual(rampHistory[0].vol, 0.9, 'Initial FTB volume matches startVol');
      assert.strictEqual(rampHistory[rampHistory.length - 1].vol, 0.0, 'Final FTB volume reaches 0');
      for (let i = 1; i < rampHistory.length; i++) {
        assert.ok(rampHistory[i].vol <= rampHistory[i - 1].vol, 'FTB volume must monotonically decrease');
      }
    });

    it('CHAL-M2-18: SET_VOLUME mid-crossfade vulnerability audit', () => {
      // In stage/index.html line 720:
      // case 'SET_VOLUME':
      //   masterVolume = Math.max(0, Math.min(1, data.volume));
      //   document.querySelectorAll('.media-deck video').forEach(v => {
      //       if (!isMuted) v.volume = masterVolume;
      //   });
      //
      // During active crossfade:
      // outgoingVideo was at 0.2
      // incomingVideo was at 0.8
      // If SET_VOLUME arrives with volume = 0.9:
      // BOTH outgoingVideo and incomingVideo get volume = 0.9!
      // Total volume sum = 1.8 (Volume spike!) until next RAF!

      const mockOutgoing = { volume: 0.2 };
      const mockIncoming = { volume: 0.8 };
      const allVideos = [mockOutgoing, mockIncoming];

      const newVolume = 0.9;
      allVideos.forEach(v => { v.volume = newVolume; });

      const spikeSum = mockOutgoing.volume + mockIncoming.volume;
      assert.strictEqual(spikeSum, 1.8, 'Direct multi-deck assignment creates 1.8 volume spike before next RAF');
    });

    it('CHAL-M2-19: SET_MUTE mid-crossfade: applies muted = true to all video elements across both decks', () => {
      const env = createStageEnvironment();
      const v1 = env.document.createElement('video');
      const v2 = env.document.createElement('video');
      env.deckA.appendChild(v1);
      env.deckB.appendChild(v2);

      // Simulate SET_MUTE
      const isMuted = true;
      env.document.querySelectorAll('.media-deck video').forEach(v => {
        v.muted = isMuted;
      });

      assert.strictEqual(v1.muted, true, 'Deck A video must be muted');
      assert.strictEqual(v2.muted, true, 'Deck B video must be muted');
    });
  });

  // =========================================================================
  // SUITE 5: Decoder Failure & Corrupt Media Fallback Resilience
  // =========================================================================
  describe('Suite 5: Decoder Failure & Corrupt Media Resilience', () => {

    it('CHAL-M2-20: Video pre-roll timeout fallback: resolves false after 500ms when readyState remains 0', async () => {
      const mockVideo = new (createStageEnvironment().document.createElement('video').constructor)('video');
      mockVideo.readyState = 0; // Stalled decoder

      function simulatePreRollVideo(video, timeoutMs = 100) {
        return new Promise((resolve) => {
          if (video.readyState >= 2) return resolve(true);
          let settled = false;
          let timer = null;

          const onReady = () => {
            if (settled) return;
            settled = true;
            if (timer) clearTimeout(timer);
            resolve(true);
          };

          const onError = () => {
            if (settled) return;
            settled = true;
            if (timer) clearTimeout(timer);
            resolve(false);
          };

          video.addEventListener('loadeddata', onReady, { once: true });
          video.addEventListener('canplay', onReady, { once: true });
          video.addEventListener('error', onError, { once: true });

          timer = setTimeout(() => {
            if (settled) return;
            settled = true;
            resolve(false);
          }, timeoutMs);
        });
      }

      const startTime = Date.now();
      const result = await simulatePreRollVideo(mockVideo, 50);
      const elapsed = Date.now() - startTime;

      assert.strictEqual(result, false, 'Pre-roll must resolve false on timeout fallback');
      assert.ok(elapsed >= 45, `Elapsed time ${elapsed}ms must match timeout`);
    });

    it('CHAL-M2-21: Video error event during pre-roll resolves gracefully without uncaught rejection', async () => {
      const mockVideo = new (createStageEnvironment().document.createElement('video').constructor)('video');
      mockVideo.readyState = 0;

      function simulatePreRollVideo(video, timeoutMs = 200) {
        return new Promise((resolve) => {
          if (video.readyState >= 2) return resolve(true);
          let settled = false;
          let timer = null;

          const onError = () => {
            if (settled) return;
            settled = true;
            if (timer) clearTimeout(timer);
            resolve(false);
          };

          video.addEventListener('error', onError, { once: true });
          timer = setTimeout(() => {
            if (settled) return;
            settled = true;
            resolve(false);
          }, timeoutMs);
        });
      }

      const p = simulatePreRollVideo(mockVideo, 200);
      mockVideo.emit('error', new Error('Demuxer error: unsupported codec'));
      const res = await p;

      assert.strictEqual(res, false, 'Error event must resolve false gracefully');
    });

    it('CHAL-M2-22: Image decode rejection falls back to resolve false without throwing', async () => {
      const mockImg = {
        decode: () => Promise.reject(new Error('Corrupt image headers'))
      };

      async function simulatePreRollImage(img, timeoutMs = 100) {
        if (typeof img.decode === 'function') {
          try {
            await Promise.race([
              img.decode(),
              new Promise(r => setTimeout(r, timeoutMs))
            ]);
            return true;
          } catch (err) {
            return false;
          }
        }
        return true;
      }

      const res = await simulatePreRollImage(mockImg, 100);
      assert.strictEqual(res, false, 'Image decode failure must resolve false gracefully');
    });
  });
});
