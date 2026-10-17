/**
 * tests/adversarial_ducking_panic_cycles.test.js
 * Adversarial Empirical Verification Suite for Audio Ducking and Panic Cycles
 *
 * Challenger: Challenger Audio M1-It2-2 (critic, specialist)
 * Target:
 * 1. Play audio track -> hot-swap video cue (video must be ducked).
 * 2. Trigger Blackout -> release Blackout (video must REMAIN ducked).
 * 3. Trigger FTB -> release FTB (video must REMAIN ducked).
 * 4. Stop audio track -> hot-swap another video cue (new video must NOT be ducked, volume = masterVolume).
 * 5. Audio track ended (onended) -> hot-swap video cue (video must NOT be ducked).
 * 6. Normal video panic cycles: Blackout/FTB release on un-ducked video restores volume to masterVolume.
 * 7. Stress & Jitter: Volume fader & Mute toggles during ducked playback never leak video audio.
 */

const { describe, it, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');

// Read actual production source files
const stageScriptSrc = fs.readFileSync(path.join(__dirname, '../src/renderer/stage/scripts/stage.js'), 'utf8');
const dualDeckScriptSrc = fs.readFileSync(path.join(__dirname, '../src/renderer/operator/scripts/dual_deck.js'), 'utf8');
const audioRoutingScriptSrc = fs.readFileSync(path.join(__dirname, '../src/renderer/operator/scripts/audio_routing.js'), 'utf8');

/**
 * Creates a fully interconnected Stage & Operator simulation environment
 * executing production stage.js and dual_deck.js logic verbatim.
 */
function createAdversarialSimulationEnv() {
  const ipcBus = new EventEmitter();

  // Mock DOM Element
  class MockDOMElement {
    constructor(tagName, id = '') {
      this.tagName = tagName.toUpperCase();
      this.id = id;
      this.classList = {
        _set: new Set(),
        add: (...cls) => cls.forEach(c => this.classList._set.add(c)),
        remove: (...cls) => cls.forEach(c => this.classList._set.delete(c)),
        contains: (c) => this.classList._set.has(c),
        toggle: (c, force) => {
          if (force !== undefined) {
            if (force) this.classList._set.add(c);
            else this.classList._set.delete(c);
            return force;
          }
          if (this.classList._set.has(c)) {
            this.classList._set.delete(c);
            return false;
          }
          this.classList._set.add(c);
          return true;
        }
      };
      this.children = [];
      this.parentNode = null;
      this.dataset = {};
      this.style = {};
      this.innerText = '';
      this.innerHTML = '';
      this.value = '';
      this.src = '';
      this.volume = 1.0;
      this.muted = false;
      this.currentTime = 0;
      this.duration = 180;
      this.paused = true;
      this.ended = false;
      this.loop = false;
      this.autoplay = false;
      this.playsInline = true;
      this.preload = 'auto';
      this.readyState = 4;
      this.eventListeners = new Map();
      this.sinkId = '';
    }

    get className() {
      return Array.from(this.classList._set).join(' ');
    }
    set className(val) {
      this.classList._set.clear();
      if (val) val.split(/\s+/).filter(Boolean).forEach(c => this.classList._set.add(c));
    }

    appendChild(child) {
      this.children.push(child);
      child.parentNode = this;
      return child;
    }

    removeChild(child) {
      const idx = this.children.indexOf(child);
      if (idx !== -1) {
        this.children.splice(idx, 1);
        child.parentNode = null;
      }
      return child;
    }

    querySelector(selector) {
      if (selector === 'video') return this.children.find(c => c.tagName === 'VIDEO') || null;
      if (selector === 'img') return this.children.find(c => c.tagName === 'IMG') || null;
      return null;
    }

    querySelectorAll(selector) {
      const results = [];
      function recurse(node) {
        for (const child of node.children) {
          if (selector === 'video' && child.tagName === 'VIDEO') results.push(child);
          else if (selector === '.media-deck video' && child.tagName === 'VIDEO') results.push(child);
          else if (selector === '.stage-media-element') results.push(child);
          recurse(child);
        }
      }
      recurse(this);
      return results;
    }

    addEventListener(event, handler) {
      if (!this.eventListeners.has(event)) this.eventListeners.set(event, []);
      this.eventListeners.get(event).push(handler);
    }

    removeEventListener(event, handler) {
      if (!this.eventListeners.has(event)) return;
      const list = this.eventListeners.get(event);
      const idx = list.indexOf(handler);
      if (idx !== -1) list.splice(idx, 1);
    }

    click() {
      if (this.onclick) this.onclick();
      const handlers = this.eventListeners.get('click') || [];
      handlers.forEach(h => h({ target: this, preventDefault: () => {} }));
    }

    async play() {
      this.paused = false;
      return Promise.resolve();
    }

    pause() {
      this.paused = true;
    }

    load() {}

    removeAttribute(attr) {
      if (attr === 'src') this.src = '';
    }

    async setSinkId(id) {
      this.sinkId = id;
      return Promise.resolve();
    }
  }

  // --- Operator DOM Elements ---
  const operatorAudioDeck = new MockDOMElement('audio', 'operatorAudioDeck');
  const operatorCuePlayer = new MockDOMElement('audio', 'operatorCuePlayer');
  const masterVolumeSlider = new MockDOMElement('input', 'masterVolumeSlider');
  masterVolumeSlider.value = '1.0';
  const btnMuteMaster = new MockDOMElement('button', 'btnMuteMaster');
  const btnGoLive = new MockDOMElement('button', 'btnGoLive');
  const btnBlackout = new MockDOMElement('button', 'btnBlackout');
  const btnFTB = new MockDOMElement('button', 'btnFTB');
  const btnFreeze = new MockDOMElement('button', 'btnFreeze');
  const btnSafeLogo = new MockDOMElement('button', 'btnSafeLogo');
  const pgmFrame = new MockDOMElement('div', 'pgmFrame');
  const pgmCueTitle = new MockDOMElement('span', 'pgmCueTitle');
  const pgmDeckA = new MockDOMElement('div', 'pgmDeckA');
  const pgmDeckB = new MockDOMElement('div', 'pgmDeckB');
  const pgmContainer = new MockDOMElement('div', 'pgmContainer');
  pgmContainer.appendChild(pgmDeckA);
  pgmContainer.appendChild(pgmDeckB);

  // --- Stage DOM Elements ---
  const stageContainer = new MockDOMElement('div', 'stageContainer');
  const deckA = new MockDOMElement('div', 'deckA');
  deckA.classList.add('media-deck', 'active');
  const deckB = new MockDOMElement('div', 'deckB');
  deckB.classList.add('media-deck');
  stageContainer.appendChild(deckA);
  stageContainer.appendChild(deckB);
  const blackoutCover = new MockDOMElement('div', 'blackoutCover');
  const safeLogoLayer = new MockDOMElement('div', 'safeLogoLayer');
  const safeLogoImg = new MockDOMElement('img', 'safeLogoImg');
  safeLogoLayer.appendChild(safeLogoImg);
  const watermarkOverlay = new MockDOMElement('div', 'watermarkOverlay');
  const tickerOverlay = new MockDOMElement('div', 'tickerOverlay');
  const tickerContent = new MockDOMElement('div', 'tickerContent');

  // Stage Document mock
  const stageDocument = {
    documentElement: { style: {} },
    body: { style: {}, requestPointerLock: () => Promise.resolve() },
    pointerLockElement: null,
    getElementById: (id) => {
      switch (id) {
        case 'deckA': return deckA;
        case 'deckB': return deckB;
        case 'stageContainer': return stageContainer;
        case 'blackoutCover': return blackoutCover;
        case 'safeLogoLayer': return safeLogoLayer;
        case 'safeLogoImg': return safeLogoImg;
        case 'watermarkOverlay': return watermarkOverlay;
        case 'tickerOverlay': return tickerOverlay;
        case 'tickerContent': return tickerContent;
        default: return null;
      }
    },
    querySelectorAll: (sel) => stageContainer.querySelectorAll(sel),
    createElement: (tag) => new MockDOMElement(tag),
    addEventListener: () => {},
    removeEventListener: () => {}
  };

  // Stage Window mock
  const stageWindow = {
    addEventListener: () => {},
    removeEventListener: () => {},
    requestAnimationFrame: (cb) => setTimeout(() => cb(Date.now()), 1),
    cancelAnimationFrame: (id) => clearTimeout(id),
    setTimeout: (cb, ms) => setTimeout(cb, ms),
    clearTimeout: (id) => clearTimeout(id),
    location: { href: 'http://localhost/stage' }
  };

  // IPC Bridge
  const operatorIpcRenderer = new EventEmitter();
  const stageIpcRenderer = new EventEmitter();

  const goLivePayloadLog = [];
  const stageControlLog = [];

  operatorIpcRenderer.send = (channel, ...args) => {
    if (channel === 'go-live') {
      const payload = args[0];
      goLivePayloadLog.push(payload);
      stageIpcRenderer.emit('stage-go-live', {}, payload);
    } else if (channel === 'stage-control') {
      stageControlLog.push({ action: args[0], data: args[1] });
      stageIpcRenderer.emit('stage-control', {}, args[0], args[1]);
    }
  };

  stageIpcRenderer.send = (channel, ...args) => {
    operatorIpcRenderer.emit(channel, {}, ...args);
  };

  // Operator Document mock
  const operatorDocument = {
    getElementById: (id) => {
      switch (id) {
        case 'operatorAudioDeck': return operatorAudioDeck;
        case 'operatorCuePlayer': return operatorCuePlayer;
        case 'masterVolumeSlider': return masterVolumeSlider;
        case 'btnMuteMaster': return btnMuteMaster;
        case 'btnGoLive': return btnGoLive;
        case 'btnBlackout': return btnBlackout;
        case 'btnFTB': return btnFTB;
        case 'btnFreeze': return btnFreeze;
        case 'btnSafeLogo': return btnSafeLogo;
        case 'pgmFrame': return pgmFrame;
        case 'pgmCueTitle': return pgmCueTitle;
        case 'pgmDeckA': return pgmDeckA;
        case 'pgmDeckB': return pgmDeckB;
        case 'pgmContainer': return pgmContainer;
        default: return null;
      }
    },
    querySelectorAll: () => [],
    createElement: (tag) => new MockDOMElement(tag)
  };

  // Instantiate Stage Module using actual source code
  const stageModuleFunc = new Function(
    'document',
    'window',
    'requestAnimationFrame',
    'cancelAnimationFrame',
    'setTimeout',
    'clearTimeout',
    'performance',
    '_systemRequire',
    `
      const electronMock = { ipcRenderer: _systemRequire.ipcRenderer };
      const require = (mod) => {
        if (mod === 'electron') return electronMock;
        return _systemRequire(mod);
      };
      ${stageScriptSrc}
      return {
        getActiveDeckKey: () => activeDeckKey,
        getCurrentMedia: () => currentMedia,
        getMasterVolume: () => masterVolume,
        getIsMuted: () => isMuted,
        getIsBlackout: () => isBlackout,
        getIsFTB: () => isFTB,
        getActiveVideo: () => {
          const allVids = document.querySelectorAll('.media-deck video');
          if (currentMedia && currentMedia.path) {
            const match = allVids.find(v => v.src && v.src.includes(currentMedia.path));
            if (match) return match;
          }
          return decks[activeDeckKey].querySelector('video') || decks[activeDeckKey === 'A' ? 'B' : 'A'].querySelector('video');
        },
        getDeckA: () => decks.A,
        getDeckB: () => decks.B,
        setMasterVolumeDirect: (vol) => { masterVolume = vol; }
      };
    `
  );

  const mockRequire = (mod) => {
    if (mod === 'electron') return { ipcRenderer: stageIpcRenderer };
    if (mod === 'path') return path;
    if (mod === 'fs') return fs;
    if (mod === 'url') return require('url');
    return {};
  };
  mockRequire.ipcRenderer = stageIpcRenderer;

  const stageApi = stageModuleFunc(
    stageDocument,
    stageWindow,
    stageWindow.requestAnimationFrame,
    stageWindow.cancelAnimationFrame,
    stageWindow.setTimeout,
    stageWindow.clearTimeout,
    { now: () => Date.now() },
    mockRequire
  );

  // Instantiate Dual Deck Module using actual source code
  let pvwCue = null;
  let pgmCue = null;
  let isAudioDeckPlayingState = false;
  let audioDeckTrack = null;
  let currentTransition = 'cut';
  let currentScaling = 'contain';

  const dualDeckScope = {
    ipcRenderer: operatorIpcRenderer,
    operatorAudioDeck,
    get isAudioDeckPlaying() { return isAudioDeckPlayingState; },
    set isAudioDeckPlaying(val) { isAudioDeckPlayingState = val; },
    get audioDeckTrack() { return audioDeckTrack; },
    set audioDeckTrack(val) { audioDeckTrack = val; },
    get pvwCue() { return pvwCue; },
    set pvwCue(val) { pvwCue = val; },
    get pgmCue() { return pgmCue; },
    set pgmCue(val) { pgmCue = val; },
    get currentTransition() { return currentTransition; },
    set currentTransition(val) { currentTransition = val; },
    get currentScaling() { return currentScaling; },
    set currentScaling(val) { currentScaling = val; },
    btnBlackout,
    btnFTB,
    btnGoLive,
    pgmCueTitle,
    pgmFrame,
    document: operatorDocument,
    renderRundown: () => {},
    loadTrackToAudioDeck: (track, autoPlay) => {
      audioDeckTrack = track;
      if (autoPlay) {
        isAudioDeckPlayingState = true;
        operatorAudioDeck.paused = false;
        operatorAudioDeck.ended = false;
      }
    },
    playAudioDeck: () => {
      isAudioDeckPlayingState = true;
      operatorAudioDeck.paused = false;
      operatorAudioDeck.ended = false;
    },
    requestAnimationFrame: (cb) => setTimeout(() => cb(Date.now()), 1),
    cancelAnimationFrame: (id) => clearTimeout(id),
    window: stageWindow,
    resolveOperatorAssetDir: () => '.'
  };

  const dualDeckKeys = Object.keys(dualDeckScope);
  const dualDeckModuleFunc = new Function(
    ...dualDeckKeys,
    `
      ${dualDeckScriptSrc}
      return {
        triggerGoLive,
        setPvwCue: (c) => { pvwCue = c; },
        setTransition: (t) => { currentTransition = t; }
      };
    `
  );

  const dualDeckApi = dualDeckModuleFunc(...Object.values(dualDeckScope));

  return {
    operatorAudioDeck,
    masterVolumeSlider,
    btnMuteMaster,
    stageApi,
    dualDeckApi,
    operatorIpcRenderer,
    stageIpcRenderer,
    goLivePayloadLog,
    stageControlLog,
    setAudioPlaying: (playing) => {
      isAudioDeckPlayingState = playing;
      operatorAudioDeck.paused = !playing;
      operatorAudioDeck.ended = false;
    },
    setAudioEnded: () => {
      isAudioDeckPlayingState = false;
      operatorAudioDeck.paused = true;
      operatorAudioDeck.ended = true;
    },
    setAudioStopped: () => {
      isAudioDeckPlayingState = false;
      operatorAudioDeck.paused = true;
      operatorAudioDeck.ended = false;
      operatorAudioDeck.currentTime = 0;
    }
  };
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

describe('Adversarial Challenge: Ducking & Panic Cycles Verification', () => {

  // =========================================================================
  // REQUIREMENT 1: 4-Step Mandatory Cycle
  // Play audio -> Hot-swap video (ducked) -> Blackout cycle -> FTB cycle -> Stop audio -> Hot-swap video (un-ducked)
  // =========================================================================
  describe('1. Full Mandatory Ducking & Panic Cycle Execution', () => {

    it('Step 1: Play audio track -> hot-swap video cue (video must be ducked with volume 0 and muted)', async () => {
      const env = createAdversarialSimulationEnv();

      // Start audio track playback
      env.setAudioPlaying(true);
      assert.strictEqual(env.operatorAudioDeck.paused, false, 'operatorAudioDeck must be playing');

      // Operator hot-swaps video cue 1
      const videoCue1 = {
        id: 'cue_vid_1',
        name: 'Keynote Background.mp4',
        type: 'video',
        path: 'd:\\LUMEN\\assets\\keynote_bg.mp4',
        duration: 60
      };

      env.dualDeckApi.triggerGoLive(videoCue1);
      await sleep(50);

      // Verify IPC payload
      const lastPayload = env.goLivePayloadLog[env.goLivePayloadLog.length - 1];
      assert.ok(lastPayload, 'go-live IPC payload must be emitted');
      assert.strictEqual(lastPayload.hasIndependentAudioTrack, true, 'hasIndependentAudioTrack must be TRUE when audio is playing');

      // Verify Stage active video element
      const activeVid = env.stageApi.getActiveVideo();
      assert.ok(activeVid, 'Stage must have an active video element mounted');
      assert.strictEqual(activeVid.volume, 0, 'Stage video volume must be strictly 0 (ducked)');
      assert.strictEqual(activeVid.muted, true, 'Stage video must be strictly muted');
      assert.strictEqual(activeVid.dataset.independentAudioMuted, 'true', 'dataset.independentAudioMuted must be "true"');
    });

    it('Step 2: Trigger Blackout -> release Blackout (video must REMAIN ducked)', async () => {
      const env = createAdversarialSimulationEnv();

      // Start audio and hot-swap video 1
      env.setAudioPlaying(true);
      const videoCue1 = { id: 'cue_vid_1', name: 'Singer Visual.mp4', type: 'video', path: 'd:\\LUMEN\\assets\\clip.mp4' };
      env.dualDeckApi.triggerGoLive(videoCue1);
      await sleep(50);

      const activeVid = env.stageApi.getActiveVideo();
      assert.strictEqual(activeVid.volume, 0);
      assert.strictEqual(activeVid.muted, true);

      // Trigger Blackout
      env.operatorIpcRenderer.send('stage-control', 'BLACKOUT', { active: true });
      await sleep(20);
      assert.strictEqual(env.stageApi.getIsBlackout(), true, 'Stage isBlackout must be true');
      assert.strictEqual(activeVid.volume, 0, 'Volume must be 0 in blackout');

      // Release Blackout
      env.operatorIpcRenderer.send('stage-control', 'BLACKOUT', { active: false });
      await sleep(20);
      assert.strictEqual(env.stageApi.getIsBlackout(), false, 'Stage isBlackout must be false');

      // EMPIRICAL CRITICAL INVARIANT: Video MUST REMAIN DUCKED!
      assert.strictEqual(activeVid.volume, 0, 'CRITICAL: Video volume must REMAIN 0 after Blackout release!');
      assert.strictEqual(activeVid.muted, true, 'CRITICAL: Video must REMAIN muted after Blackout release!');
      assert.strictEqual(activeVid.dataset.independentAudioMuted, 'true', 'dataset.independentAudioMuted must persist');
    });

    it('Step 3: Trigger FTB -> release FTB (video must REMAIN ducked)', async () => {
      const env = createAdversarialSimulationEnv();

      // Start audio and hot-swap video 1
      env.setAudioPlaying(true);
      const videoCue1 = { id: 'cue_vid_1', name: 'Singer Visual.mp4', type: 'video', path: 'd:\\LUMEN\\assets\\clip.mp4' };
      env.dualDeckApi.triggerGoLive(videoCue1);
      await sleep(50);

      const activeVid = env.stageApi.getActiveVideo();
      assert.strictEqual(activeVid.volume, 0);
      assert.strictEqual(activeVid.muted, true);

      // Trigger FTB (Fade To Black)
      env.operatorIpcRenderer.send('stage-control', 'FTB', { active: true });
      await sleep(20);
      assert.strictEqual(env.stageApi.getIsFTB(), true, 'Stage isFTB must be true');

      // Release FTB
      env.operatorIpcRenderer.send('stage-control', 'FTB', { active: false });
      // Allow FTB release ramp simulation to advance
      await sleep(60);
      assert.strictEqual(env.stageApi.getIsFTB(), false, 'Stage isFTB must be false');

      // EMPIRICAL CRITICAL INVARIANT: Video MUST REMAIN DUCKED!
      assert.strictEqual(activeVid.volume, 0, 'CRITICAL: Video volume must REMAIN 0 after FTB release!');
      assert.strictEqual(activeVid.muted, true, 'CRITICAL: Video must REMAIN muted after FTB release!');
      assert.strictEqual(activeVid.dataset.independentAudioMuted, 'true', 'dataset.independentAudioMuted must persist');
    });

    it('Step 4: Stop audio track -> hot-swap another video cue (new video must NOT be ducked, volume = masterVolume)', async () => {
      const env = createAdversarialSimulationEnv();

      // 1. Play audio & duck video 1
      env.setAudioPlaying(true);
      const videoCue1 = { id: 'cue_vid_1', name: 'Background 1.mp4', type: 'video', path: 'd:\\LUMEN\\assets\\clip1.mp4' };
      env.dualDeckApi.triggerGoLive(videoCue1);
      await sleep(50);

      const activeVid1 = env.stageApi.getActiveVideo();
      assert.strictEqual(activeVid1.volume, 0);

      // 2. Stop audio track
      env.setAudioStopped();
      assert.strictEqual(env.operatorAudioDeck.paused, true, 'Audio deck is stopped');

      // 3. Hot-swap video cue 2
      const videoCue2 = {
        id: 'cue_vid_2',
        name: 'Standalone Keynote Video.mp4',
        type: 'video',
        path: 'd:\\LUMEN\\assets\\clip2.mp4',
        duration: 90
      };

      env.dualDeckApi.setTransition('cut');
      env.dualDeckApi.triggerGoLive(videoCue2);
      await sleep(100);

      // Verify IPC payload
      const lastPayload = env.goLivePayloadLog[env.goLivePayloadLog.length - 1];
      assert.strictEqual(lastPayload.hasIndependentAudioTrack, false, 'hasIndependentAudioTrack must be FALSE when audio is stopped');

      // Verify Stage active video element
      const activeVid2 = env.stageApi.getActiveVideo();
      assert.ok(activeVid2, 'New video must be mounted on Stage');
      assert.strictEqual(activeVid2.volume, env.stageApi.getMasterVolume(), 'New video volume must match masterVolume (1.0)');
      assert.strictEqual(activeVid2.muted, false, 'New video must NOT be muted');
      assert.strictEqual(activeVid2.dataset.independentAudioMuted, undefined, 'dataset.independentAudioMuted must NOT be set');
    });

    it('Continuous End-to-End Execution of the Complete 4-Step Cycle in a Single Session', async () => {
      const env = createAdversarialSimulationEnv();

      // --- PHASE 1: AUDIO PLAY + VIDEO HOT-SWAP ---
      env.setAudioPlaying(true);
      const video1 = { id: 'v1', name: 'Singer Visual.mp4', type: 'video', path: 'clip1.mp4' };
      env.dualDeckApi.triggerGoLive(video1);
      await sleep(100);

      let vid = env.stageApi.getActiveVideo();
      assert.strictEqual(vid.volume, 0, 'Phase 1: Video must be ducked to 0');
      assert.strictEqual(vid.muted, true, 'Phase 1: Video must be muted');
      assert.strictEqual(vid.dataset.independentAudioMuted, 'true');

      // --- PHASE 2: BLACKOUT CYCLE ---
      env.operatorIpcRenderer.send('stage-control', 'BLACKOUT', { active: true });
      await sleep(40);
      assert.strictEqual(env.stageApi.getIsBlackout(), true);
      assert.strictEqual(vid.volume, 0);

      env.operatorIpcRenderer.send('stage-control', 'BLACKOUT', { active: false });
      await sleep(40);
      assert.strictEqual(env.stageApi.getIsBlackout(), false);
      assert.strictEqual(vid.volume, 0, 'Phase 2: Video volume MUST remain 0 after Blackout release');
      assert.strictEqual(vid.muted, true, 'Phase 2: Video MUST remain muted after Blackout release');

      // --- PHASE 3: FTB CYCLE ---
      env.operatorIpcRenderer.send('stage-control', 'FTB', { active: true });
      await sleep(40);
      assert.strictEqual(env.stageApi.getIsFTB(), true);

      env.operatorIpcRenderer.send('stage-control', 'FTB', { active: false });
      await sleep(80);
      assert.strictEqual(env.stageApi.getIsFTB(), false);
      assert.strictEqual(vid.volume, 0, 'Phase 3: Video volume MUST remain 0 after FTB release');
      assert.strictEqual(vid.muted, true, 'Phase 3: Video MUST remain muted after FTB release');

      // --- PHASE 4: STOP AUDIO + HOT-SWAP VIDEO 2 ---
      env.setAudioStopped();
      const video2 = { id: 'v2', name: 'Presentation.mp4', type: 'video', path: 'clip2.mp4' };
      env.dualDeckApi.setTransition('cut');
      env.dualDeckApi.triggerGoLive(video2);
      await sleep(100);

      vid = env.stageApi.getActiveVideo();
      assert.strictEqual(vid.volume, 1.0, 'Phase 4: Video 2 volume MUST be 1.0 (masterVolume)');
      assert.strictEqual(vid.muted, false, 'Phase 4: Video 2 MUST NOT be muted');
      assert.strictEqual(vid.dataset.independentAudioMuted, undefined, 'Phase 4: independentAudioMuted NOT set');
    });
  });

  // =========================================================================
  // REQUIREMENT 2: Natural Audio Completion (onended)
  // =========================================================================
  describe('2. Natural Audio Completion (onended) Lifecycle', () => {

    it('Audio track completes naturally (ended = true) -> hot-swap video cue plays at masterVolume', async () => {
      const env = createAdversarialSimulationEnv();

      // Audio starts and ducks video 1
      env.setAudioPlaying(true);
      env.dualDeckApi.triggerGoLive({ id: 'v1', name: 'V1.mp4', type: 'video', path: 'v1.mp4' });
      await sleep(50);
      assert.strictEqual(env.stageApi.getActiveVideo().volume, 0);

      // Track naturally ends
      env.setAudioEnded();
      assert.strictEqual(env.operatorAudioDeck.ended, true);
      assert.strictEqual(env.operatorAudioDeck.paused, true);

      // Hot-swap next video cue
      const video2 = { id: 'v2', name: 'Product_Launch.mp4', type: 'video', path: 'launch.mp4' };
      env.dualDeckApi.setTransition('cut');
      env.dualDeckApi.triggerGoLive(video2);
      await sleep(100);

      const lastPayload = env.goLivePayloadLog[env.goLivePayloadLog.length - 1];
      assert.strictEqual(lastPayload.hasIndependentAudioTrack, false, 'hasIndependentAudioTrack must be false after track ended');

      const activeVid = env.stageApi.getActiveVideo();
      assert.strictEqual(activeVid.volume, 1.0, 'Video volume restored to masterVolume');
      assert.strictEqual(activeVid.muted, false, 'Video not muted');
    });
  });

  // =========================================================================
  // REQUIREMENT 3: Audio Resumption & Re-Ducking (Multi-State Cycles)
  // =========================================================================
  describe('3. Audio Resumption & Re-Ducking (Multi-State Cycles)', () => {

    it('Ducking properly re-engages when audio is resumed for a subsequent visual cue', async () => {
      const env = createAdversarialSimulationEnv();

      // 1. Audio stopped -> video 1 is standalone (volume = 1.0)
      env.setAudioStopped();
      env.dualDeckApi.setTransition('cut');
      env.dualDeckApi.triggerGoLive({ id: 'v1', name: 'Standalone.mp4', type: 'video', path: 'v1.mp4' });
      await sleep(100);
      assert.strictEqual(env.stageApi.getActiveVideo().volume, 1.0);

      // 2. Audio starts playing
      env.setAudioPlaying(true);

      // 3. Hot-swap video 2 -> video 2 MUST be ducked
      env.dualDeckApi.triggerGoLive({ id: 'v2', name: 'BGM_Visual.mp4', type: 'video', path: 'v2.mp4' });
      await sleep(100);
      const vid2 = env.stageApi.getActiveVideo();
      assert.strictEqual(vid2.volume, 0, 'Video 2 must be ducked to 0 upon audio resumption');
      assert.strictEqual(vid2.muted, true, 'Video 2 must be muted');
      assert.strictEqual(vid2.dataset.independentAudioMuted, 'true');

      // 4. Audio pauses again
      env.setAudioPlaying(false);

      // 5. Hot-swap video 3 -> video 3 MUST play at masterVolume
      env.dualDeckApi.triggerGoLive({ id: 'v3', name: 'Solo_Clip.mp4', type: 'video', path: 'v3.mp4' });
      await sleep(100);
      const vid3 = env.stageApi.getActiveVideo();
      assert.strictEqual(vid3.volume, 1.0, 'Video 3 must play at masterVolume when audio paused');
      assert.strictEqual(vid3.muted, false, 'Video 3 must not be muted');
    });
  });

  // =========================================================================
  // REQUIREMENT 4: Non-Regression of Normal Video Panic Restorations
  // =========================================================================
  describe('4. Normal Video Panic Restorations (Non-Regression)', () => {

    it('Normal un-ducked video correctly restores volume to masterVolume upon Blackout release', async () => {
      const env = createAdversarialSimulationEnv();
      env.setAudioStopped();

      // Launch normal video
      env.dualDeckApi.setTransition('cut');
      env.dualDeckApi.triggerGoLive({ id: 'normal_vid', name: 'Normal.mp4', type: 'video', path: 'normal.mp4' });
      await sleep(100);

      const activeVid = env.stageApi.getActiveVideo();
      assert.strictEqual(activeVid.volume, 1.0);
      assert.strictEqual(activeVid.muted, false);

      // Trigger Blackout
      env.operatorIpcRenderer.send('stage-control', 'BLACKOUT', { active: true });
      await sleep(40);
      assert.strictEqual(activeVid.volume, 0, 'Volume set to 0 in Blackout');

      // Release Blackout -> volume MUST be restored to masterVolume
      env.operatorIpcRenderer.send('stage-control', 'BLACKOUT', { active: false });
      await sleep(40);
      assert.strictEqual(activeVid.volume, 1.0, 'Normal video volume MUST be restored to 1.0 upon Blackout release');
      assert.strictEqual(activeVid.muted, false, 'Normal video muted state preserved');
    });

    it('Normal un-ducked video correctly restores volume to masterVolume upon FTB release', async () => {
      const env = createAdversarialSimulationEnv();
      env.setAudioStopped();

      // Launch normal video
      env.dualDeckApi.setTransition('cut');
      env.dualDeckApi.triggerGoLive({ id: 'normal_vid_ftb', name: 'NormalFTB.mp4', type: 'video', path: 'normal_ftb.mp4' });
      await sleep(100);

      const activeVid = env.stageApi.getActiveVideo();
      assert.strictEqual(activeVid.volume, 1.0);

      // Trigger FTB
      env.operatorIpcRenderer.send('stage-control', 'FTB', { active: true });
      await sleep(20);

      // Release FTB
      env.operatorIpcRenderer.send('stage-control', 'FTB', { active: false });
      // Allow FTB release ramp simulation to complete
      await sleep(70);

      // Volume must ramp up or reach target
      assert.ok(activeVid.volume > 0, 'Normal video volume must ramp up upon FTB release');
    });
  });

  // =========================================================================
  // REQUIREMENT 5: Stress & Jitter Testing on Ducked Video
  // =========================================================================
  describe('5. Stress & Jitter Testing on Ducked Video', () => {

    it('Rapid alternating Blackout and FTB panic toggles (20 cycles) never elevate ducked video volume', async () => {
      const env = createAdversarialSimulationEnv();
      env.setAudioPlaying(true);

      env.dualDeckApi.triggerGoLive({ id: 'ducked_stress', name: 'DuckedStress.mp4', type: 'video', path: 'stress.mp4' });
      await sleep(50);

      const activeVid = env.stageApi.getActiveVideo();
      assert.strictEqual(activeVid.volume, 0);

      for (let cycle = 0; cycle < 20; cycle++) {
        // Toggle Blackout
        env.operatorIpcRenderer.send('stage-control', 'BLACKOUT', { active: true });
        env.operatorIpcRenderer.send('stage-control', 'BLACKOUT', { active: false });

        // Toggle FTB
        env.operatorIpcRenderer.send('stage-control', 'FTB', { active: true });
        env.operatorIpcRenderer.send('stage-control', 'FTB', { active: false });

        // Check invariant on every single cycle
        assert.strictEqual(activeVid.volume, 0, `Ducked video volume leaked at cycle ${cycle}`);
        assert.strictEqual(activeVid.muted, true, `Ducked video unmuted at cycle ${cycle}`);
      }
    });

    it('Master MUTE toggles while video is ducked keep ducked video strictly muted', async () => {
      const env = createAdversarialSimulationEnv();
      env.setAudioPlaying(true);

      env.dualDeckApi.triggerGoLive({ id: 'ducked_mute', name: 'DuckedMute.mp4', type: 'video', path: 'mute.mp4' });
      await sleep(50);

      const activeVid = env.stageApi.getActiveVideo();
      assert.strictEqual(activeVid.muted, true);

      // Master Mute ON
      env.operatorIpcRenderer.send('stage-control', 'SET_MUTE', { muted: true });
      assert.strictEqual(activeVid.muted, true);

      // Master Mute OFF (Unmute) -> Ducked video MUST NOT UNMUTE!
      env.operatorIpcRenderer.send('stage-control', 'SET_MUTE', { muted: false });
      assert.strictEqual(activeVid.muted, true, 'Ducked video must remain muted when master is unmuted');
      assert.strictEqual(activeVid.volume, 0, 'Ducked video volume must remain 0');
    });

    it('Master Volume fader changes while video is ducked never elevate video volume', async () => {
      const env = createAdversarialSimulationEnv();
      env.setAudioPlaying(true);

      env.dualDeckApi.triggerGoLive({ id: 'ducked_fader', name: 'DuckedFader.mp4', type: 'video', path: 'fader.mp4' });
      await sleep(50);

      const activeVid = env.stageApi.getActiveVideo();

      // Jitter volume from 0 to 1 in steps
      for (let v = 0; v <= 10; v++) {
        const testVol = v / 10;
        env.operatorIpcRenderer.send('stage-control', 'SET_VOLUME', { volume: testVol });
        assert.strictEqual(activeVid.volume, 0, `Ducked video volume changed to ${activeVid.volume} at fader ${testVol}`);
        assert.strictEqual(activeVid.muted, true);
      }
    });
  });

  after(() => {
    setTimeout(() => {
      process.exit(0);
    }, 50).unref();
  });
});
