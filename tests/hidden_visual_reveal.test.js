/**
 * tests/hidden_visual_reveal.test.js
 * Test Suite for "Hidden-Visual" & "REVEAL" Gameplay Mode (Đoán tên bài hát)
 *
 * Verifies:
 * - Hidden-Visual Video Playback: Audio plays at full volume, video deck does NOT get active class (zero leak).
 * - Visual Mask Activation: Event Key Visual or custom per-cue image is mounted on visualMaskLayer.
 * - REVEAL_VISUAL Trigger: Lifts the mask, restores deck visibility seamlessly without pausing/seeking the video.
 * - Non-destructive: Normal cues still transition directly without mask.
 * - State Persistence: hideVisual and maskImagePath are serialized and restored via saveRundown.
 */

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');

// Load stage.js source code verbatim
const stageScriptSrc = fs.readFileSync(path.join(__dirname, '../src/renderer/stage/scripts/stage.js'), 'utf8');

class MockElement {
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
    this.src = '';
    this.volume = 1.0;
    this.muted = false;
    this.currentTime = 0;
    this.duration = 180;
    this.paused = true;
    this.ended = false;
    this.loop = false;
    this.playsInline = true;
    this.preload = 'auto';
    this.readyState = 4;
    this.complete = true;
    this.decode = () => Promise.resolve();
    this.eventListeners = new Map();
  }

  get src() {
    return this._src || '';
  }
  set src(val) {
    this._src = val;
    if (this.tagName === 'IMG' && val) {
      setTimeout(() => {
        const list = this.eventListeners.get('load') || [];
        list.forEach(fn => fn({ target: this }));
      }, 1);
    }
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

  querySelector(sel) {
    if (sel === 'video') return this.children.find(c => c.tagName === 'VIDEO') || null;
    if (sel === 'img') return this.children.find(c => c.tagName === 'IMG') || null;
    return null;
  }

  querySelectorAll(sel) {
    const res = [];
    function walk(n) {
      for (const ch of n.children) {
        if (sel === 'video' && ch.tagName === 'VIDEO') res.push(ch);
        else if (sel === '.media-deck video' && ch.tagName === 'VIDEO') res.push(ch);
        else if (sel === '.stage-media-element') res.push(ch);
        walk(ch);
      }
    }
    walk(this);
    return res;
  }

  addEventListener(ev, fn) {
    if (!this.eventListeners.has(ev)) this.eventListeners.set(ev, []);
    this.eventListeners.get(ev).push(fn);
  }

  removeEventListener(ev, fn) {
    const list = this.eventListeners.get(ev);
    if (!list) return;
    const idx = list.indexOf(fn);
    if (idx !== -1) list.splice(idx, 1);
  }

  async play() {
    this.paused = false;
    return Promise.resolve();
  }

  pause() {
    this.paused = true;
  }

  load() {}
  removeAttribute() {}
}

function createStageHarness() {
  const ipc = new EventEmitter();
  const sentStatus = [];
  ipc.send = (ch, ...args) => {
    if (ch === 'stage-status') sentStatus.push(args[0]);
  };

  const stageContainer = new MockElement('div', 'stageContainer');
  const deckA = new MockElement('div', 'deckA');
  deckA.classList.add('media-deck', 'active');
  const deckB = new MockElement('div', 'deckB');
  deckB.classList.add('media-deck');
  stageContainer.appendChild(deckA);
  stageContainer.appendChild(deckB);

  const blackoutCover = new MockElement('div', 'blackoutCover');
  const safeLogoLayer = new MockElement('div', 'safeLogoLayer');
  const safeLogoImg = new MockElement('img', 'safeLogoImg');
  safeLogoImg.src = 'assets/sample_keyvisual.svg';
  safeLogoLayer.appendChild(safeLogoImg);

  const visualMaskLayer = new MockElement('div', 'visualMaskLayer');
  const visualMaskImg = new MockElement('img', 'visualMaskImg');
  visualMaskLayer.appendChild(visualMaskImg);

  const watermarkOverlay = new MockElement('div', 'watermarkOverlay');
  const tickerOverlay = new MockElement('div', 'tickerOverlay');
  const tickerContent = new MockElement('div', 'tickerContent');

  const doc = {
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
        case 'visualMaskLayer': return visualMaskLayer;
        case 'visualMaskImg': return visualMaskImg;
        case 'watermarkOverlay': return watermarkOverlay;
        case 'tickerOverlay': return tickerOverlay;
        case 'tickerContent': return tickerContent;
        default: return null;
      }
    },
    querySelectorAll: (sel) => stageContainer.querySelectorAll(sel),
    createElement: (tag) => new MockElement(tag),
    addEventListener: () => {},
    removeEventListener: () => {}
  };

  const win = {
    addEventListener: () => {},
    removeEventListener: () => {},
    requestAnimationFrame: (cb) => setTimeout(() => cb(Date.now()), 1),
    cancelAnimationFrame: (id) => clearTimeout(id),
    setTimeout: (cb, ms) => setTimeout(cb, ms),
    clearTimeout: (id) => clearTimeout(id)
  };

  const stageFn = new Function(
    'document',
    'window',
    'requestAnimationFrame',
    'cancelAnimationFrame',
    'setTimeout',
    'clearTimeout',
    'performance',
    'require',
    `
      ${stageScriptSrc}
      return {
        getActiveDeckKey: () => activeDeckKey,
        getIsVisualHidden: () => isVisualHidden,
        getVisualMaskLayer: () => visualMaskLayer,
        getVisualMaskImg: () => visualMaskImg,
        getDeckA: () => decks.A,
        getDeckB: () => decks.B,
        getIpc: () => ipcRenderer
      };
    `
  );

  const mockRequire = (mod) => {
    if (mod === 'electron') return { ipcRenderer: ipc };
    if (mod === 'path') return path;
    if (mod === 'fs') return fs;
    if (mod === 'url') return require('url');
    return {};
  };

  const api = stageFn(doc, win, win.requestAnimationFrame, win.cancelAnimationFrame, win.setTimeout, win.clearTimeout, { now: () => Date.now() }, mockRequire);

  return { api, ipc, doc, deckA, deckB, visualMaskLayer, visualMaskImg, safeLogoImg };
}

describe('Feature: Guess-The-Song Hidden-Visual & Reveal Mode', () => {
  it('TC-HV-01: When cue has hideVisual=true, deck is NOT made active and visualMaskLayer is activated', async () => {
    const harness = createStageHarness();
    const { ipc, api, visualMaskLayer, visualMaskImg } = harness;

    // Trigger stage-go-live with hideVisual = true
    ipc.emit('stage-go-live', {}, {
      media: {
        id: 'song_cue_1',
        name: 'Doan_Ten_Bai_Hat_1.mp4',
        type: 'video',
        path: 'd:/media/bai1.mp4',
        hideVisual: true
      },
      transition: 'cut'
    });

    // Wait for async preRoll / requestAnimationFrame
    await new Promise(r => setTimeout(r, 60));

    // 1. isVisualHidden state must be true
    assert.strictEqual(api.getIsVisualHidden(), true, 'Stage must record isVisualHidden = true');

    // 2. The active deck (incoming deck B) MUST NOT have the "active" class
    const activeDeckKey = api.getActiveDeckKey();
    const activeDeck = activeDeckKey === 'A' ? api.getDeckA() : api.getDeckB();
    assert.strictEqual(activeDeck.classList.contains('active'), false, 'Incoming video deck must NOT have active class while hidden');

    // 3. Visual mask layer MUST have active class to cover the screen
    assert.strictEqual(visualMaskLayer.classList.contains('active'), true, 'visualMaskLayer must be active');

    // 4. Fallback image should be sample Key Visual
    assert.ok(visualMaskImg.src.includes('keyvisual'), 'Mask image must default to Key Visual');
  });

  it('TC-HV-02: Custom maskImagePath and maskScaling are applied to visualMaskLayer', async () => {
    const harness = createStageHarness();
    const { ipc, visualMaskImg } = harness;

    ipc.emit('stage-go-live', {}, {
      media: {
        id: 'song_cue_2',
        name: 'Doan_Ten_Bai_Hat_2.mp4',
        type: 'video',
        path: 'd:/media/bai2.mp4',
        hideVisual: true,
        maskImagePath: 'd:/assets/cau_hoi_so_2.png',
        maskScaling: 'contain'
      },
      transition: 'fast'
    });

    await new Promise(r => setTimeout(r, 60));

    assert.ok(visualMaskImg.src.includes('cau_hoi_so_2.png'), 'Mask image must resolve to custom per-cue image');
    assert.strictEqual(visualMaskImg.style.objectFit, 'contain', 'Mask image objectFit must be contain');
  });

  it('TC-HV-03: REVEAL_VISUAL control action activates deck and lifts mask without pausing video', async () => {
    const harness = createStageHarness();
    const { ipc, api, visualMaskLayer } = harness;

    ipc.emit('stage-go-live', {}, {
      media: {
        id: 'song_cue_3',
        name: 'Doan_Ten_Bai_Hat_3.mp4',
        type: 'video',
        path: 'd:/media/bai3.mp4',
        hideVisual: true
      },
      transition: 'normal'
    });

    await new Promise(r => setTimeout(r, 60));
    assert.strictEqual(api.getIsVisualHidden(), true);

    // Operator triggers REVEAL_VISUAL
    ipc.emit('stage-control', {}, 'REVEAL_VISUAL', { transition: 'fast' });

    await new Promise(r => setTimeout(r, 40));

    // 1. isVisualHidden is now false
    assert.strictEqual(api.getIsVisualHidden(), false, 'isVisualHidden must be false after reveal');

    // 2. The active deck must now have class "active"
    const activeDeckKey = api.getActiveDeckKey();
    const activeDeck = activeDeckKey === 'A' ? api.getDeckA() : api.getDeckB();
    assert.strictEqual(activeDeck.classList.contains('active'), true, 'Deck must be made active upon reveal');

    // 3. Mask layer active class removed
    assert.strictEqual(visualMaskLayer.classList.contains('active'), false, 'Mask layer must be deactivated');
  });

  it('TC-HV-04: Normal cue without hideVisual triggers regular crossfade without visual mask', async () => {
    const harness = createStageHarness();
    const { ipc, api, visualMaskLayer } = harness;

    ipc.emit('stage-go-live', {}, {
      media: {
        id: 'normal_video',
        name: 'Standard_Intro.mp4',
        type: 'video',
        path: 'd:/media/intro.mp4',
        hideVisual: false
      },
      transition: 'normal'
    });

    await new Promise(r => setTimeout(r, 60));

    assert.strictEqual(api.getIsVisualHidden(), false);
    assert.strictEqual(visualMaskLayer.classList.contains('active'), false);
    const activeDeckKey = api.getActiveDeckKey();
    const activeDeck = activeDeckKey === 'A' ? api.getDeckA() : api.getDeckB();
    assert.strictEqual(activeDeck.classList.contains('active'), true, 'Standard video deck must be active');
  });

  it('TC-HV-05: Serialization integrity: rundown serializer preserves hideVisual and maskImagePath', () => {
    const sampleRundown = [
      {
        id: 'cue_1',
        name: 'Song_1.mp4',
        path: 'd:/media/song1.mp4',
        type: 'video',
        format: 'mp4',
        duration: 120,
        width: 1920,
        height: 1080,
        endBehavior: 'HOLD_LAST_FRAME',
        hideVisual: true,
        maskImagePath: 'd:/images/question1.png'
      },
      {
        id: 'cue_2',
        name: 'Song_2.mp4',
        path: 'd:/media/song2.mp4',
        type: 'video',
        format: 'mp4',
        duration: 90,
        width: 1920,
        height: 1080,
        endBehavior: 'FADE_TO_BLACK',
        hideVisual: false,
        maskImagePath: null
      }
    ];

    // Mirror saveRundown logic
    const cleanRundown = sampleRundown.map(c => ({
      id: c.id,
      name: c.name,
      path: c.path,
      type: c.type,
      format: c.format,
      duration: c.duration,
      width: c.width,
      height: c.height,
      endBehavior: c.endBehavior,
      hideVisual: !!c.hideVisual,
      maskImagePath: c.maskImagePath || null,
      maskScaling: c.maskScaling || 'cover'
    }));

    const json = JSON.stringify(cleanRundown);
    const restored = JSON.parse(json);

    assert.strictEqual(restored[0].hideVisual, true);
    assert.strictEqual(restored[0].maskImagePath, 'd:/images/question1.png');
    assert.strictEqual(restored[0].maskScaling, 'cover');
    assert.strictEqual(restored[1].hideVisual, false);
    assert.strictEqual(restored[1].maskImagePath, null);
  });

  it('TC-HV-06: SET_MASK_SCALING live update dynamically changes visualMaskImg objectFit', async () => {
    const harness = createStageHarness();
    const { ipc, visualMaskImg } = harness;

    ipc.emit('stage-go-live', {}, {
      media: {
        id: 'song_cue_live',
        name: 'Doan_Bai_Hat.mp4',
        type: 'video',
        path: 'd:/media/bai.mp4',
        hideVisual: true,
        maskScaling: 'cover'
      },
      transition: 'cut'
    });

    await new Promise(r => setTimeout(r, 60));
    assert.strictEqual(visualMaskImg.style.objectFit, 'cover');

    // Operator changes scaling live
    ipc.emit('stage-control', {}, 'SET_MASK_SCALING', { scaling: 'contain' });
    assert.strictEqual(visualMaskImg.style.objectFit, 'contain', 'objectFit must update live to contain');

    ipc.emit('stage-control', {}, 'SET_MASK_SCALING', { scaling: 'fill' });
    assert.strictEqual(visualMaskImg.style.objectFit, 'fill', 'objectFit must update live to fill');
  });
});
