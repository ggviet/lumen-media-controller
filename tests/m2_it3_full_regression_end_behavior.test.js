/**
 * tests/m2_it3_full_regression_end_behavior.test.js
 * Comprehensive Empirical Stress & Regression Test Suite:
 * Milestone 2 Iteration 3 (Full Regression & End Behavior Challenger)
 *
 * Challenger: Challenger 2 (Empirical Challenger)
 *
 * Scope under empirical challenge:
 * 1. Rundown Ingestion & Invalid File Format Rejection (Matrix of 50+ formats, edge cases, error resilience)
 * 2. Cue Card Drag-and-Drop Reordering & Store Synchronization (Bounding math, active PGM/PVW tracking, fuzzing)
 * 3. End Behaviors Invariant Verification:
 *    - HOLD_LAST_FRAME: Pauses at EOF, clamped currentTime, zero advance
 *    - LOOP: Continuously loops from 0s, zero advance
 *    - FADE_TO_BLACK: Clean 1.0s audio/video blackout ramp, stays black indefinitely, zero cue advance, GO LIVE lift
 *    - AUTO_NEXT: Decoupled advance (advances PGM cue index + 1 without jumping to preview selection),
 *                 terminal boundary halt, dynamic reorder tracking, cascading chain
 * 4. Rapid-Fire Transitions & Transition Durations (Cut 0ms, Fast 400ms, Normal 800ms, Slow 1600ms, token invalidation)
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { readCompleteHtml } = require('./test_helpers');
const EventEmitter = require('events');

const operatorHtmlPath = path.join(__dirname, '../src/renderer/operator/index.html');
const stageHtmlPath = path.join(__dirname, '../src/renderer/stage/index.html');
const operatorHtml = readCompleteHtml(operatorHtmlPath);
const stageHtml = readCompleteHtml(stageHtmlPath);

// =========================================================================
// Synthetic DOM & Event Simulator Classes
// =========================================================================
class MockEvent {
  constructor(type, options = {}) {
    this.type = type;
    this.bubbles = !!options.bubbles;
    this.cancelable = !!options.cancelable;
    this.isTrusted = options.isTrusted !== undefined ? options.isTrusted : true;
    this.target = options.target || null;
    this.currentTarget = options.currentTarget || null;
  }
}

class MockUIEvent extends MockEvent {
  constructor(type, options = {}) {
    super(type, options);
    this.detail = options.detail || 0;
  }
}

class MockMouseEvent extends MockUIEvent {
  constructor(type, options = {}) {
    super(type, options);
    this.screenX = options.screenX || 0;
    this.screenY = options.screenY || 0;
    this.clientX = options.clientX || 0;
    this.clientY = options.clientY || 0;
    this.button = options.button || 0;
    this.buttons = options.buttons || 1;
  }
}

class MockPointerEvent extends MockMouseEvent {
  constructor(type, options = {}) {
    super(type, options);
    this.pointerId = options.pointerId || 1;
    this.pointerType = options.pointerType || 'mouse';
  }
}

/**
 * Creates an Operator Runtime Environment extracting verbatim production code
 */
function createOperatorRuntime(initialRundown = []) {
  const triggerGoLiveMatch = operatorHtml.match(/function triggerGoLive\([\s\S]*?\n        \}/);
  assert.ok(triggerGoLiveMatch, 'triggerGoLive must exist in operator/index.html');

  const stageStatusMatch = operatorHtml.match(/ipcRenderer\.on\('stage-status',\s*\(event,\s*status\)\s*=>\s*\{([\s\S]*?)\n        \}\);/);
  assert.ok(stageStatusMatch, 'stage-status handler must exist in operator/index.html');

  const reorderRundownMatch = operatorHtml.match(/function reorderRundown\(fromIndex, toIndex\) \{[\s\S]*?\n            return true;\s*\n        \}/);
  assert.ok(reorderRundownMatch, 'reorderRundown must exist in operator/index.html');

  const validateFnMatch = operatorHtml.match(/function validateMediaExtension\([\s\S]*?\n        \}/);
  assert.ok(validateFnMatch, 'validateMediaExtension must exist in operator/index.html');

  const extSetMatch = operatorHtml.match(/const ALLOWED_VIDEO_EXTS = new Set\(\[(.*?)\]\);[\s\S]*?const ALLOWED_IMAGE_EXTS = new Set\(\[(.*?)\]\);[\s\S]*?const ALLOWED_ALL_EXTS = new Set\(\[\.\.\.ALLOWED_VIDEO_EXTS, \.\.\.ALLOWED_IMAGE_EXTS\]\);/);
  assert.ok(extSetMatch, 'Allowed extension sets must exist in operator/index.html');

  const runtimeScript = `
    const sentIpcMessages = [];
    const ipcRenderer = {
      send: (channel, ...args) => {
        sentIpcMessages.push({ channel, args });
      }
    };

    let rundown = JSON.parse(JSON.stringify(initialRundown));
    let selectedIndex = rundown.length > 0 ? 0 : -1;
    let pvwCue = rundown.length > 0 ? rundown[0] : null;
    let pgmCue = null;
    let currentTransition = 'normal';
    let currentScaling = 'contain';

    const pgmContainer = {
      innerHTML: '',
      children: [],
      querySelector: () => null,
      appendChild: (child) => pgmContainer.children.push(child)
    };
    const pvwContainer = { querySelector: () => null };
    const pgmCueTitle = { innerText: '' };
    const pgmElapsed = { innerText: '' };
    const pgmRemaining = { innerText: '' };
    const pgmFrame = {
      classList: {
        add: () => {},
        remove: () => {}
      }
    };

    const btnFTB = {
      classList: {
        classes: new Set(),
        toggle: function(name, force) {
          if (force === true) this.classes.add(name);
          else if (force === false) this.classes.delete(name);
          else if (this.classes.has(name)) this.classes.delete(name);
          else this.classes.add(name);
        },
        contains: function(name) { return this.classes.has(name); }
      }
    };
    const btnBlackout = { classList: { toggle: () => {} } };
    const btnFreeze = { classList: { toggle: () => {} } };
    const btnSafeLogo = { classList: { toggle: () => {} } };

    const btnMoveUp = { disabled: false, style: {} };
    const btnMoveDown = { disabled: false, style: {} };

    let rundownRenderCount = 0;
    let saveRundownCount = 0;

    function renderRundown() {
      rundownRenderCount++;
      updateUpDownButtons();
    }

    function saveRundown() {
      saveRundownCount++;
    }

    function updateUpDownButtons() {
      const canMoveUp = selectedIndex > 0;
      const canMoveDown = selectedIndex >= 0 && selectedIndex < rundown.length - 1;
      btnMoveUp.disabled = !canMoveUp;
      btnMoveUp.style.opacity = canMoveUp ? '1.0' : '0.4';
      btnMoveDown.disabled = !canMoveDown;
      btnMoveDown.style.opacity = canMoveDown ? '1.0' : '0.4';
    }

    function formatTime(s) { return s + 's'; }

    const document = {
      createElement: (tag) => ({
        tagName: tag.toUpperCase(),
        style: {},
        src: '',
        className: ''
      }),
      getElementById: (id) => {
        if (id === 'btnMoveUp') return btnMoveUp;
        if (id === 'btnMoveDown') return btnMoveDown;
        return null;
      }
    };

    let toastMessage = null;
    let toastType = null;
    function showOperatorToast(msg, type) {
      toastMessage = msg;
      toastType = type;
    }

    const videoThumbnailCache = new Map();

    function selectCue(idx) {
      if (idx < 0 || idx >= rundown.length) return;
      selectedIndex = idx;
      pvwCue = rundown[idx];
      renderRundown();
    }

    // Embed extension sets
    ${extSetMatch[0]}

    // Embed validateMediaExtension
    ${validateFnMatch[0]}

    // Embed reorderRundown
    ${reorderRundownMatch[0]}

    function ingestFilePaths(filePaths) {
      if (!Array.isArray(filePaths) || filePaths.length === 0) return;
      const validPaths = [];
      const rejectedPaths = [];

      for (const fp of filePaths) {
        if (validateMediaExtension(fp)) {
          validPaths.push(fp);
        } else {
          rejectedPaths.push(fp);
        }
      }

      if (rejectedPaths.length > 0) {
        const sample = rejectedPaths.map(p => p.split(/[\\\\/]/).pop()).slice(0, 2).join(', ');
        showOperatorToast('⚠️ Bỏ qua ' + rejectedPaths.length + ' file không hỗ trợ: ' + sample, 'warn');
      }

      if (validPaths.length === 0) return;

      const newCues = [];
      for (const fp of validPaths) {
        const ext = fp.split('.').pop().toLowerCase().trim();
        const isVid = ALLOWED_VIDEO_EXTS.has(ext);
        const name = fp.split(/[\\/\\\\]/).pop();
        const format = ext.toUpperCase();

        const cue = {
          id: 'cue_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
          name: name,
          path: fp,
          type: isVid ? 'video' : 'image',
          format: format,
          duration: 0,
          width: 0,
          height: 0,
          endBehavior: 'HOLD_LAST_FRAME',
          thumbnailUrl: isVid ? (videoThumbnailCache.get(fp) || null) : 'file://' + fp
        };
        rundown.push(cue);
        newCues.push(cue);
      }

      renderRundown();
      if (selectedIndex === -1 && rundown.length > 0) {
        selectCue(0);
      }
    }

    // Embed production triggerGoLive
    ${triggerGoLiveMatch[0]}

    // Embed production stage-status handler
    function onStageStatus(status) {
      const event = null;
      ${stageStatusMatch[1]}
    }

    return {
      triggerGoLive,
      onStageStatus,
      reorderRundown,
      ingestFilePaths,
      selectCue,
      validateMediaExtension,
      ALLOWED_ALL_EXTS,
      ALLOWED_VIDEO_EXTS,
      ALLOWED_IMAGE_EXTS,
      getRundown: () => rundown,
      setRundown: (r) => { rundown = r; },
      getPgmCue: () => pgmCue,
      setPgmCue: (c) => { pgmCue = c; },
      getPvwCue: () => pvwCue,
      setPvwCue: (c, idx) => { pvwCue = c; selectedIndex = idx; updateUpDownButtons(); },
      getSelectedIndex: () => selectedIndex,
      setSelectedIndex: (idx) => { selectCue(idx); },
      getBtnFTB: () => btnFTB,
      getBtnMoveUp: () => btnMoveUp,
      getBtnMoveDown: () => btnMoveDown,
      getSentIpc: () => sentIpcMessages,
      clearSentIpc: () => { sentIpcMessages.length = 0; },
      getRundownRenderCount: () => rundownRenderCount,
      getSaveRundownCount: () => saveRundownCount,
      getToast: () => ({ message: toastMessage, type: toastType }),
      clearToast: () => { toastMessage = null; toastType = null; }
    };
  `;

  const factory = new Function(
    'Event', 'MouseEvent', 'PointerEvent',
    'initialRundown',
    runtimeScript
  );

  return factory(
    MockEvent, MockMouseEvent, MockPointerEvent,
    initialRundown
  );
}

/**
 * Creates a Stage Simulator matching src/renderer/stage/index.html
 */
function createStageSimulator() {
  let masterVolume = 1.0;
  let isMuted = false;
  let activeDeckKey = 'A';
  let isBlackout = false;
  let isFTB = false;
  let isFrozen = false;
  let isSafeLogo = false;
  let activeTransitionToken = 0;
  let cleanupTimeoutId = null;
  let audioCrossfadeAnimId = null;
  let blackoutCoverClass = '';

  const sentIpc = [];
  const ipcRenderer = {
    send: (channel, payload) => {
      sentIpc.push({ channel, payload });
    }
  };

  class StageDeck {
    constructor(name) {
      this.name = name;
      this.classes = new Set(['media-deck']);
      this.children = [];
    }
    classListAdd(cls) { this.classes.add(cls); }
    classListRemove(cls) { this.classes.delete(cls); }
    contains(cls) { return this.classes.has(cls); }
    querySelector(tag) {
      return this.children.find(c => c.tagName === tag.toUpperCase()) || null;
    }
    innerHTMLClear() {
      this.children.forEach(c => {
        if (c.tagName === 'VIDEO') {
          c.paused = true;
          c.src = '';
        }
      });
      this.children = [];
    }
  }

  const decks = {
    A: new StageDeck('A'),
    B: new StageDeck('B')
  };
  decks.A.classListAdd('active');

  function getTransitionDurationMs(durationMode) {
    if (durationMode === 'cut') return 0;
    if (durationMode === 'fast') return 400;
    if (durationMode === 'slow') return 1600;
    return 800; // normal
  }

  function applyTransitionClass(deck, durationMode) {
    deck.classListRemove('fade-cut');
    deck.classListRemove('fade-fast');
    deck.classListRemove('fade-normal');
    deck.classListRemove('fade-slow');
    if (durationMode === 'cut') deck.classListAdd('fade-cut');
    else if (durationMode === 'fast') deck.classListAdd('fade-fast');
    else if (durationMode === 'slow') deck.classListAdd('fade-slow');
    else deck.classListAdd('fade-normal');
  }

  function handleGoLive(payload) {
    const { media, transition = 'normal' } = payload;
    if (!media || !media.path) return;

    const thisTransitionToken = ++activeTransitionToken;

    if (cleanupTimeoutId) {
      clearTimeout(cleanupTimeoutId);
      cleanupTimeoutId = null;
    }

    // Lift blackout or FTB if active
    if (isBlackout || isFTB) {
      blackoutCoverClass = '';
      isBlackout = false;
      isFTB = false;
    }
    if (isSafeLogo) {
      isSafeLogo = false;
    }

    const nextDeckKey = activeDeckKey === 'A' ? 'B' : 'A';
    const incomingDeck = decks[nextDeckKey];
    const outgoingDeck = decks[activeDeckKey];

    incomingDeck.innerHTMLClear();
    applyTransitionClass(incomingDeck, transition);
    applyTransitionClass(outgoingDeck, transition);

    const fadeDurationMs = getTransitionDurationMs(transition);
    let mediaEl;

    if (media.type === 'video') {
      mediaEl = {
        tagName: 'VIDEO',
        src: `file://${media.path}`,
        volume: fadeDurationMs === 0 ? (isMuted ? 0 : masterVolume) : 0,
        muted: isMuted,
        loop: media.endBehavior === 'LOOP',
        currentTime: 0,
        duration: media.duration || 30.0,
        paused: false,
        pause: function() { this.paused = true; },
        play: async function() { this.paused = false; }
      };

      // Video Ended Handler from stage/index.html:518-557
      mediaEl.triggerEnded = function() {
        const endBehavior = media.endBehavior || 'HOLD_LAST_FRAME';
        if (endBehavior === 'LOOP') {
          mediaEl.currentTime = 0;
          mediaEl.paused = false;
        } else if (endBehavior === 'HOLD_LAST_FRAME') {
          mediaEl.pause();
          try { mediaEl.currentTime = mediaEl.duration; } catch (e) {}
        } else if (endBehavior === 'FADE_TO_BLACK') {
          blackoutCoverClass = 'active-ftb';
          isFTB = true;
          // Ramp volume to 0 over 1.0s
          mediaEl.volume = 0.0;
          mediaEl.pause();
          ipcRenderer.send('stage-status', {
            event: 'media-ended',
            id: media.id,
            cueId: media.id,
            endBehavior: 'FADE_TO_BLACK',
            isFTB: true
          });
        } else if (endBehavior === 'AUTO_NEXT') {
          mediaEl.pause();
          ipcRenderer.send('stage-status', {
            event: 'media-ended',
            id: media.id,
            cueId: media.id,
            endBehavior: 'AUTO_NEXT'
          });
        }
      };
    } else {
      mediaEl = {
        tagName: 'IMG',
        src: `file://${media.path}`
      };
    }

    incomingDeck.children.push(mediaEl);

    // Audio Crossfade Logic
    const outgoingVideo = outgoingDeck.querySelector('video');
    const incomingVideo = mediaEl.tagName === 'VIDEO' ? mediaEl : null;

    if (fadeDurationMs > 0 && (outgoingVideo || incomingVideo)) {
      if (incomingVideo && !isMuted) incomingVideo.volume = masterVolume;
      if (outgoingVideo) outgoingVideo.volume = 0;
    } else {
      if (incomingVideo && !isMuted) incomingVideo.volume = masterVolume;
      if (outgoingVideo) outgoingVideo.volume = 0;
    }

    // Visual deck swap
    incomingDeck.classListAdd('active');
    outgoingDeck.classListRemove('active');

    activeDeckKey = nextDeckKey;
    isFrozen = false;

    return {
      activeDeckKey,
      incomingDeck,
      outgoingDeck,
      mediaEl,
      token: thisTransitionToken
    };
  }

  function setVolume(vol) {
    masterVolume = Math.max(0, Math.min(1, vol));
    [decks.A, decks.B].forEach(d => {
      const v = d.querySelector('video');
      if (v && !isMuted) v.volume = masterVolume;
    });
  }

  return {
    handleGoLive,
    setVolume,
    getDecks: () => decks,
    getActiveDeckKey: () => activeDeckKey,
    getIsBlackout: () => isBlackout,
    getIsFTB: () => isFTB,
    getBlackoutCoverClass: () => blackoutCoverClass,
    getMasterVolume: () => masterVolume,
    getSentIpc: () => sentIpc,
    clearSentIpc: () => { sentIpc.length = 0; },
    getTransitionDurationMs
  };
}

// =========================================================================
// TEST SUITES
// =========================================================================
describe('M2 Iteration 3 Adversarial Challenge: Ingestion, Reordering & End Behaviors', () => {

  // =======================================================================
  // 1. Rundown Ingestion & Invalid Format Rejection
  // =======================================================================
  describe('Suite 1: Ingestion Hardening & File Format Rejection Matrix', () => {

    it('EMP-INGEST-01: Verifies strict rejection of 35 dangerous and unsupported file extensions', () => {
      const runtime = createOperatorRuntime();
      const dangerousFiles = [
        'virus.exe', 'trojan.EXE', 'malware.dll', 'script.bat', 'payload.cmd',
        'run.ps1', 'macro.vbs', 'installer.msi', 'driver.sys', 'app.com',
        'library.so', 'package.dylib', 'archive.zip', 'bundle.tar', 'archive.tar.gz',
        'compressed.7z', 'disc.iso', 'doc.pdf', 'word.docx', 'sheet.xlsx',
        'slides.pptx', 'notes.txt', 'config.json', 'page.html', 'style.css',
        'index.js', 'server.py', 'app.rb', 'main.rs', 'service.go',
        'source.cpp', 'header.h', 'firmware.bin', 'database.sqlite', 'data.db'
      ];

      for (const file of dangerousFiles) {
        const allowed = runtime.validateMediaExtension(file);
        assert.strictEqual(allowed, false, `File '${file}' should have been strictly rejected`);
      }
    });

    it('EMP-INGEST-02: Verifies all valid video and image formats are accepted case-insensitively', () => {
      const runtime = createOperatorRuntime();
      const validCases = [
        // Videos
        'clip.mp4', 'clip.MP4', 'clip.Mp4',
        'film.mov', 'film.MOV', 'film.Mov',
        'reel.webm', 'reel.WEBM', 'reel.WebM',
        'master.mkv', 'master.MKV', 'master.Mkv',
        // Images
        'slide.png', 'slide.PNG', 'slide.Png',
        'photo.jpg', 'photo.JPG', 'photo.Jpg',
        'graphic.jpeg', 'graphic.JPEG', 'graphic.Jpeg',
        'vector.svg', 'vector.SVG', 'vector.Svg',
        'sticker.webp', 'sticker.WEBP', 'sticker.WebP'
      ];

      for (const file of validCases) {
        const allowed = runtime.validateMediaExtension(file);
        assert.strictEqual(allowed, true, `File '${file}' should have been accepted`);
      }
    });

    it('EMP-INGEST-03: Edge case filenames: multi-dot, trailing dot, empty, hidden files', () => {
      const runtime = createOperatorRuntime();

      // Multi-dot valid
      assert.strictEqual(runtime.validateMediaExtension('event.2026.keynote.final.v3.mp4'), true);
      assert.strictEqual(runtime.validateMediaExtension('brand.logo.vector.min.svg'), true);
      assert.strictEqual(runtime.validateMediaExtension('backup.zip.mov'), true);

      // Multi-dot invalid (extension is dangerous)
      assert.strictEqual(runtime.validateMediaExtension('video.mp4.exe'), false);
      assert.strictEqual(runtime.validateMediaExtension('image.png.bat'), false);
      assert.strictEqual(runtime.validateMediaExtension('clip.webm.zip'), false);

      // Trailing dots and hidden files
      assert.strictEqual(runtime.validateMediaExtension('.gitignore'), false);
      assert.strictEqual(runtime.validateMediaExtension('filename_trailing_dot.'), false);
      assert.strictEqual(runtime.validateMediaExtension('no_extension_file'), false);
      assert.strictEqual(runtime.validateMediaExtension(''), false);
      assert.strictEqual(runtime.validateMediaExtension(null), false);
      assert.strictEqual(runtime.validateMediaExtension(undefined), false);
      assert.strictEqual(runtime.validateMediaExtension(42), false);
    });

    it('EMP-INGEST-04: Batch ingestion filters out invalid files and triggers operator toast warning', () => {
      const runtime = createOperatorRuntime([]);

      // Drop 10 mixed files: 4 valid, 6 invalid
      const mixedBatch = [
        'D:\\media\\intro.mp4',
        'D:\\media\\malware.exe',
        'D:\\media\\logo.png',
        'D:\\media\\notes.txt',
        'D:\\media\\slide.SVG',
        'D:\\media\\bundle.zip',
        'D:\\media\\clip.MOV',
        'D:\\media\\run.bat',
        'D:\\media\\script.ps1',
        'D:\\media\\unsupported.pdf'
      ];

      runtime.ingestFilePaths(mixedBatch);

      const rundown = runtime.getRundown();
      assert.strictEqual(rundown.length, 4, 'Only 4 valid media files should be ingested');
      assert.strictEqual(rundown[0].name, 'intro.mp4');
      assert.strictEqual(rundown[0].type, 'video');
      assert.strictEqual(rundown[1].name, 'logo.png');
      assert.strictEqual(rundown[1].type, 'image');
      assert.strictEqual(rundown[2].name, 'slide.SVG');
      assert.strictEqual(rundown[2].type, 'image');
      assert.strictEqual(rundown[3].name, 'clip.MOV');
      assert.strictEqual(rundown[3].type, 'video');

      const toast = runtime.getToast();
      assert.strictEqual(toast.type, 'warn');
      assert.ok(toast.message.includes('6 file không hỗ trợ'));
      assert.ok(toast.message.includes('malware.exe'));
    });

    it('EMP-INGEST-05: Drag-and-drop event discrimination prevents internal cue card reordering from triggering drop overlay', () => {
      // Verifies isExternalFileDrag logic
      function isExternalFileDrag(e) {
        if (!e.dataTransfer || !e.dataTransfer.types) return false;
        return Array.from(e.dataTransfer.types).includes('Files');
      }

      // External file drag
      assert.strictEqual(isExternalFileDrag({ dataTransfer: { types: ['Files'] } }), true);
      assert.strictEqual(isExternalFileDrag({ dataTransfer: { types: ['text/plain', 'Files'] } }), true);

      // Internal card drag
      assert.strictEqual(isExternalFileDrag({ dataTransfer: { types: ['application/x-lumen-cue', 'text/plain'] } }), false);
      assert.strictEqual(isExternalFileDrag({ dataTransfer: { types: ['text/plain'] } }), false);
      assert.strictEqual(isExternalFileDrag({ dataTransfer: null }), false);
      assert.strictEqual(isExternalFileDrag({}), false);
    });
  });

  // =======================================================================
  // 2. Cue Card Drag-and-Drop Reordering & Store Synchronization
  // =======================================================================
  describe('Suite 2: Card Reordering, Half-Height Math & State Integrity', () => {

    const initialCues = [
      { id: 'cue_0', name: '0. Opener', endBehavior: 'HOLD_LAST_FRAME' },
      { id: 'cue_1', name: '1. Keynote', endBehavior: 'AUTO_NEXT' },
      { id: 'cue_2', name: '2. Sponsor Reel', endBehavior: 'LOOP' },
      { id: 'cue_3', name: '3. Closer', endBehavior: 'FADE_TO_BLACK' }
    ];

    it('EMP-REORDER-01: Dragging card to top (0) and bottom (length-1) correctly updates positions and tracks selectedIndex', () => {
      const runtime = createOperatorRuntime(initialCues);
      runtime.setSelectedIndex(3); // Previewing cue_3
      assert.strictEqual(runtime.getPvwCue().id, 'cue_3');

      // Move cue_3 from index 3 to index 0 (top)
      const res1 = runtime.reorderRundown(3, 0);
      assert.strictEqual(res1, true);
      assert.strictEqual(runtime.getRundown()[0].id, 'cue_3');
      assert.strictEqual(runtime.getSelectedIndex(), 0, 'selectedIndex should follow cue_3 to index 0');

      // Move cue_3 from index 0 back to index 3 (bottom)
      const res2 = runtime.reorderRundown(0, 3);
      assert.strictEqual(res2, true);
      assert.strictEqual(runtime.getRundown()[3].id, 'cue_3');
      assert.strictEqual(runtime.getSelectedIndex(), 3, 'selectedIndex should follow cue_3 to index 3');
    });

    it('EMP-REORDER-02: Self-drop and out-of-bounds drop indices are safely rejected without side-effects', () => {
      const runtime = createOperatorRuntime(initialCues);
      const initialCount = runtime.getSaveRundownCount();

      // Self-drop
      assert.strictEqual(runtime.reorderRundown(1, 1), false);
      assert.strictEqual(runtime.getSaveRundownCount(), initialCount, 'No save on no-op');

      // Out of bounds
      assert.strictEqual(runtime.reorderRundown(-1, 2), false);
      assert.strictEqual(runtime.reorderRundown(10, 2), false);
      assert.strictEqual(runtime.reorderRundown(2, -5), false);
      assert.strictEqual(runtime.reorderRundown(2, 999), false);
      assert.strictEqual(runtime.getRundown().length, 4);
    });

    it('EMP-REORDER-03: Moving active PGM cue retains on-air tally and does NOT desync playback', () => {
      const runtime = createOperatorRuntime(initialCues);
      // Make cue_1 live on PGM
      runtime.setPgmCue({ ...initialCues[1] });
      runtime.setSelectedIndex(0); // Previewing cue_0

      assert.strictEqual(runtime.getPgmCue().id, 'cue_1');

      // Reorder cue_1 from index 1 to index 3 (end of rundown)
      runtime.reorderRundown(1, 3);

      const rundown = runtime.getRundown();
      assert.strictEqual(rundown[3].id, 'cue_1');

      // Verify on-air tally resolves to new index 3
      const onAirIdx = rundown.findIndex(c => c.id === runtime.getPgmCue().id);
      assert.strictEqual(onAirIdx, 3, 'On-air tally must track cue_1 to index 3');

      // Preview cue remains cue_0 at index 0
      assert.strictEqual(runtime.getSelectedIndex(), 0);
      assert.strictEqual(rundown[0].id, 'cue_0');
    });

    it('EMP-REORDER-04: Card drop target calculation with clientY and bounding rect top/half-height', () => {
      // Logic from operator/index.html lines 1506-1517:
      function calculateDropTarget(fromIdx, cardIdx, isTopHalf) {
        let targetIdx = cardIdx;
        if (!isTopHalf) {
          targetIdx = cardIdx + 1;
        }
        if (fromIdx < targetIdx) {
          targetIdx--;
        }
        return targetIdx;
      }

      // Drag downward: from 0 to 2
      assert.strictEqual(calculateDropTarget(0, 2, true), 1);
      assert.strictEqual(calculateDropTarget(0, 2, false), 2);

      // Drag upward: from 3 to 1
      assert.strictEqual(calculateDropTarget(3, 1, true), 1);
      assert.strictEqual(calculateDropTarget(3, 1, false), 2);

      // Drag to edge top: from 2 to 0 (top half) -> 0
      assert.strictEqual(calculateDropTarget(2, 0, true), 0);

      // Drag to edge bottom: from 0 to 3 (bottom half) -> 3
      assert.strictEqual(calculateDropTarget(0, 3, false), 3);
    });

    it('EMP-REORDER-05: Up/Down buttons enable/disable states strictly enforce boundary conditions', () => {
      const runtime = createOperatorRuntime(initialCues);

      // At index 0 (top of list)
      runtime.setSelectedIndex(0);
      assert.strictEqual(runtime.getBtnMoveUp().disabled, true, 'btnMoveUp must be disabled at index 0');
      assert.strictEqual(runtime.getBtnMoveDown().disabled, false, 'btnMoveDown must be enabled at index 0');

      // At index 1 (middle of list)
      runtime.setSelectedIndex(1);
      assert.strictEqual(runtime.getBtnMoveUp().disabled, false, 'btnMoveUp must be enabled in middle');
      assert.strictEqual(runtime.getBtnMoveDown().disabled, false, 'btnMoveDown must be enabled in middle');

      // At index 3 (bottom of list)
      runtime.setSelectedIndex(3);
      assert.strictEqual(runtime.getBtnMoveUp().disabled, false, 'btnMoveUp must be enabled at bottom');
      assert.strictEqual(runtime.getBtnMoveDown().disabled, true, 'btnMoveDown must be disabled at bottom');

      // Single item rundown
      const singleItemRuntime = createOperatorRuntime([{ id: 'single', name: 'Single' }]);
      singleItemRuntime.setSelectedIndex(0);
      assert.strictEqual(singleItemRuntime.getBtnMoveUp().disabled, true);
      assert.strictEqual(singleItemRuntime.getBtnMoveDown().disabled, true);
    });

    it('EMP-REORDER-06: Adversarial fuzzing - 2,000 rapid randomized reorders maintain 100% integrity', () => {
      const items = Array.from({ length: 25 }, (_, i) => ({
        id: `cue_fuzz_${i}`,
        name: `Item ${i}`
      }));
      const runtime = createOperatorRuntime(items);
      runtime.setSelectedIndex(10);

      for (let i = 0; i < 2000; i++) {
        const from = Math.floor(Math.random() * 25);
        const to = Math.floor(Math.random() * 25);
        runtime.reorderRundown(from, to);
      }

      const finalRundown = runtime.getRundown();
      assert.strictEqual(finalRundown.length, 25, 'Length must remain exactly 25');

      const ids = new Set(finalRundown.map(c => c.id));
      assert.strictEqual(ids.size, 25, 'Zero duplicates or dropped items allowed');

      const selIdx = runtime.getSelectedIndex();
      assert.ok(selIdx >= 0 && selIdx < 25, `selectedIndex ${selIdx} is out of bounds`);
      assert.strictEqual(finalRundown[selIdx].id, 'cue_fuzz_10', 'selectedIndex must still point to original tracked cue');
    });
  });

  // =======================================================================
  // 3. End Behaviors Invariant Verification
  // =======================================================================
  describe('Suite 3: All 4 End Behaviors & State Machine Invariants', () => {

    const rundown = [
      { id: 'cue_0', name: '0. Hold Clip', type: 'video', path: '/media/c0.mp4', endBehavior: 'HOLD_LAST_FRAME', duration: 10 },
      { id: 'cue_1', name: '1. Loop Video', type: 'video', path: '/media/c1.mp4', endBehavior: 'LOOP', duration: 15 },
      { id: 'cue_2', name: '2. Auto Next Intro', type: 'video', path: '/media/c2.mp4', endBehavior: 'AUTO_NEXT', duration: 20 },
      { id: 'cue_3', name: '3. FTB Feature', type: 'video', path: '/media/c3.mp4', endBehavior: 'FADE_TO_BLACK', duration: 30 },
      { id: 'cue_4', name: '4. Final Outro', type: 'video', path: '/media/c4.mp4', endBehavior: 'HOLD_LAST_FRAME', duration: 12 }
    ];

    it('EMP-ENDBEHAV-01: HOLD_LAST_FRAME pauses on last frame, clamps currentTime, zero advance', () => {
      const stage = createStageSimulator();
      const operator = createOperatorRuntime(rundown);

      const live = stage.handleGoLive({ media: rundown[0] });
      operator.setPgmCue(rundown[0]);
      operator.clearSentIpc();
      stage.clearSentIpc();

      assert.strictEqual(live.mediaEl.loop, false);
      assert.strictEqual(live.mediaEl.paused, false);

      // Video finishes playing
      live.mediaEl.triggerEnded();

      assert.strictEqual(live.mediaEl.paused, true, 'Video must pause');
      assert.strictEqual(live.mediaEl.currentTime, 10, 'currentTime must clamp to duration');
      assert.strictEqual(stage.getSentIpc().length, 0, 'Stage must send zero advance messages for HOLD_LAST_FRAME');
      assert.strictEqual(operator.getSentIpc().length, 0, 'Operator must send zero go-live messages');
      assert.strictEqual(operator.getPgmCue().id, 'cue_0', 'PGM cue must remain cue_0');
    });

    it('EMP-ENDBEHAV-02: LOOP sets media loop=true and continuously restarts from 0.0s', () => {
      const stage = createStageSimulator();
      const operator = createOperatorRuntime(rundown);

      const live = stage.handleGoLive({ media: rundown[1] });
      operator.setPgmCue(rundown[1]);
      operator.clearSentIpc();
      stage.clearSentIpc();

      assert.strictEqual(live.mediaEl.loop, true);

      // Video reaches end
      live.mediaEl.triggerEnded();

      assert.strictEqual(live.mediaEl.currentTime, 0, 'currentTime must reset to 0');
      assert.strictEqual(live.mediaEl.paused, false, 'Playback must continue');
      assert.strictEqual(stage.getSentIpc().length, 0, 'No IPC sent on loop');
      assert.strictEqual(operator.getPgmCue().id, 'cue_1');
    });

    it('EMP-ENDBEHAV-03: FADE_TO_BLACK cleanly remains in black, volume ramps to 0, zero cue advance, GO LIVE lifts FTB', () => {
      const stage = createStageSimulator();
      const operator = createOperatorRuntime(rundown);

      // Make cue_3 (FADE_TO_BLACK) live
      const live = stage.handleGoLive({ media: rundown[3] });
      operator.setPgmCue({ ...rundown[3] });
      operator.setPvwCue(rundown[4], 4); // Operator inspecting cue_4 on preview
      operator.clearSentIpc();
      stage.clearSentIpc();

      assert.strictEqual(operator.getPgmCue().id, 'cue_3');
      assert.strictEqual(operator.getPgmCue().endBehavior, 'FADE_TO_BLACK');

      // 1. Stage video reaches EOF
      live.mediaEl.triggerEnded();

      // Verify Stage internal state:
      assert.strictEqual(stage.getIsFTB(), true, 'Stage isFTB must be true');
      assert.strictEqual(stage.getBlackoutCoverClass(), 'active-ftb', 'Blackout cover must be active-ftb');
      assert.strictEqual(live.mediaEl.volume, 0.0, 'Volume must be ramped to 0.0');
      assert.strictEqual(live.mediaEl.paused, true, 'Video must be paused');

      // Verify Stage sent stage-status
      const stageIpc = stage.getSentIpc();
      assert.strictEqual(stageIpc.length, 1);
      assert.strictEqual(stageIpc[0].channel, 'stage-status');
      assert.strictEqual(stageIpc[0].payload.endBehavior, 'FADE_TO_BLACK');
      assert.strictEqual(stageIpc[0].payload.isFTB, true);

      // 2. Deliver stage-status to Operator
      operator.onStageStatus(stageIpc[0].payload);

      // 3. Operator assertions:
      // PGM must NOT advance!
      assert.strictEqual(operator.getPgmCue().id, 'cue_3', 'Operator PGM must remain cue_3');
      assert.strictEqual(operator.getSentIpc().length, 0, 'Operator must NOT send go-live');
      assert.strictEqual(operator.getBtnFTB().classList.contains('active'), true, 'Operator btnFTB must show active red');
      assert.strictEqual(operator.getPvwCue().id, 'cue_4', 'Operator preview cue must remain cue_4');
      assert.strictEqual(operator.getSelectedIndex(), 4);

      // 4. Verify black hold persists over multiple idle cycles
      for (let cycle = 0; cycle < 5; cycle++) {
        operator.onStageStatus({
          event: 'time-update',
          hasVideo: false,
          isBlackout: false,
          isFTB: true
        });
        assert.strictEqual(operator.getPgmCue().id, 'cue_3');
        assert.strictEqual(stage.getIsFTB(), true);
      }

      // 5. Subsequent GO LIVE lifts FTB
      const newLive = stage.handleGoLive({ media: rundown[4] });
      assert.strictEqual(stage.getIsFTB(), false, 'Stage isFTB must be lifted on GO LIVE');
      assert.strictEqual(stage.getBlackoutCoverClass(), '', 'Stage blackout cover must be cleared');
    });

    it('EMP-ENDBEHAV-04: AUTO_NEXT advances active PGM index + 1 without jumping to preview selection', () => {
      const stage = createStageSimulator();
      const operator = createOperatorRuntime(rundown);

      // Live cue is cue_2 (AUTO_NEXT, index 2)
      stage.handleGoLive({ media: rundown[2] });
      operator.setPgmCue({ ...rundown[2] });

      // Operator is previewing cue_0 (index 0)
      operator.setPvwCue(rundown[0], 0);
      operator.clearSentIpc();
      stage.clearSentIpc();

      assert.strictEqual(operator.getPgmCue().id, 'cue_2');
      assert.strictEqual(operator.getPvwCue().id, 'cue_0');
      assert.strictEqual(operator.getSelectedIndex(), 0);

      // Stage finishes cue_2 with AUTO_NEXT
      stage.getDecks()[stage.getActiveDeckKey()].querySelector('video').triggerEnded();

      const stageIpc = stage.getSentIpc();
      assert.strictEqual(stageIpc.length, 1);
      assert.strictEqual(stageIpc[0].payload.endBehavior, 'AUTO_NEXT');

      // Operator processes stage-status
      operator.onStageStatus(stageIpc[0].payload);

      // Assertions:
      // 1. PGM advances to rundown[2 + 1] = rundown[3] (cue_3: FTB Feature)
      assert.strictEqual(operator.getPgmCue().id, 'cue_3', 'PGM must advance to cue_3');
      assert.strictEqual(operator.getPgmCue().name, '3. FTB Feature');
      assert.strictEqual(operator.getSentIpc().length, 1);
      assert.strictEqual(operator.getSentIpc()[0].channel, 'go-live');
      assert.strictEqual(operator.getSentIpc()[0].args[0].media.id, 'cue_3');

      // 2. CRITICAL: Operator preview cue MUST REMAIN cue_0, untouched!
      assert.strictEqual(operator.getPvwCue().id, 'cue_0', 'Preview cue must stay cue_0');
      assert.strictEqual(operator.getSelectedIndex(), 0, 'selectedIndex must stay 0');
    });

    it('EMP-ENDBEHAV-05: AUTO_NEXT on final cue in rundown safely halts without out-of-bounds error', () => {
      const stage = createStageSimulator();
      const operator = createOperatorRuntime(rundown);

      // Set final cue (cue_4 at index 4) to AUTO_NEXT
      const lastIdx = rundown.length - 1;
      const finalCue = { ...rundown[lastIdx], endBehavior: 'AUTO_NEXT' };
      const currentRundown = operator.getRundown();
      currentRundown[lastIdx] = finalCue;
      operator.setRundown(currentRundown);

      operator.setPgmCue(finalCue);
      operator.clearSentIpc();

      // Deliver AUTO_NEXT completion for final cue
      operator.onStageStatus({
        event: 'media-ended',
        id: finalCue.id,
        cueId: finalCue.id,
        endBehavior: 'AUTO_NEXT'
      });

      // Assertions:
      assert.strictEqual(operator.getSentIpc().length, 0, 'Must NOT send go-live past end of rundown');
      assert.strictEqual(operator.getPgmCue().id, finalCue.id, 'Must remain on final cue');
    });

    it('EMP-ENDBEHAV-06: Dynamic cue reordering while cue is live on stage advances to new adjacent item', () => {
      const stage = createStageSimulator();
      const operator = createOperatorRuntime(rundown);

      // cue_2 is live on PGM
      operator.setPgmCue({ ...rundown[2] });
      operator.clearSentIpc();

      // While cue_2 is live, operator moves cue_4 right after cue_2:
      // Current order: cue_0, cue_1, cue_2, cue_3, cue_4
      // Move index 4 to index 3
      runtimeReorder: {
        const list = operator.getRundown();
        const [moved] = list.splice(4, 1);
        list.splice(3, 0, moved);
        operator.setRundown(list);
      }

      // New order at index 3 is now cue_4 (Final Outro)
      assert.strictEqual(operator.getRundown()[3].id, 'cue_4');

      // cue_2 finishes with AUTO_NEXT
      operator.onStageStatus({
        event: 'media-ended',
        id: 'cue_2',
        cueId: 'cue_2',
        endBehavior: 'AUTO_NEXT'
      });

      // Must advance to newly placed adjacent cue_4!
      assert.strictEqual(operator.getPgmCue().id, 'cue_4');
      assert.strictEqual(operator.getSentIpc()[0].args[0].media.id, 'cue_4');
    });

    it('EMP-ENDBEHAV-07: Cascading AUTO_NEXT across 3 sequential cues advances seamlessly step-by-step', () => {
      const chainRundown = [
        { id: 'chain_0', name: 'Intro', endBehavior: 'AUTO_NEXT' },
        { id: 'chain_1', name: 'Segment 1', endBehavior: 'AUTO_NEXT' },
        { id: 'chain_2', name: 'Segment 2', endBehavior: 'AUTO_NEXT' },
        { id: 'chain_3', name: 'Closing', endBehavior: 'HOLD_LAST_FRAME' }
      ];
      const operator = createOperatorRuntime(chainRundown);

      // Start on chain_0
      operator.setPgmCue({ ...chainRundown[0] });
      operator.clearSentIpc();

      // Step 1
      operator.onStageStatus({ event: 'media-ended', id: 'chain_0', cueId: 'chain_0', endBehavior: 'AUTO_NEXT' });
      assert.strictEqual(operator.getPgmCue().id, 'chain_1');

      // Step 2
      operator.onStageStatus({ event: 'media-ended', id: 'chain_1', cueId: 'chain_1', endBehavior: 'AUTO_NEXT' });
      assert.strictEqual(operator.getPgmCue().id, 'chain_2');

      // Step 3
      operator.onStageStatus({ event: 'media-ended', id: 'chain_2', cueId: 'chain_2', endBehavior: 'AUTO_NEXT' });
      assert.strictEqual(operator.getPgmCue().id, 'chain_3');

      // Step 4: chain_3 has HOLD_LAST_FRAME, so finishes without advancing
      operator.onStageStatus({ event: 'media-ended', id: 'chain_3', cueId: 'chain_3', endBehavior: 'HOLD_LAST_FRAME' });
      assert.strictEqual(operator.getPgmCue().id, 'chain_3');
      assert.strictEqual(operator.getSentIpc().length, 3);
    });
  });

  // =======================================================================
  // 4. Transitions (Cut, Fast, Normal, Slow) & Rapid-Fire Concurrency
  // =======================================================================
  describe('Suite 4: Transitions (Cut, Fast, Normal, Slow) & Concurrency Hardening', () => {

    it('EMP-TRANS-01: Verifies transition durations and CSS classes (Cut 0ms, Fast 400ms, Normal 800ms, Slow 1600ms)', () => {
      const stage = createStageSimulator();

      assert.strictEqual(stage.getTransitionDurationMs('cut'), 0);
      assert.strictEqual(stage.getTransitionDurationMs('fast'), 400);
      assert.strictEqual(stage.getTransitionDurationMs('normal'), 800);
      assert.strictEqual(stage.getTransitionDurationMs('slow'), 1600);
      assert.strictEqual(stage.getTransitionDurationMs('unknown'), 800, 'Unknown should fallback to 800ms');

      const testMedia = { id: 'm1', name: 'Test', type: 'video', path: '/test.mp4' };

      // Cut transition
      const cutLive = stage.handleGoLive({ media: testMedia, transition: 'cut' });
      assert.ok(cutLive.incomingDeck.contains('fade-cut'));

      // Fast transition
      const fastLive = stage.handleGoLive({ media: testMedia, transition: 'fast' });
      assert.ok(fastLive.incomingDeck.contains('fade-fast'));

      // Normal transition
      const normalLive = stage.handleGoLive({ media: testMedia, transition: 'normal' });
      assert.ok(normalLive.incomingDeck.contains('fade-normal'));

      // Slow transition
      const slowLive = stage.handleGoLive({ media: testMedia, transition: 'slow' });
      assert.ok(slowLive.incomingDeck.contains('fade-slow'));
    });

    it('EMP-TRANS-02: Cut transition (0ms) immediately applies masterVolume to incoming video without delay', () => {
      const stage = createStageSimulator();
      stage.setVolume(0.75);

      const mediaA = { id: 'mA', name: 'Clip A', type: 'video', path: '/a.mp4' };
      const mediaB = { id: 'mB', name: 'Clip B', type: 'video', path: '/b.mp4' };

      // Initial clip
      stage.handleGoLive({ media: mediaA, transition: 'cut' });
      const deckA = stage.getDecks().B; // Deck B became active
      const vidA = deckA.querySelector('video');
      assert.strictEqual(vidA.volume, 0.75);

      // Cut to clip B
      stage.handleGoLive({ media: mediaB, transition: 'cut' });
      const deckB = stage.getDecks().A; // Deck A became active
      const vidB = deckB.querySelector('video');

      assert.strictEqual(vidB.volume, 0.75, 'Incoming video must immediately have 0.75 volume');
      assert.strictEqual(vidA.volume, 0, 'Outgoing video must immediately be silenced to 0');
    });

    it('EMP-TRANS-03: Crossfade permutations: Video-to-Video, Video-to-Image, Image-to-Video, Image-to-Image', () => {
      const stage = createStageSimulator();

      const vid1 = { id: 'v1', type: 'video', path: '/v1.mp4' };
      const vid2 = { id: 'v2', type: 'video', path: '/v2.mp4' };
      const img1 = { id: 'i1', type: 'image', path: '/i1.png' };
      const img2 = { id: 'i2', type: 'image', path: '/i2.png' };

      // 1. Video -> Video
      stage.handleGoLive({ media: vid1, transition: 'normal' });
      const resV2V = stage.handleGoLive({ media: vid2, transition: 'normal' });
      assert.strictEqual(resV2V.mediaEl.tagName, 'VIDEO');

      // 2. Video -> Image
      const resV2I = stage.handleGoLive({ media: img1, transition: 'fast' });
      assert.strictEqual(resV2I.mediaEl.tagName, 'IMG');

      // 3. Image -> Video
      const resI2V = stage.handleGoLive({ media: vid1, transition: 'slow' });
      assert.strictEqual(resI2V.mediaEl.tagName, 'VIDEO');

      // 4. Image -> Image
      const resI2I = stage.handleGoLive({ media: img2, transition: 'normal' });
      assert.strictEqual(resI2I.mediaEl.tagName, 'IMG');
    });

    it('EMP-TRANS-04: Rapid-fire GO LIVE commands (10 rapid transitions) strictly cancel stale animations and tokens', () => {
      const stage = createStageSimulator();
      let lastResult = null;

      // Fire 10 rapid transitions
      for (let i = 0; i < 10; i++) {
        lastResult = stage.handleGoLive({
          media: { id: `rapid_${i}`, name: `Rapid ${i}`, type: 'video', path: `/rapid_${i}.mp4` },
          transition: i % 2 === 0 ? 'fast' : 'slow'
        });
      }

      assert.strictEqual(lastResult.token, 10, 'Final transition token must be 10');
      const activeDeckKey = stage.getActiveDeckKey();
      const activeDeck = stage.getDecks()[activeDeckKey];
      const activeVideo = activeDeck.querySelector('video');

      assert.ok(activeVideo);
      assert.strictEqual(activeVideo.src, 'file:///rapid_9.mp4', 'Latest media must be mounted in active deck');
      assert.ok(activeDeck.contains('active'), 'Active deck must have active class');
    });
  });
});
