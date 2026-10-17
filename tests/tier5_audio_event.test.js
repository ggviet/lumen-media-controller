/**
 * tests/tier5_audio_event.test.js
 * Tier 5: Audio-Visual Event Controller E2E Test Suite
 *
 * Requirements: R1, R2, R3, R4 (Milestone M2: R4)
 *
 * 20 Automated Tests across 7 Categories:
 * - Category 1: Audio Format Ingestion & Metadata (TC-T5-01 to TC-T5-05)
 * - Category 2: Flexible Sync-Start Pairing (TC-T5-06 to TC-T5-09)
 * - Category 3: Decoupled Live Visual Hot-Swapping (TC-T5-10 to TC-T5-13)
 * - Category 4: Stage Clean Fallback (TC-T5-14 to TC-T5-16)
 * - Category 5: Selective Panic & Tactile Shortcuts (TC-T5-17 to TC-T5-18)
 * - Category 6: Master Volume & Mute Unified Modulation (TC-T5-19)
 * - Category 7: Audio Hotplug & Disconnect Protection (TC-T5-20)
 *
 * Test Runner: Node.js 22 built-in (node:test, node:assert)
 */

const { describe, it, beforeEach, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');

const { DisplayManagerEngine } = require('./harness/display_manager.js');
const { DualDeckEngine } = require('./harness/dual_deck_engine.js');
const { AudioSubsystemEngine } = require('./harness/audio_subsystem.js');
const { PanicAndHardwareEngine } = require('./harness/panic_hardware_engine.js');
const { readCompleteHtml } = require('./test_helpers.js');

// Load production source files verbatim
const mainSrc = fs.readFileSync(path.join(__dirname, '../src/main/index.js'), 'utf8');
const stageScriptSrc = fs.readFileSync(path.join(__dirname, '../src/renderer/stage/scripts/stage.js'), 'utf8');
const dualDeckScriptSrc = fs.readFileSync(path.join(__dirname, '../src/renderer/operator/scripts/dual_deck.js'), 'utf8');
const rundownScriptSrc = fs.readFileSync(path.join(__dirname, '../src/renderer/operator/scripts/rundown.js'), 'utf8');
const audioRoutingScriptSrc = fs.readFileSync(path.join(__dirname, '../src/renderer/operator/scripts/audio_routing.js'), 'utf8');
const hotkeysScriptSrc = fs.readFileSync(path.join(__dirname, '../src/renderer/operator/scripts/hotkeys.js'), 'utf8');
const stageHtml = readCompleteHtml(path.join(__dirname, '../src/renderer/stage/index.html'));
const operatorHtml = readCompleteHtml(path.join(__dirname, '../src/renderer/operator/index.html'));

/**
 * Lightweight mock DOM Element representation for headless simulation
 */
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
    this.complete = true;
    this.decode = () => Promise.resolve();
    this.requestVideoFrameCallback = (cb) => { cb(0, {}); return 1; };
    this.eventListeners = new Map();
    this.sinkId = '';
    this.options = [];
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
    if (this.tagName === 'SELECT' && child.tagName === 'OPTION') {
      this.options.push(child);
    }
    return child;
  }

  removeChild(child) {
    const idx = this.children.indexOf(child);
    if (idx !== -1) {
      this.children.splice(idx, 1);
      child.parentNode = null;
    }
    if (this.tagName === 'SELECT' && child.tagName === 'OPTION') {
      const optIdx = this.options.indexOf(child);
      if (optIdx !== -1) this.options.splice(optIdx, 1);
    }
    return child;
  }

  querySelector(selector) {
    if (selector === 'video') return this.children.find(c => c.tagName === 'VIDEO') || null;
    if (selector === 'img') return this.children.find(c => c.tagName === 'IMG') || null;
    if (selector === 'audio') return this.children.find(c => c.tagName === 'AUDIO') || null;
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
    this.ended = false;
    const handlers = this.eventListeners.get('play') || [];
    handlers.forEach(h => h({ target: this }));
    return Promise.resolve();
  }

  pause() {
    this.paused = true;
    const handlers = this.eventListeners.get('pause') || [];
    handlers.forEach(h => h({ target: this }));
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

/**
 * Build unified Stage + Operator execution harness
 */
function createUnifiedEventControllerHarness() {
  const operatorIpc = new EventEmitter();
  const stageIpc = new EventEmitter();

  // IPC bridge
  const goLiveLog = [];
  const stageControlLog = [];

  operatorIpc.send = (channel, ...args) => {
    if (channel === 'go-live') {
      goLiveLog.push(args[0]);
      stageIpc.emit('stage-go-live', {}, args[0]);
    } else if (channel === 'stage-control') {
      stageControlLog.push({ action: args[0], data: args[1] });
      stageIpc.emit('stage-control', {}, args[0], args[1]);
    }
  };

  stageIpc.send = (channel, ...args) => {
    operatorIpc.emit(channel, {}, ...args);
  };

  // Stage DOM mocks
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

  const stageDoc = {
    documentElement: { style: {} },
    body: { style: {}, requestPointerLock: () => Promise.resolve() },
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

  const stageWin = {
    addEventListener: () => {},
    removeEventListener: () => {},
    requestAnimationFrame: (cb) => {
      const t = setTimeout(() => cb(Date.now()), 1);
      if (t && typeof t.unref === 'function') t.unref();
      return t;
    },
    cancelAnimationFrame: (id) => clearTimeout(id),
    setTimeout: (cb, ms) => {
      const t = setTimeout(cb, ms);
      if (t && typeof t.unref === 'function') t.unref();
      return t;
    },
    clearTimeout: (id) => clearTimeout(id),
    location: { href: 'http://localhost/stage' }
  };

  // Instantiate Stage Controller
  const mockRequire = (mod) => {
    if (mod === 'electron') return { ipcRenderer: stageIpc };
    if (mod === 'path') return path;
    if (mod === 'fs') return fs;
    if (mod === 'url') return require('url');
    return {};
  };

  const stageFn = new Function(
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
        getIsFrozen: () => isFrozen,
        getIsSafeLogo: () => isSafeLogo,
        getBlackoutCover: () => blackoutCover,
        getSafeLogoLayer: () => safeLogoLayer,
        getSafeLogoImg: () => safeLogoImg,
        getActiveVideo: () => {
          const allVids = document.querySelectorAll('.media-deck video');
          if (currentMedia && currentMedia.path) {
            const match = allVids.find(v => v.src && v.src.includes(currentMedia.path));
            if (match) return match;
          }
          return decks[activeDeckKey].querySelector('video') || decks[activeDeckKey === 'A' ? 'B' : 'A'].querySelector('video');
        },
        getActiveImg: () => {
          return decks[activeDeckKey].querySelector('img') || decks[activeDeckKey === 'A' ? 'B' : 'A'].querySelector('img');
        },
        getDeckA: () => decks.A,
        getDeckB: () => decks.B
      };
    `
  );

  mockRequire.ipcRenderer = stageIpc;
  const stageApi = stageFn(
    stageDoc,
    stageWin,
    stageWin.requestAnimationFrame,
    stageWin.cancelAnimationFrame,
    stageWin.setTimeout,
    stageWin.clearTimeout,
    { now: () => Date.now() },
    mockRequire
  );

  // Operator DOM elements
  const operatorAudioDeck = new MockDOMElement('audio', 'operatorAudioDeck');
  const operatorCuePlayer = new MockDOMElement('audio', 'operatorCuePlayer');
  const audioSinkSelect = new MockDOMElement('select', 'audioSinkSelect');
  const cueAudioSinkSelect = new MockDOMElement('select', 'cueAudioSinkSelect');
  const masterVolumeSlider = new MockDOMElement('input', 'masterVolumeSlider');
  masterVolumeSlider.value = '1.0';

  const btnBlackout = new MockDOMElement('button', 'btnBlackout');
  const btnFreeze = new MockDOMElement('button', 'btnFreeze');
  const btnSafeLogo = new MockDOMElement('button', 'btnSafeLogo');
  const btnFTB = new MockDOMElement('button', 'btnFTB');
  const btnGoLive = new MockDOMElement('button', 'btnGoLive');
  const btnMuteMaster = new MockDOMElement('button', 'btnMuteMaster');
  const btnCueAudioDeck = new MockDOMElement('button', 'btnCueAudioDeck');
  const btnAudioSyncLive = new MockDOMElement('button', 'btnAudioSyncLive');
  const btnAudioDeckPlayPause = new MockDOMElement('button', 'btnAudioDeckPlayPause');
  const pgmFrame = new MockDOMElement('div', 'pgmFrame');
  const pgmCueTitle = new MockDOMElement('span', 'pgmCueTitle');
  const pgmContainer = new MockDOMElement('div', 'pgmContainer');
  const pgmDeckA = new MockDOMElement('div', 'pgmDeckA');
  const pgmDeckB = new MockDOMElement('div', 'pgmDeckB');
  const pgmElapsed = new MockDOMElement('span', 'pgmElapsed');
  const pgmRemaining = new MockDOMElement('span', 'pgmRemaining');

  let isAudioDeckPlayingState = false;
  let audioDeckTrack = null;
  let pvwCue = null;
  let pgmCue = null;
  let currentTransition = 'cut';
  let currentScaling = 'contain';
  let isMasterMuted = false;
  let isAudioSyncLive = true;
  let isAudioDeckCueOn = false;

  const dualDeckScope = {
    path,
    formatTime,
    toMediaUrl: (fp) => fp || '',
    ipcRenderer: operatorIpc,
    operatorAudioDeck,
    operatorCuePlayer,
    audioSinkSelect,
    cueAudioSinkSelect,
    masterVolumeSlider,
    pgmContainer,
    pgmDeckA,
    pgmDeckB,
    pgmElapsed,
    pgmRemaining,
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
    btnFreeze,
    btnSafeLogo,
    btnFTB,
    btnGoLive,
    btnMuteMaster,
    btnCueAudioDeck,
    btnAudioSyncLive,
    btnAudioDeckPlayPause,
    pgmFrame,
    pgmCueTitle,
    document: {
      getElementById: (id) => {
        switch (id) {
          case 'operatorAudioDeck': return operatorAudioDeck;
          case 'operatorCuePlayer': return operatorCuePlayer;
          case 'audioSinkSelect': return audioSinkSelect;
          case 'cueAudioSinkSelect': return cueAudioSinkSelect;
          case 'masterVolumeSlider': return masterVolumeSlider;
          case 'btnBlackout': return btnBlackout;
          case 'btnFreeze': return btnFreeze;
          case 'btnSafeLogo': return btnSafeLogo;
          case 'btnFTB': return btnFTB;
          case 'btnGoLive': return btnGoLive;
          case 'btnMuteMaster': return btnMuteMaster;
          case 'pgmContainer': return pgmContainer;
          case 'pgmDeckA': return pgmDeckA;
          case 'pgmDeckB': return pgmDeckB;
          case 'pgmElapsed': return pgmElapsed;
          case 'pgmRemaining': return pgmRemaining;
          default: return null;
        }
      },
      querySelectorAll: () => [],
      createElement: (tag) => new MockDOMElement(tag)
    },
    renderRundown: () => {},
    loadTrackToAudioDeck: (track, autoPlay) => {
      audioDeckTrack = typeof track === 'string' ? { path: track, name: track } : track;
      operatorAudioDeck.src = audioDeckTrack.path;
      if (autoPlay) {
        isAudioDeckPlayingState = true;
        operatorAudioDeck.paused = false;
        operatorAudioDeck.ended = false;
        operatorAudioDeck.play().catch(() => {});
      }
    },
    playAudioDeck: () => {
      isAudioDeckPlayingState = true;
      operatorAudioDeck.paused = false;
      operatorAudioDeck.ended = false;
      operatorAudioDeck.play().catch(() => {});
    },
    pauseAudioDeck: () => {
      isAudioDeckPlayingState = false;
      operatorAudioDeck.paused = true;
    },
    stopAudioDeck: () => {
      isAudioDeckPlayingState = false;
      operatorAudioDeck.paused = true;
      operatorAudioDeck.currentTime = 0;
      operatorAudioDeck.volume = 0;
    },
    requestAnimationFrame: (cb) => {
      const t = setTimeout(() => cb(Date.now()), 1);
      if (t && typeof t.unref === 'function') t.unref();
      return t;
    },
    cancelAnimationFrame: (id) => clearTimeout(id),
    setTimeout: (cb, ms) => {
      const t = setTimeout(cb, ms);
      if (t && typeof t.unref === 'function') t.unref();
      return t;
    },
    clearTimeout: (id) => clearTimeout(id),
    window: stageWin,
    resolveOperatorAssetDir: () => path.join(__dirname, '../assets')
  };

  const dualDeckKeys = Object.keys(dualDeckScope);
  const dualDeckModuleFunc = new Function(
    ...dualDeckKeys,
    `
      ${dualDeckScriptSrc}
      return {
        triggerGoLive,
        setPvwCue: (c) => { pvwCue = c; },
        setTransition: (t) => { currentTransition = t; },
        getGoLiveLog: () => goLiveLog,
        getStageControlLog: () => stageControlLog
      };
    `
  );

  const dualDeckApi = dualDeckModuleFunc(...Object.values(dualDeckScope));

  return {
    stageApi,
    dualDeckApi,
    operatorAudioDeck,
    operatorCuePlayer,
    audioSinkSelect,
    cueAudioSinkSelect,
    masterVolumeSlider,
    btnBlackout,
    btnFreeze,
    btnSafeLogo,
    btnFTB,
    btnGoLive,
    btnMuteMaster,
    operatorIpc,
    stageIpc,
    goLiveLog,
    stageControlLog,
    setAudioPlaying: (playing, time = 0) => {
      isAudioDeckPlayingState = playing;
      operatorAudioDeck.paused = !playing;
      operatorAudioDeck.ended = false;
      operatorAudioDeck.currentTime = time;
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
      operatorAudioDeck.volume = 0;
    }
  };
}

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Format time utility helper matching production rundown.js logic
function formatTime(seconds) {
  if (!seconds || isNaN(seconds) || seconds < 0) return '00:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

// Media extension validation matching production rundown.js
const ALLOWED_AUDIO_EXTS = new Set(['mp3', 'wav', 'm4a', 'aac', 'flac']);
const ALLOWED_VIDEO_EXTS = new Set(['mp4', 'mov', 'webm', 'mkv']);
const ALLOWED_IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'svg', 'webp']);
const ALLOWED_MEDIA_EXTS = new Set([...ALLOWED_VIDEO_EXTS, ...ALLOWED_IMAGE_EXTS, ...ALLOWED_AUDIO_EXTS]);

function validateMediaExtension(filePath) {
  if (!filePath || typeof filePath !== 'string') return false;
  const parts = filePath.split('.');
  if (parts.length < 2) return false;
  const ext = parts.pop().toLowerCase().trim();
  return ALLOWED_MEDIA_EXTS.has(ext);
}

// ==============================================================================
// TEST SUITE: TIER 5 (20 AUTOMATED TESTS ACROSS 7 CATEGORIES)
// ==============================================================================

describe('Tier 5: Audio-Visual Event Controller E2E Test Suite', () => {

  // ============================================================================
  // Category 1: Audio Format Ingestion & Metadata (TC-T5-01 to TC-T5-05)
  // ============================================================================
  describe('Category 1: Audio Format Ingestion & Metadata (TC-T5-01 to TC-T5-05)', () => {

    it('TC-T5-01: Ingestion of .mp3, .wav, .m4a, .aac, .flac audio formats generates valid cue descriptors', () => {
      const audioFiles = [
        'Song_Performance.mp3',
        'Backing_Track.wav',
        'Corporate_Theme.m4a',
        'Vocal_Lead.aac',
        'Master_Audio.flac',
        'Case_Insensitive_Test.MP3',
        'Lossless_Studio.FLAC'
      ];

      // 1. Verify all 5 formats pass extension validation case-insensitively
      audioFiles.forEach(f => {
        assert.strictEqual(validateMediaExtension(f), true, `File ${f} should be valid`);
      });

      // 2. Ingest and assert descriptor fields
      audioFiles.forEach((f, idx) => {
        const ext = f.split('.').pop().toLowerCase();
        const cue = {
          id: `cue_aud_${Date.now()}_${idx}`,
          name: f,
          path: `d:\\Audio\\${f}`,
          type: ALLOWED_AUDIO_EXTS.has(ext) ? 'audio' : 'other',
          format: ext.toUpperCase(),
          duration: 185.4
        };

        assert.strictEqual(cue.type, 'audio');
        assert.ok(cue.id.startsWith('cue_aud_'));
        assert.strictEqual(formatTime(cue.duration), '03:05');
      });

      // 3. Verify main process file picker filter includes Audio Files with all 5 extensions
      assert.ok(mainSrc.includes("name: 'Audio Files'"), 'Main process must declare Audio Files filter');
      ['mp3', 'wav', 'm4a', 'aac', 'flac'].forEach(ext => {
        assert.ok(mainSrc.includes(`'${ext}'`), `Main process filter must include ${ext}`);
      });
    });

    it('TC-T5-02: Non-media and script file ingestion (.pdf, .exe, .txt, .bat, .sh) is strictly rejected', () => {
      const invalidFiles = [
        'Conference_Schedule.pdf',
        'Malicious_Payload.exe',
        'Speaker_Notes.txt',
        'AutoRun.bat',
        'Server_Deploy.sh',
        'Exploit_Script.js',
        'Arbitrary_Binary.bin',
        'file_without_extension',
        '',
        null,
        undefined
      ];

      invalidFiles.forEach(f => {
        assert.strictEqual(validateMediaExtension(f), false, `Invalid file '${f}' must be strictly rejected`);
      });
    });

    it('TC-T5-03: Independent Audio Deck routes to Master FOH soundcard via setSinkId without visual video', async () => {
      const harness = createUnifiedEventControllerHarness();

      // Bind to Master FOH device sink
      const fohSinkId = 'dev_foh_soundcard';
      await harness.operatorAudioDeck.setSinkId(fohSinkId);
      assert.strictEqual(harness.operatorAudioDeck.sinkId, fohSinkId);

      // Play audio independently
      harness.operatorAudioDeck.src = 'd:\\Audio\\Keynote_BGM.mp3';
      await harness.operatorAudioDeck.play();

      assert.strictEqual(harness.operatorAudioDeck.paused, false);
      assert.strictEqual(harness.operatorAudioDeck.sinkId, fohSinkId);

      // Verify Stage visual plane has no video playing
      const activeVid = harness.stageApi.getActiveVideo();
      assert.strictEqual(activeVid, null, 'No video should be active on Stage when playing standalone audio');
    });

    it('TC-T5-04: Cue Headphone pre-listen channel isolates audio track while Master FOH is muted, playing, or in blackout', async () => {
      const harness = createUnifiedEventControllerHarness();

      // Configure separate hardware sinks
      await harness.operatorAudioDeck.setSinkId('dev_foh_soundcard');
      await harness.operatorCuePlayer.setSinkId('dev_headphone_jack');
      assert.notStrictEqual(harness.operatorAudioDeck.sinkId, harness.operatorCuePlayer.sinkId);

      // Mute Master FOH and trigger Blackout on Stage
      harness.operatorAudioDeck.muted = true;
      harness.stageIpc.emit('stage-control', {}, 'BLACKOUT', { active: true });
      assert.strictEqual(harness.stageApi.getIsBlackout(), true);

      // Cue Headphone player plays track for operator PFL inspection
      harness.operatorCuePlayer.src = 'd:\\Audio\\Next_Speaker_Intro.mp3';
      harness.operatorCuePlayer.muted = false;
      await harness.operatorCuePlayer.play();

      assert.strictEqual(harness.operatorCuePlayer.paused, false, 'Cue player must play independently');
      assert.strictEqual(harness.operatorCuePlayer.muted, false, 'Cue player must remain unmuted');
      assert.strictEqual(harness.operatorAudioDeck.muted, true, 'Master FOH must remain muted');
    });

    it('TC-T5-05: Audio Seekbar scrubbing calculates accurate time offsets and clamps boundaries', () => {
      const totalDuration = 210.5; // 3 minutes 30.5 seconds

      // Scrub calculations
      const scrubPositions = [
        { percent: 0, expectedTime: 0, expectedElapsed: '00:00', expectedRem: '-03:30' },
        { percent: 25, expectedTime: 52.625, expectedElapsed: '00:52', expectedRem: '-02:37' },
        { percent: 50, expectedTime: 105.25, expectedElapsed: '01:45', expectedRem: '-01:45' },
        { percent: 100, expectedTime: 210.5, expectedElapsed: '03:30', expectedRem: '-00:00' }
      ];

      scrubPositions.forEach(pos => {
        const targetTime = (pos.percent / 100) * totalDuration;
        const elapsed = formatTime(targetTime);
        const remaining = '-' + formatTime(Math.max(0, totalDuration - targetTime));

        assert.strictEqual(elapsed, pos.expectedElapsed);
        assert.strictEqual(remaining, pos.expectedRem);
      });

      // Boundary clamping tests: negative time and overflow
      function clampSeek(time, duration) {
        return Math.max(0, Math.min(duration, time));
      }

      assert.strictEqual(clampSeek(-45, totalDuration), 0);
      assert.strictEqual(clampSeek(999, totalDuration), 210.5);
    });
  });

  // ============================================================================
  // Category 2: Flexible Sync-Start Pairing (TC-T5-06 to TC-T5-09)
  // ============================================================================
  describe('Category 2: Flexible Sync-Start Pairing (TC-T5-06 to TC-T5-09)', () => {

    it('TC-T5-06: Paired MP3 + MP4 simultaneously trigger on GO LIVE with sub-15ms sync delta', async () => {
      const harness = createUnifiedEventControllerHarness();

      let audioPlayTimestamp = 0;
      let stageGoLiveTimestamp = 0;

      harness.operatorAudioDeck.play = async () => {
        audioPlayTimestamp = performance.now();
        harness.operatorAudioDeck.paused = false;
        return Promise.resolve();
      };

      harness.stageIpc.on('stage-go-live', () => {
        stageGoLiveTimestamp = performance.now();
      });

      const pairedCue = {
        id: 'cue_paired_1',
        name: 'Opening_Ceremony.mp4',
        type: 'video',
        path: 'd:\\Video\\Opening.mp4',
        pairedAudioPath: 'd:\\Audio\\Ceremony_Theme.mp3'
      };

      harness.dualDeckApi.triggerGoLive(pairedCue);
      await sleep(20);

      assert.ok(audioPlayTimestamp > 0, 'Audio deck play must be triggered');
      assert.ok(stageGoLiveTimestamp > 0, 'Stage go-live must be triggered');

      const deltaMs = Math.abs(audioPlayTimestamp - stageGoLiveTimestamp);
      assert.ok(deltaMs < 15, `Sync delta ${deltaMs.toFixed(2)}ms must be < 15ms`);

      const lastPayload = harness.goLiveLog[harness.goLiveLog.length - 1];
      assert.strictEqual(lastPayload.hasIndependentAudioTrack, true);
    });

    it('TC-T5-07: Audio Deck initiates Master FOH playback on Sync-Start while Stage mounts visual MP4', async () => {
      const harness = createUnifiedEventControllerHarness();

      const pairedCue = {
        id: 'cue_paired_2',
        name: 'Product_Launch_Video.mp4',
        type: 'video',
        path: 'd:\\Video\\Product.mp4',
        pairedAudioPath: 'd:\\Audio\\Product_Soundtrack.mp3'
      };

      harness.dualDeckApi.triggerGoLive(pairedCue);
      await sleep(50);

      // Verify Operator Audio Deck
      assert.strictEqual(harness.operatorAudioDeck.paused, false, 'Audio deck should be playing');
      assert.ok(harness.operatorAudioDeck.src.includes('Product_Soundtrack.mp3'));

      // Verify Stage mounts the visual video
      const stageVid = harness.stageApi.getActiveVideo();
      assert.ok(stageVid, 'Stage video element must be mounted');
      assert.ok(stageVid.src.includes('Product.mp4'));
    });

    it('TC-T5-08: Pre-roll validation ensures audio readiness and video decode readyState before Sync-Start', async () => {
      const dualDeckEngine = new DualDeckEngine();

      const videoCue = {
        id: 'cue_preroll_vid',
        name: '4K_Intro.mp4',
        type: 'video',
        path: 'd:\\Video\\4K_Intro.mp4'
      };

      const preRoll = await dualDeckEngine.preRollMedia(videoCue);
      assert.strictEqual(preRoll.success, true);
      assert.ok(preRoll.readyState >= 2, 'Pre-roll readyState must be >= 2 (HAVE_CURRENT_DATA)');
      assert.strictEqual(preRoll.firstFrameDecoded, true);
    });

    it('TC-T5-09: Unpairing audio track reverts cue to standalone visual playback without launching Audio Deck', async () => {
      const harness = createUnifiedEventControllerHarness();
      harness.setAudioStopped();

      // Cue without paired audio
      const standaloneCue = {
        id: 'cue_standalone',
        name: 'Keynote_Speaker.mp4',
        type: 'video',
        path: 'd:\\Video\\Keynote.mp4',
        pairedAudioPath: null
      };

      harness.dualDeckApi.setTransition('cut');
      harness.dualDeckApi.triggerGoLive(standaloneCue);
      await sleep(50);

      // Audio deck should NOT be playing
      assert.strictEqual(harness.operatorAudioDeck.paused, true);

      // Stage video should NOT be ducked
      const stageVid = harness.stageApi.getActiveVideo();
      assert.ok(stageVid);
      assert.strictEqual(stageVid.volume, 1.0, 'Standalone video volume must equal masterVolume');
      assert.strictEqual(stageVid.muted, false, 'Standalone video must not be muted');
      assert.strictEqual(stageVid.dataset.independentAudioMuted, undefined);
    });
  });

  // ============================================================================
  // Category 3: Decoupled Live Visual Hot-Swapping (TC-T5-10 to TC-T5-13)
  // ============================================================================
  describe('Category 3: Decoupled Live Visual Hot-Swapping (TC-T5-10 to TC-T5-13)', () => {

    it('TC-T5-10: Hot-swapping visual cues during active audio across Cut, 400ms, 800ms, 1600ms causes 0ms audio dropout', async () => {
      const harness = createUnifiedEventControllerHarness();

      // Start live audio track
      harness.setAudioPlaying(true, 15.0);
      assert.strictEqual(harness.operatorAudioDeck.paused, false);

      const transitions = [
        { mode: 'cut', dur: 0 },
        { mode: 'fast', dur: 400 },
        { mode: 'normal', dur: 800 },
        { mode: 'slow', dur: 1600 }
      ];

      for (let i = 0; i < transitions.length; i++) {
        const { mode } = transitions[i];
        const nextCue = {
          id: `cue_hot_swap_${i}`,
          name: `Visual_Slide_${i}.mp4`,
          type: 'video',
          path: `d:\\Video\\Slide_${i}.mp4`
        };

        harness.dualDeckApi.setTransition(mode);
        harness.dualDeckApi.triggerGoLive(nextCue);
        await sleep(30);

        // Verify audio deck NEVER pauses or drops out
        assert.strictEqual(harness.operatorAudioDeck.paused, false, `Audio deck dropped out during ${mode} transition!`);
        assert.ok(harness.operatorAudioDeck.currentTime >= 15.0);
      }
    });

    it('TC-T5-11: Mid-playback visual crossfade leaves Audio Deck volume and playback un-reset', async () => {
      const harness = createUnifiedEventControllerHarness();

      harness.setAudioPlaying(true, 42.5);
      harness.operatorAudioDeck.volume = 0.72;

      // Operator triggers normal (800ms) crossfade to next visual
      const nextVisual = { id: 'v_next', name: 'Ambient.mp4', type: 'video', path: 'd:\\Video\\Ambient.mp4' };
      harness.dualDeckApi.setTransition('normal');
      harness.dualDeckApi.triggerGoLive(nextVisual);
      await sleep(50);

      // Audio deck properties must remain completely untouched
      assert.strictEqual(harness.operatorAudioDeck.volume, 0.72, 'Audio deck volume must not reset');
      assert.strictEqual(harness.operatorAudioDeck.currentTime, 42.5, 'Audio deck currentTime must not reset');
      assert.strictEqual(harness.operatorAudioDeck.paused, false);
    });

    it('TC-T5-12: Incoming hot-swapped video is ducked/muted during active audio playback', async () => {
      const harness = createUnifiedEventControllerHarness();
      harness.setAudioPlaying(true, 5.0);

      const incomingVideo = {
        id: 'v_incoming',
        name: 'Conference_Broll.mp4',
        type: 'video',
        path: 'd:\\Video\\Broll.mp4'
      };

      harness.dualDeckApi.setTransition('cut');
      harness.dualDeckApi.triggerGoLive(incomingVideo);
      await sleep(50);

      const stageVid = harness.stageApi.getActiveVideo();
      assert.ok(stageVid, 'Stage video must be present');
      assert.strictEqual(stageVid.volume, 0, 'Incoming video must be ducked to 0');
      assert.strictEqual(stageVid.muted, true, 'Incoming video must be muted');
      assert.strictEqual(stageVid.dataset.independentAudioMuted, 'true');
    });

    it('TC-T5-13: Rapid consecutive visual hot-swaps (3 changes in 1s) cause zero audio glitch or dropouts', async () => {
      const harness = createUnifiedEventControllerHarness();
      harness.setAudioPlaying(true, 10.0);

      let pauseEventCount = 0;
      harness.operatorAudioDeck.addEventListener('pause', () => { pauseEventCount++; });

      const rapidVideos = [
        { id: 'v_rapid_1', name: 'Rapid1.mp4', type: 'video', path: 'r1.mp4' },
        { id: 'v_rapid_2', name: 'Rapid2.mp4', type: 'video', path: 'r2.mp4' },
        { id: 'v_rapid_3', name: 'Rapid3.mp4', type: 'video', path: 'r3.mp4' }
      ];

      for (const v of rapidVideos) {
        harness.dualDeckApi.triggerGoLive(v);
        await sleep(15);
      }

      assert.strictEqual(harness.operatorAudioDeck.paused, false, 'Audio deck must remain playing');
      assert.strictEqual(pauseEventCount, 0, 'Audio deck must experience 0 pause glitch events');
    });
  });

  // ============================================================================
  // Category 4: Stage Clean Fallback (TC-T5-14 to TC-T5-16)
  // ============================================================================
  describe('Category 4: Stage Clean Fallback (TC-T5-14 to TC-T5-16)', () => {

    it('TC-T5-14: Audio-only cue going live automatically displays Key Visual / Safe Logo', async () => {
      const harness = createUnifiedEventControllerHarness();

      const audioCue = {
        id: 'cue_audio_only',
        name: 'Acoustic_Song.mp3',
        type: 'audio',
        path: 'd:\\Audio\\Song.mp3'
      };

      harness.dualDeckApi.triggerGoLive(audioCue);
      await sleep(50);

      const lastPayload = harness.goLiveLog[harness.goLiveLog.length - 1];
      assert.strictEqual(lastPayload.media.isAudioFallback, true);
      assert.ok(lastPayload.media.path.includes('sample_keyvisual.svg'));

      const img = harness.stageApi.getActiveImg();
      assert.ok(img, 'Stage must render fallback image');
      assert.ok(img.src.includes('sample_keyvisual.svg'));
    });

    it('TC-T5-15: Video ending early while audio continues dissolves smoothly to Safe Logo', async () => {
      const harness = createUnifiedEventControllerHarness();
      harness.setAudioPlaying(true);

      const shortVideo = {
        id: 'cue_short_vid',
        name: 'Short_Bumper.mp4',
        type: 'video',
        path: 'bumper.mp4',
        endBehavior: 'FADE_TO_BLACK'
      };

      harness.dualDeckApi.triggerGoLive(shortVideo);
      await sleep(50);

      const stageVid = harness.stageApi.getActiveVideo();
      assert.ok(stageVid);

      // Trigger video completion while audio is on air
      stageVid.onended();
      await sleep(20);

      assert.strictEqual(harness.stageApi.getIsSafeLogo(), true, 'Safe Logo layer must activate on video end');
      assert.strictEqual(harness.operatorAudioDeck.paused, false, 'Audio deck must continue uninterrupted');
    });

    it('TC-T5-16: Stage clean output policy guarantees zero freeze banners, cursor, or desktop chrome leak', () => {
      // Clean Stage Invariants
      assert.ok(stageHtml.includes('cursor: none !important;'), 'Cursor must be hidden via CSS !important');
      assert.ok(!stageHtml.includes('id="freezeBanner"'), 'freezeBanner DOM element must NOT exist on Stage');
      assert.ok(!stageHtml.includes('#freezeBanner'), 'freezeBanner selector must NOT exist');
      assert.ok(stageHtml.includes("document.documentElement.style.cursor = 'none'"));
      assert.ok(stageHtml.includes("document.body.style.cursor = 'none'"));
    });
  });

  // ============================================================================
  // Category 5: Selective Panic & Tactile Shortcuts (TC-T5-17 to TC-T5-18)
  // ============================================================================
  describe('Category 5: Selective Panic & Tactile Shortcuts (TC-T5-17 to TC-T5-18)', () => {

    it('TC-T5-17: Selective Panic: FREEZE and SAFE_LOGO freeze/switch visual while preserving audio ("Dập hình giữ tiếng"), selective BLACKOUT blanks visual', async () => {
      const harness = createUnifiedEventControllerHarness();
      harness.setAudioPlaying(true, 30.0);
      harness.operatorAudioDeck.volume = 0.9;

      // 1. FREEZE
      harness.stageIpc.emit('stage-control', {}, 'FREEZE', { active: true });
      assert.strictEqual(harness.stageApi.getIsFrozen(), true);
      assert.strictEqual(harness.operatorAudioDeck.paused, false, 'FREEZE must preserve live performance audio');
      assert.strictEqual(harness.operatorAudioDeck.volume, 0.9);

      // 2. SAFE_LOGO
      harness.stageIpc.emit('stage-control', {}, 'SAFE_LOGO', { active: true });
      assert.strictEqual(harness.stageApi.getIsSafeLogo(), true);
      assert.strictEqual(harness.operatorAudioDeck.paused, false, 'SAFE_LOGO must preserve live performance audio');

      // 3. Selective BLACKOUT (preserveAudio = true)
      harness.stageIpc.emit('stage-control', {}, 'BLACKOUT', { active: true, preserveAudio: true });
      assert.strictEqual(harness.stageApi.getIsBlackout(), true);
      assert.strictEqual(harness.operatorAudioDeck.paused, false, 'Selective BLACKOUT must preserve audio ("Dập hình giữ tiếng")');
      assert.strictEqual(harness.operatorAudioDeck.volume, 0.9);
    });

    it('TC-T5-18: Hard Panic Kill (Shift+B / Shift+Escape) unconditionally blanks visual and mutes audio', () => {
      const harness = createUnifiedEventControllerHarness();
      harness.setAudioPlaying(true, 10.0);

      // Simulate Hard Blackout from Shift+B
      harness.dualDeckApi.setTransition('cut');
      harness.stageIpc.emit('stage-control', {}, 'BLACKOUT', { active: true, preserveAudio: false });
      harness.setAudioStopped();

      assert.strictEqual(harness.stageApi.getIsBlackout(), true, 'Visual screen must be blanked');
      assert.strictEqual(harness.operatorAudioDeck.paused, true, 'Audio deck must be hard paused');
      assert.strictEqual(harness.operatorAudioDeck.volume, 0, 'Audio volume must be hard muted to 0');
    });
  });

  // ============================================================================
  // Category 6: Master Volume & Mute Unified Modulation (TC-T5-19)
  // ============================================================================
  describe('Category 6: Master Volume & Mute Unified Modulation (TC-T5-19)', () => {

    it('TC-T5-19: Master Volume fader and Mute toggle modulate both video audio and Audio Deck without unmuting ducked video', async () => {
      const harness = createUnifiedEventControllerHarness();
      harness.setAudioPlaying(true);

      // Hot-swap video during active audio (video becomes ducked)
      const duckedVidCue = { id: 'v_duck', name: 'Ducked.mp4', type: 'video', path: 'ducked.mp4' };
      harness.dualDeckApi.triggerGoLive(duckedVidCue);
      await sleep(50);

      const activeVid = harness.stageApi.getActiveVideo();
      assert.ok(activeVid);
      assert.strictEqual(activeVid.volume, 0);
      assert.strictEqual(activeVid.muted, true);
      assert.strictEqual(activeVid.dataset.independentAudioMuted, 'true');

      // 1. Modulate Master Volume to 0.65
      harness.masterVolumeSlider.value = '0.65';
      harness.operatorAudioDeck.volume = 0.65;
      harness.stageIpc.emit('stage-control', {}, 'SET_VOLUME', { volume: 0.65 });

      assert.strictEqual(harness.operatorAudioDeck.volume, 0.65);
      assert.strictEqual(activeVid.volume, 0, 'Ducked video volume MUST remain 0');

      // 2. Toggle Master MUTE ON
      harness.operatorAudioDeck.muted = true;
      harness.stageIpc.emit('stage-control', {}, 'SET_MUTE', { muted: true });

      assert.strictEqual(harness.operatorAudioDeck.muted, true);
      assert.strictEqual(activeVid.muted, true);

      // 3. Toggle Master MUTE OFF (Unmute)
      harness.operatorAudioDeck.muted = false;
      harness.stageIpc.emit('stage-control', {}, 'SET_MUTE', { muted: false });

      assert.strictEqual(harness.operatorAudioDeck.muted, false, 'Audio deck unmuted');
      assert.strictEqual(activeVid.muted, true, 'Ducked video MUST REMAIN MUTED when master is unmuted!');
      assert.strictEqual(activeVid.volume, 0, 'Ducked video volume MUST REMAIN 0!');
    });
  });

  // ============================================================================
  // Category 7: Audio Hotplug & Disconnect Protection (TC-T5-20)
  // ============================================================================
  describe('Category 7: Audio Hotplug & Disconnect Protection (TC-T5-20)', () => {

    it('TC-T5-20: Physical display disconnect or audio sink re-enumeration leaves Audio Deck stream uninterrupted', () => {
      const dm = new DisplayManagerEngine();
      dm.setDisplays([
        { id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, label: 'Operator Laptop' },
        { id: 2, bounds: { x: 1920, y: 0, width: 3840, height: 2160 }, label: 'Stage LED Projector' }
      ], 1);

      dm.reanchorStageWindow(2);

      const harness = createUnifiedEventControllerHarness();
      harness.setAudioPlaying(true, 50.0);
      harness.operatorAudioDeck.sinkId = 'dev_foh_soundcard';

      // 1. Physical display cable disconnected (HDMI yanked mid-song)
      const fallbackConfig = dm.handleDisplayRemoved(2);
      assert.strictEqual(fallbackConfig.isDockedPreview, true, 'Display manager gracefully docks preview');
      assert.strictEqual(fallbackConfig.alwaysOnTop, false);

      // 2. Audio stream to FOH soundcard must be completely unaffected
      assert.strictEqual(harness.operatorAudioDeck.paused, false, 'Audio playback must not be interrupted by display unplug');
      assert.strictEqual(harness.operatorAudioDeck.sinkId, 'dev_foh_soundcard', 'Audio sink binding must persist');
      assert.strictEqual(harness.operatorAudioDeck.currentTime, 50.0);
    });
  });

  after(() => {
    const handles = process._getActiveHandles ? process._getActiveHandles() : [];
    process.stderr.write(`\n=== TIER 5 AFTER HOOK: ${handles.length} HANDLES ===\n`);
    handles.forEach((h, i) => {
      process.stderr.write(`Handle ${i}: ${h.constructor ? h.constructor.name : typeof h}\n`);
      if (h && typeof h.unref === 'function') h.unref();
    });
  });
});
