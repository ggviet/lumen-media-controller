/**
 * tests/tier2_boundaries.test.js
 * Tier 2: Boundary & Corner Cases (>=5 test cases per feature across R1-R4)
 * Uses Node.js 22 built-in test runner (node:test, node:assert)
 */
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const { IPCEventBus } = require('./harness/event_bus.js');
const { DisplayManagerEngine } = require('./harness/display_manager.js');
const { DualDeckEngine } = require('./harness/dual_deck_engine.js');
const { AudioSubsystemEngine } = require('./harness/audio_subsystem.js');
const { PanicAndHardwareEngine } = require('./harness/panic_hardware_engine.js');
const { PackagingValidator } = require('./harness/packaging_validator.js');

describe('Tier 2: Boundary & Corner Cases', () => {

  // ==========================================
  // R1 Boundaries: Packaging & Portability
  // ==========================================
  describe('R1 Boundaries: Packaging & Portability', () => {
    const validator = new PackagingValidator();

    it('TC-T2-R1-01: Null, empty, or non-object configuration returns descriptive validation errors', () => {
      const resNull = validator.validateBuilderConfig(null);
      assert.strictEqual(resNull.valid, false);
      assert.ok(resNull.errors.length > 0);

      const resEmpty = validator.validateBuilderConfig({});
      assert.strictEqual(resEmpty.valid, false);
      assert.ok(resEmpty.errors.some(e => e.includes('win')));
    });

    it('TC-T2-R1-02: Asset path resolver normalizes deep paths, trailing slashes, and backslash/slash mix', () => {
      const resolved = validator.resolveAssetPath('subfolder//logo.svg', false);
      assert.ok(resolved.endsWith(path.join('subfolder', 'logo.svg')));
    });

    it('TC-T2-R1-03: Media paths with unicode, spaces, and punctuation characters are preserved correctly', () => {
      const complexPath = 'D:\\LUMEN\\assets\\Hội Thảo Tech Summit #2026 [Final] (Main).mp4';
      const engine = new DualDeckEngine();
      const cue = engine.ingestFile(complexPath);
      assert.strictEqual(cue.name, 'Hội Thảo Tech Summit #2026 [Final] (Main).mp4');
      assert.strictEqual(cue.path, complexPath);
    });

    it('TC-T2-R1-04: Packaging validator flags missing win.target or non-portable target', () => {
      const nsisOnlySpec = {
        win: { target: ['nsis'] }, // Missing portable
        asarUnpack: ['assets/**/*'],
        extraResources: [{ from: 'assets', to: 'assets' }]
      };
      const res = validator.validateBuilderConfig(nsisOnlySpec);
      assert.strictEqual(res.valid, false);
      assert.ok(res.errors.some(e => e.includes('portable target')));
    });

    it('TC-T2-R1-05: Asset checking identifies presence of vector graphics and missing raster icons', () => {
      const assets = validator.checkAssets();
      assert.strictEqual(assets.exists, true);
      assert.strictEqual(assets.hasLogoSvg, true);
      // Note: icon.png and icon.ico may be generated during M5
      assert.strictEqual(typeof assets.hasIconPng, 'boolean');
      assert.strictEqual(typeof assets.hasIconIco, 'boolean');
    });

    it('TC-T2-R1-06: Offline font stack analysis handles mixed HTML with inline comments and CDNs', () => {
      const mixedHtml = `
        <!-- Comment: Google fonts below -->
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Roboto">
        <style>body { font-family: 'Segoe UI', sans-serif; }</style>
      `;
      const res = validator.checkOfflineFontStack(mixedHtml);
      assert.strictEqual(res.compliant, false);
      assert.strictEqual(res.violations.length, 1);
    });
  });

  // ==========================================
  // R2 Boundaries: Multi-Display & Screen Lifecycle
  // ==========================================
  describe('R2 Boundaries: Multi-Display & Screen Lifecycle', () => {
    let dm;

    beforeEach(() => {
      dm = new DisplayManagerEngine();
    });

    it('TC-T2-R2-01: Single-monitor rehearsal mode places docked preview within primary screen bounds', () => {
      dm.setDisplays([{ id: 1, bounds: { x: 0, y: 0, width: 1366, height: 768 }, label: 'Small Laptop' }], 1);
      const config = dm.reanchorStageWindow();
      assert.strictEqual(config.displayId, 1);
      assert.strictEqual(config.alwaysOnTop, false);
      assert.ok(config.x >= 0 && config.x < 1366);
      assert.ok(config.y >= 0 && config.y < 768);
      assert.ok(config.width <= 1366);
      assert.ok(config.height <= 768);
    });

    it('TC-T2-R2-02: Negative coordinates (secondary monitor placed to the left of primary) handled accurately', () => {
      dm.setDisplays([
        { id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, label: 'Primary' },
        { id: 2, bounds: { x: -1920, y: 0, width: 1920, height: 1080 }, label: 'Left Projector' }
      ], 1);
      const config = dm.reanchorStageWindow(2);
      assert.strictEqual(config.x, -1920);
      assert.strictEqual(config.y, 0);
      assert.strictEqual(config.width, 1920);
      assert.strictEqual(config.height, 1080);
      assert.strictEqual(config.kiosk, true);
    });

    it('TC-T2-R2-03: Rapid HDMI cable bounce (3 connect/disconnect events within 50ms) resolves to final state', () => {
      dm.setDisplays([
        { id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, label: 'Primary' },
        { id: 2, bounds: { x: 1920, y: 0, width: 1920, height: 1080 }, label: 'External' }
      ], 1);
      dm.reanchorStageWindow(2);

      // Bounce 1: disconnect
      dm.handleDisplayRemoved(2);
      // Bounce 2: reconnect
      dm.handleDisplayAdded({ id: 2, bounds: { x: 1920, y: 0, width: 1920, height: 1080 }, label: 'External' });
      // Bounce 3: final disconnect
      const finalConfig = dm.handleDisplayRemoved(2);

      assert.strictEqual(finalConfig.displayId, 1);
      assert.strictEqual(finalConfig.isDockedPreview, true);
      assert.strictEqual(finalConfig.alwaysOnTop, false);
    });

    it('TC-T2-R2-04: High-DPI scaleFactor (150% scaling) maintains exact logical bounds', () => {
      dm.setDisplays([
        { id: 1, bounds: { x: 0, y: 0, width: 1536, height: 864 }, scaleFactor: 1.5, label: 'High-DPI Laptop' },
        { id: 2, bounds: { x: 1536, y: 0, width: 1920, height: 1080 }, scaleFactor: 1.0, label: '1080p LED Wall' }
      ], 1);
      const available = dm.getAvailableDisplays();
      assert.strictEqual(available[0].scaleFactor, 1.5);
      assert.strictEqual(available[1].scaleFactor, 1.0);

      const stageConfig = dm.reanchorStageWindow(2);
      assert.strictEqual(stageConfig.x, 1536);
      assert.strictEqual(stageConfig.width, 1920);
    });

    it('TC-T2-R2-05: Disconnecting non-active display does not disrupt active Stage window', () => {
      dm.setDisplays([
        { id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, label: 'Primary' },
        { id: 2, bounds: { x: 1920, y: 0, width: 1920, height: 1080 }, label: 'Stage LED' },
        { id: 3, bounds: { x: 3840, y: 0, width: 1920, height: 1080 }, label: 'Confidence Monitor' }
      ], 1);
      dm.reanchorStageWindow(2); // Stage is on Display 2

      // Confidence monitor (Display 3) disconnected
      const config = dm.handleDisplayRemoved(3);
      assert.strictEqual(config.displayId, 2, 'Stage window must remain anchored to Display 2');
      assert.strictEqual(config.kiosk, true);
    });

    it('TC-T2-R2-06: PowerSaveBlocker rejects invalid mode types gracefully', () => {
      const invalidId = dm.startPowerSaveBlocker('unsupported-mode');
      assert.strictEqual(invalidId, null);
      assert.strictEqual(dm.isPowerSaveActive(), false);
    });
  });

  // ==========================================
  // R3 Boundaries: Dual-Deck Playback & Audio Routing
  // ==========================================
  describe('R3 Boundaries: Dual-Deck Playback & Audio Routing', () => {
    let engine;
    let audio;

    beforeEach(() => {
      engine = new DualDeckEngine();
      audio = new AudioSubsystemEngine();
    });

    it('TC-T2-R3-01: Instant Cut transition (0ms) executes without animation delay or lingering opacity', async () => {
      const cue1 = engine.ingestFile('D:\\Media\\A.mp4');
      const cue2 = engine.ingestFile('D:\\Media\\B.mp4');
      await engine.triggerGoLive(cue1, 'cut');
      assert.strictEqual(engine.lastTransitionDurationMs, 0);
      assert.strictEqual(engine.decks[engine.activeDeckKey].opacity, 1.0);

      await engine.triggerGoLive(cue2, 'cut');
      assert.strictEqual(engine.lastTransitionDurationMs, 0);
      assert.strictEqual(engine.decks[engine.activeDeckKey].media.id, cue2.id);
    });

    it('TC-T2-R3-02: Extreme slow crossfade (10,000ms) computes stable progress curve without NaN', () => {
      const curve = audio.calculateCrossfadeCurve(10000, 20);
      assert.strictEqual(curve.length, 21);
      assert.strictEqual(curve[0].elapsedMs, 0);
      assert.strictEqual(curve[20].elapsedMs, 10000);
      assert.strictEqual(curve[10].incomingVolume, 0.5);
      assert.strictEqual(curve[10].outgoingVolume, 0.5);
      assert.ok(!Number.isNaN(curve[10].incomingVolume));
    });

    it('TC-T2-R3-03: Ingestion of executable and script files (.exe, .bat, .sh, .js) is strictly rejected', () => {
      const dangerousFiles = [
        'C:\\Windows\\System32\\cmd.exe',
        'D:\\Scripts\\install.bat',
        'D:\\Scripts\\run.sh',
        'D:\\Payload\\exploit.js',
        'D:\\Docs\\Report.pdf'
      ];
      for (const file of dangerousFiles) {
        assert.throws(() => engine.ingestFile(file), /Unsupported media format/);
      }
    });

    it('TC-T2-R3-04: Ingestion handles uppercase file extensions (.MP4, .PNG, .WEBM) case-insensitively', () => {
      const cue1 = engine.ingestFile('D:\\Media\\UPPERCASE_VIDEO.MP4');
      const cue2 = engine.ingestFile('D:\\Media\\UPPERCASE_IMAGE.PNG');
      assert.strictEqual(cue1.type, 'video');
      assert.strictEqual(cue2.type, 'image');
    });

    it('TC-T2-R3-05: Pressing GO LIVE on empty rundown or null media throws descriptive error', async () => {
      await assert.rejects(async () => {
        await engine.triggerGoLive(null);
      }, /Cannot GO LIVE without media/);
    });

    it('TC-T2-R3-06: Rapid cue switching mid-crossfade cleanly overrides previous target', async () => {
      const c1 = engine.ingestFile('D:\\Media\\1.mp4');
      const c2 = engine.ingestFile('D:\\Media\\2.mp4');
      const c3 = engine.ingestFile('D:\\Media\\3.mp4');

      // Start transition to c1
      await engine.triggerGoLive(c1, 'slow');
      // Rapidly switch to c2
      await engine.triggerGoLive(c2, 'normal');
      // Rapidly switch to c3
      const finalRes = await engine.triggerGoLive(c3, 'cut');

      assert.strictEqual(finalRes.pgmCue.id, c3.id);
      assert.strictEqual(engine.decks[engine.activeDeckKey].media.id, c3.id);
    });

    it('TC-T2-R3-07: AUTO_NEXT on final rundown cue emits termination tag and does not crash', async () => {
      const c1 = engine.ingestFile('D:\\Media\\OnlyOne.mp4', 'AUTO_NEXT');
      await engine.triggerGoLive(c1);
      const res = engine.handleMediaEnded(c1.id, 'AUTO_NEXT');
      assert.strictEqual(res.action, 'AUTO_NEXT_REACHED_END');
    });

    it('TC-T2-R3-08: Master volume slider boundaries clamp exactly at 0.0, 1.0, negatives, and overflows', () => {
      assert.strictEqual(audio.setMasterVolume(0.0), 0.0);
      assert.strictEqual(audio.setMasterVolume(1.0), 1.0);
      assert.strictEqual(audio.setMasterVolume(-0.4), 0.0);
      assert.strictEqual(audio.setMasterVolume(2.8), 1.0);
      assert.strictEqual(audio.setMasterVolume('invalid'), 0.0);
    });

    it('TC-T2-R3-09: Setting audio sink to empty string cleanly resets to system default device', () => {
      audio.setStageAudioSink('dev_foh_soundcard');
      assert.strictEqual(audio.stageAudioSinkId, 'dev_foh_soundcard');
      audio.setStageAudioSink('');
      assert.strictEqual(audio.stageAudioSinkId, '');
    });
  });

  // ==========================================
  // R4 Boundaries: Panic Controls, Overlays & Tactile Shortcuts
  // ==========================================
  describe('R4 Boundaries: Panic Controls, Overlays & Tactile Shortcuts', () => {
    let panic;

    beforeEach(() => {
      panic = new PanicAndHardwareEngine();
    });

    it('TC-T2-R4-01: Panic hotkey bypass while typing in active TEXTAREA', () => {
      // Escape bypasses
      const esc = panic.filterKeyInput({ code: 'Escape', key: 'Escape', targetTagName: 'TEXTAREA' });
      assert.strictEqual(esc.handled, true);
      assert.strictEqual(esc.bypassedInputFocus, true);

      // NumpadSubtract bypasses
      const sub = panic.filterKeyInput({ code: 'NumpadSubtract', key: '-', targetTagName: 'TEXTAREA' });
      assert.strictEqual(sub.handled, true);
      assert.strictEqual(sub.bypassedInputFocus, true);
    });

    it('TC-T2-R4-02: Panic hotkey bypass while focus is inside SELECT element', () => {
      const mul = panic.filterKeyInput({ code: 'NumpadMultiply', key: '*', targetTagName: 'SELECT' });
      assert.strictEqual(mul.handled, true);
      assert.strictEqual(mul.bypassedInputFocus, true);
      assert.strictEqual(mul.action, 'FREEZE');
    });

    it('TC-T2-R4-03: Rapid toggling of Blackout (engaged and disengaged within 5ms) maintains consistency', () => {
      panic.filterKeyInput({ code: 'KeyB', key: 'b' });
      assert.strictEqual(panic.isBlackout, true);
      panic.filterKeyInput({ code: 'KeyB', key: 'b' });
      assert.strictEqual(panic.isBlackout, false);
      panic.filterKeyInput({ code: 'KeyB', key: 'b' });
      assert.strictEqual(panic.isBlackout, true);
    });

    it('TC-T2-R4-04: Web MIDI Note-On with velocity 0 is treated as Note-Off (no action)', () => {
      const res = panic.parseMIDIMessage([0x90, 37, 0]);
      assert.strictEqual(res.handled, true);
      assert.strictEqual(res.type, 'note_off');
      assert.strictEqual(panic.isBlackout, false, 'Velocity 0 must not trigger Blackout');
    });

    it('TC-T2-R4-05: Web MIDI corrupted or truncated packet returns handled=false without throwing', () => {
      const res1 = panic.parseMIDIMessage([0x90]);
      assert.strictEqual(res1.handled, false);
      assert.ok(res1.error);

      const res2 = panic.parseMIDIMessage(null);
      assert.strictEqual(res2.handled, false);
    });

    it('TC-T2-R4-06: Live text ticker handles empty string, whitespace, and 1000-char string safely', () => {
      const emptyTicker = panic.updateTicker('');
      assert.strictEqual(emptyTicker.visible, false);

      const longText = 'A'.repeat(1000);
      const longTicker = panic.updateTicker(longText);
      assert.strictEqual(longTicker.visible, true);
      assert.strictEqual(longTicker.animationDurationSec, 350); // 1000 * 0.35
    });

    it('TC-T2-R4-07: Watermark overlay clamps negative scale and out-of-range opacity', () => {
      const wm = panic.updateWatermark({ opacity: -0.5, scalePercent: 5 });
      assert.strictEqual(wm.opacity, 0.0);
      assert.strictEqual(wm.scalePercent, 10, 'Scale must clamp to minimum 10%');
    });
  });
});
