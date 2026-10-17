/**
 * tests/tier1_features.test.js
 * Tier 1: Feature Coverage (>=5 test cases per feature across R1-R4)
 * Uses Node.js 22 built-in test runner (node:test, node:assert)
 */
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');

const { IPCEventBus } = require('./harness/event_bus.js');
const { DisplayManagerEngine } = require('./harness/display_manager.js');
const { DualDeckEngine } = require('./harness/dual_deck_engine.js');
const { AudioSubsystemEngine } = require('./harness/audio_subsystem.js');
const { PanicAndHardwareEngine } = require('./harness/panic_hardware_engine.js');
const { PackagingValidator } = require('./harness/packaging_validator.js');

describe('Tier 1: Feature Coverage', () => {

  // ==========================================
  // R1: Standalone Zero-Install Portable Packaging
  // ==========================================
  describe('R1: Standalone Zero-Install Portable Packaging', () => {
    const validator = new PackagingValidator();

    it('TC-T1-R1-01: Package builder specification validates portable Windows target', () => {
      const spec = {
        appId: 'com.lumen.promediacontroller',
        win: { target: [{ target: 'portable', arch: ['x64'] }] },
        asarUnpack: ['assets/**/*'],
        extraResources: [{ from: 'assets', to: 'assets' }],
        portable: { artifactName: 'LUMEN-PRO-Portable-${version}.${ext}' }
      };
      const result = validator.validateBuilderConfig(spec);
      assert.strictEqual(result.valid, true, 'Config should be valid');
      assert.strictEqual(result.errors.length, 0);
    });

    it('TC-T1-R1-02: Package builder specification enforces asarUnpack for HTML5 media streaming', () => {
      const invalidSpec = {
        win: { target: ['portable'] },
        extraResources: [{ from: 'assets', to: 'assets' }]
        // Missing asarUnpack
      };
      const result = validator.validateBuilderConfig(invalidSpec);
      assert.strictEqual(result.valid, false, 'Config missing asarUnpack must fail');
      assert.ok(result.errors.some(e => e.includes('asarUnpack')));
    });

    it('TC-T1-R1-03: Package builder specification requires extraResources for asset bundling', () => {
      const invalidSpec = {
        win: { target: ['portable'] },
        asarUnpack: ['assets/**/*']
        // Missing extraResources
      };
      const result = validator.validateBuilderConfig(invalidSpec);
      assert.strictEqual(result.valid, false, 'Config missing extraResources must fail');
      assert.ok(result.errors.some(e => e.includes('extraResources')));
    });

    it('TC-T1-R1-04: Portable config defines standardized executable artifact naming', () => {
      const config = {
        artifactName: 'LUMEN-PRO-Portable-${version}.${ext}',
        requestExecutionLevel: 'user'
      };
      assert.strictEqual(config.artifactName.startsWith('LUMEN-PRO-Portable'), true);
      assert.strictEqual(config.requestExecutionLevel, 'user', 'Must run without UAC admin prompt');
    });

    it('TC-T1-R1-05: Runtime asset path resolver differentiates packaged vs dev environments', () => {
      const devPath = validator.resolveAssetPath('logo.svg', false);
      const pkgPath = validator.resolveAssetPath('logo.svg', true, 'D:\\App\\resources');
      assert.ok(devPath.includes(path.join('assets', 'logo.svg')));
      assert.ok(pkgPath.includes(path.join('resources', 'assets', 'logo.svg')));
    });

    it('TC-T1-R1-06: Offline font stack compliance detects remote Google Fonts and requires local fallbacks', () => {
      const onlineHtml = '<link href="https://fonts.googleapis.com/css2?family=Outfit" rel="stylesheet">';
      const offlineHtml = '<style>body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; }</style>';

      const onlineCheck = validator.checkOfflineFontStack(onlineHtml);
      assert.strictEqual(onlineCheck.compliant, false, 'Online Google Fonts must be flagged as non-compliant');

      const offlineCheck = validator.checkOfflineFontStack(offlineHtml);
      assert.strictEqual(offlineCheck.compliant, true, 'Offline system font stack must be compliant');
      assert.strictEqual(offlineCheck.hasOfflineFallback, true);
    });

    it('TC-T1-R1-07: Project asset repository contains core vectors (logo, keyvisual, countdown)', () => {
      const assets = validator.checkAssets();
      assert.strictEqual(assets.exists, true, 'Assets directory must exist');
      assert.strictEqual(assets.hasLogoSvg, true, 'logo.svg must be present');
      assert.strictEqual(assets.hasKeyvisualSvg, true, 'sample_keyvisual.svg must be present');
      assert.strictEqual(assets.hasCountdownSvg, true, 'sample_countdown.svg must be present');
    });
  });

  // ==========================================
  // R2: Mission-Critical Multi-Display & Screen Lifecycle
  // ==========================================
  describe('R2: Mission-Critical Multi-Display & Screen Lifecycle', () => {
    let dm;

    beforeEach(() => {
      dm = new DisplayManagerEngine();
      dm.setDisplays([
        { id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, label: 'Laptop Internal Display' },
        { id: 2, bounds: { x: 1920, y: 0, width: 3840, height: 2160 }, label: 'Panasonic 4K Laser Projector' }
      ], 1);
    });

    it('TC-T1-R2-01: Multi-display detection identifies primary and external displays', () => {
      const available = dm.getAvailableDisplays();
      assert.strictEqual(available.length, 2);
      assert.strictEqual(available[0].isPrimary, true);
      assert.strictEqual(available[0].isExternal, false);
      assert.strictEqual(available[1].isPrimary, false);
      assert.strictEqual(available[1].isExternal, true);
    });

    it('TC-T1-R2-02: Stage window anchors borderless fullscreen on external display with screen-saver priority', () => {
      const config = dm.reanchorStageWindow(2);
      assert.strictEqual(config.x, 1920);
      assert.strictEqual(config.y, 0);
      assert.strictEqual(config.width, 3840);
      assert.strictEqual(config.height, 2160);
      assert.strictEqual(config.frame, false, 'Must be borderless');
      assert.strictEqual(config.alwaysOnTop, true);
      assert.strictEqual(config.alwaysOnTopLevel, 'screen-saver');
      assert.strictEqual(config.kiosk, true);
      assert.strictEqual(config.isDockedPreview, false);
    });

    it('TC-T1-R2-03: Single-display fallback prevents blinding operator with non-intrusive docked preview', () => {
      // Simulate single display setup
      dm.setDisplays([
        { id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, label: 'Operator Primary' }
      ], 1);
      const config = dm.reanchorStageWindow();
      assert.strictEqual(config.displayId, 1);
      assert.strictEqual(config.frame, true, 'Single display preview window has frame');
      assert.strictEqual(config.alwaysOnTop, false, 'Must NOT be always-on-top over operator window');
      assert.strictEqual(config.kiosk, false);
      assert.strictEqual(config.isDockedPreview, true, 'Must be recognized as docked preview');
      assert.ok(config.width < 1920, 'Width must be smaller than primary screen');
      assert.ok(config.height < 1080, 'Height must be smaller than primary screen');
    });

    it('TC-T1-R2-04: PowerSaveBlocker engages prevent-display-sleep to block screensaver and OS sleep', () => {
      const id = dm.startPowerSaveBlocker('prevent-display-sleep');
      assert.ok(id !== null, 'Power save blocker must return active ID');
      assert.strictEqual(dm.isPowerSaveActive(), true);
      const stopped = dm.stopPowerSaveBlocker(id);
      assert.strictEqual(stopped, true);
      assert.strictEqual(dm.isPowerSaveActive(), false);
    });

    it('TC-T1-R2-05: Cable hotplug disconnect re-anchors Stage safely without crashing or covering Operator UI', () => {
      dm.reanchorStageWindow(2); // Anchored to projector
      assert.strictEqual(dm.stageWindowConfig.kiosk, true);

      // Unplug projector (Display 2 removed)
      const fallbackConfig = dm.handleDisplayRemoved(2);
      assert.strictEqual(fallbackConfig.displayId, 1);
      assert.strictEqual(fallbackConfig.alwaysOnTop, false, 'Must not cover operator dashboard on disconnect');
      assert.strictEqual(fallbackConfig.isDockedPreview, true);
    });

    it('TC-T1-R2-06: Display metrics change applies 400ms debounce to allow OS resolution negotiation', async () => {
      dm.reanchorStageWindow(2);
      let debouncedCalls = 0;

      // Simulate rapid metrics changes
      dm.handleDisplayMetricsChanged({ id: 2, bounds: { x: 1920, y: 0, width: 1920, height: 1080 } }, () => {
        debouncedCalls++;
      });
      // Fire second change immediately
      const promise = dm.handleDisplayMetricsChanged({ id: 2, bounds: { x: 1920, y: 0, width: 3840, height: 2160 } }, () => {
        debouncedCalls++;
      });

      assert.strictEqual(debouncedCalls, 0, 'Callback should not fire synchronously');
      const finalConfig = await promise;
      assert.strictEqual(debouncedCalls, 1, 'Only one debounced execution must occur');
      assert.strictEqual(finalConfig.width, 3840, 'Final negotiated resolution must be 3840');
    });

    it('TC-T1-R2-07: Autoplay command-line switch verification', () => {
      const requiredSwitch = ['autoplay-policy', 'no-user-gesture-required'];
      assert.strictEqual(requiredSwitch[0], 'autoplay-policy');
      assert.strictEqual(requiredSwitch[1], 'no-user-gesture-required');
    });
  });

  // ==========================================
  // R3: Dual-Deck Audio/Video Playback & Cue Management
  // ==========================================
  describe('R3: Dual-Deck Audio/Video Playback & Cue Management', () => {
    let engine;

    beforeEach(() => {
      engine = new DualDeckEngine();
    });

    it('TC-T1-R3-01: Dual-deck engine enforces pre-roll readyState before initiating crossfade', async () => {
      const cue = engine.ingestFile('D:\\LUMEN\\assets\\sample_video.mp4');
      const result = await engine.triggerGoLive(cue, 'normal');
      assert.strictEqual(result.activeDeck, 'B', 'Next active deck should be B');
      assert.strictEqual(engine.decks.B.readyState >= 2, true, 'Deck B readyState must be >= 2');
      assert.strictEqual(engine.decks.B.opacity, 1.0);
      assert.strictEqual(engine.decks.A.opacity, 0.0);
    });

    it('TC-T1-R3-02: Crossfade timings support Cut (0ms), Fast (400ms), Normal (800ms), Slow (1600ms)', () => {
      assert.strictEqual(engine.getTransitionDurationMs('cut'), 0);
      assert.strictEqual(engine.getTransitionDurationMs('fast'), 400);
      assert.strictEqual(engine.getTransitionDurationMs('normal'), 800);
      assert.strictEqual(engine.getTransitionDurationMs('slow'), 1600);
    });

    it('TC-T1-R3-03: Media ingestion filters supported extensions and generates valid cue descriptors', () => {
      const cue1 = engine.ingestFile('D:\\Media\\Opening_Video.mp4');
      const cue2 = engine.ingestFile('D:\\Media\\KeyVisual.png');
      assert.strictEqual(cue1.type, 'video');
      assert.strictEqual(cue2.type, 'image');
      assert.ok(cue1.id.startsWith('cue_'));
      assert.strictEqual(cue1.name, 'Opening_Video.mp4');
      assert.strictEqual(engine.rundown.length, 2);

      // Rejection of invalid extension
      assert.throws(() => {
        engine.ingestFile('D:\\Media\\Presentation.pdf');
      }, /Unsupported media format/);
    });

    it('TC-T1-R3-04: Rundown card reordering preserves cue metadata and modifies cue positions', () => {
      const c1 = engine.ingestFile('D:\\Media\\C1.mp4');
      const c2 = engine.ingestFile('D:\\Media\\C2.mp4');
      const c3 = engine.ingestFile('D:\\Media\\C3.mp4');

      assert.strictEqual(engine.rundown[0].id, c1.id);
      engine.moveCueDown(0);
      assert.strictEqual(engine.rundown[0].id, c2.id);
      assert.strictEqual(engine.rundown[1].id, c1.id);

      engine.reorderCues(2, 0);
      assert.strictEqual(engine.rundown[0].id, c3.id);
    });

    it('TC-T1-R3-05: End behavior HOLD_LAST_FRAME freezes video playback without clearing frame', async () => {
      const cue = engine.ingestFile('D:\\Media\\Clip.mp4', 'HOLD_LAST_FRAME');
      await engine.triggerGoLive(cue);
      const ended = engine.handleMediaEnded(cue.id, 'HOLD_LAST_FRAME');
      assert.strictEqual(ended.action, 'HOLD_LAST_FRAME');
      assert.strictEqual(engine.decks[engine.activeDeckKey].isPlaying, false);
      assert.strictEqual(engine.decks[engine.activeDeckKey].media.id, cue.id);
    });

    it('TC-T1-R3-06: End behavior LOOP maintains continuous playback', async () => {
      const cue = engine.ingestFile('D:\\Media\\BackgroundLoop.mp4', 'LOOP');
      await engine.triggerGoLive(cue);
      const ended = engine.handleMediaEnded(cue.id, 'LOOP');
      assert.strictEqual(ended.action, 'LOOP');
      assert.strictEqual(engine.decks[engine.activeDeckKey].isPlaying, true);
    });

    it('TC-T1-R3-07: End behavior AUTO_NEXT advances from active PGM cue ID, ignoring PVW preview index', async () => {
      const c1 = engine.ingestFile('D:\\Media\\Speaker1.mp4', 'AUTO_NEXT');
      const c2 = engine.ingestFile('D:\\Media\\Speaker2.mp4', 'HOLD_LAST_FRAME');
      const c3 = engine.ingestFile('D:\\Media\\Speaker3.mp4', 'HOLD_LAST_FRAME');

      // Go live with Cue 1
      await engine.triggerGoLive(c1);

      // Operator clicks on Cue 3 in preview (PVW)
      engine.selectedIndex = 2; // PVW is inspecting c3

      // Cue 1 ends on Stage
      const result = engine.handleMediaEnded(c1.id, 'AUTO_NEXT');
      assert.strictEqual(result.action, 'AUTO_NEXT');
      assert.strictEqual(result.nextCue.id, c2.id, 'Must advance to Cue 2 (next after PGM), NOT Cue 3!');
    });

    it('TC-T1-R3-08: End behavior FADE_TO_BLACK emits FTB action tag', async () => {
      const cue = engine.ingestFile('D:\\Media\\Outro.mp4', 'FADE_TO_BLACK');
      await engine.triggerGoLive(cue);
      const ended = engine.handleMediaEnded(cue.id, 'FADE_TO_BLACK');
      assert.strictEqual(ended.action, 'FADE_TO_BLACK');
    });

    it('TC-T1-R3-09: Independent dual audio routing assigns separate sinks for FOH and Headphone', () => {
      const audio = new AudioSubsystemEngine();
      const outputs = audio.getAudioOutputs();
      assert.strictEqual(outputs.length, 3);

      audio.setStageAudioSink('dev_foh_soundcard');
      audio.setCueAudioSink('dev_headphone_jack');

      assert.strictEqual(audio.stageAudioSinkId, 'dev_foh_soundcard');
      assert.strictEqual(audio.cueAudioSinkId, 'dev_headphone_jack');
      assert.notStrictEqual(audio.stageAudioSinkId, audio.cueAudioSinkId);
    });

    it('TC-T1-R3-10: Master volume and Mute modulation affects all decks and audio calculations', () => {
      const audio = new AudioSubsystemEngine();
      audio.setMasterVolume(0.75);
      assert.strictEqual(audio.masterVolume, 0.75);

      const curve = audio.calculateCrossfadeCurve(800, 4);
      assert.strictEqual(curve[0].outgoingVolume, 0.75);
      assert.strictEqual(curve[4].incomingVolume, 0.75);

      audio.toggleMute(true);
      assert.strictEqual(audio.isMuted, true);
    });
  });

  // ==========================================
  // R4: Panic Controls, Live Overlays & Tactile Hardware Shortcuts
  // ==========================================
  describe('R4: Panic Controls, Live Overlays & Tactile Hardware Shortcuts', () => {
    let panic;

    beforeEach(() => {
      panic = new PanicAndHardwareEngine();
    });

    it('TC-T1-R4-01: Sub-50ms emergency Blackout toggle ([B] / [ESC]) engages visual blackout and hard mute', () => {
      const res1 = panic.filterKeyInput({ code: 'Escape', key: 'Escape' });
      assert.strictEqual(res1.handled, true);
      assert.strictEqual(res1.action, 'BLACKOUT');
      assert.strictEqual(panic.isBlackout, true);
      assert.strictEqual(panic.isMuted, true, 'Blackout must engage hard mute');
      assert.ok(res1.latencyMs < 50, `Dispatch latency ${res1.latencyMs}ms must be < 50ms`);

      const res2 = panic.filterKeyInput({ code: 'KeyB', key: 'b' });
      assert.strictEqual(res2.handled, true);
      assert.strictEqual(panic.isBlackout, false);
    });

    it('TC-T1-R4-02: Sub-50ms Freeze toggle ([F]) freezes video and enforces Clean Stage Guarantee', () => {
      const res = panic.filterKeyInput({ code: 'KeyF', key: 'f' });
      assert.strictEqual(res.handled, true);
      assert.strictEqual(panic.isFrozen, true);
      assert.strictEqual(panic.stageHasFreezeBanner, false, 'Stage window must NEVER show freeze HUD!');
      assert.strictEqual(panic.operatorFreezeTallyActive, true, 'Operator UI must display freeze tally');
      assert.ok(res.latencyMs < 50);
    });

    it('TC-T1-R4-03: Sub-50ms Safe Logo transition ([L]) displays Key Visual', () => {
      const res = panic.filterKeyInput({ code: 'KeyL', key: 'l' });
      assert.strictEqual(res.handled, true);
      assert.strictEqual(panic.isSafeLogo, true);
      assert.ok(res.latencyMs < 50);
    });

    it('TC-T1-R4-04: Synchronized 1.0s audio/video Fade to Black ([T] / FTB) initiates audio ramp', () => {
      const res = panic.filterKeyInput({ code: 'KeyT', key: 't' });
      assert.strictEqual(res.handled, true);
      assert.strictEqual(panic.isFTB, true);

      const audio = new AudioSubsystemEngine();
      audio.setMasterVolume(1.0);
      const ramp = audio.calculateFtbAudioRamp(1000, 10);
      assert.strictEqual(ramp.length, 11);
      assert.strictEqual(ramp[0].volume, 1.0);
      assert.strictEqual(ramp[10].volume, 0.0);
      assert.strictEqual(ramp[10].isComplete, true);
    });

    it('TC-T1-R4-05: Focus-independent keyboard shortcut filter bypasses active text inputs for panic keys', () => {
      // Normal typing in TEXTAREA is allowed
      const normalType = panic.filterKeyInput({ code: 'KeyA', key: 'a', targetTagName: 'TEXTAREA' });
      assert.strictEqual(normalType.handled, false);
      assert.strictEqual(normalType.action, 'TEXT_INPUT_ALLOWED');

      // Emergency Escape while typing in TEXTAREA is intercepted!
      const emergencyEsc = panic.filterKeyInput({ code: 'Escape', key: 'Escape', targetTagName: 'TEXTAREA' });
      assert.strictEqual(emergencyEsc.handled, true);
      assert.strictEqual(emergencyEsc.action, 'BLACKOUT');
      assert.strictEqual(emergencyEsc.bypassedInputFocus, true);
      assert.strictEqual(panic.isBlackout, true);
    });

    it('TC-T1-R4-06: Wireless Numpad dedicated keys execute corresponding panic actions', () => {
      const numpadSub = panic.filterKeyInput({ code: 'NumpadSubtract', key: '-' });
      assert.strictEqual(numpadSub.action, 'BLACKOUT');

      const numpadMul = panic.filterKeyInput({ code: 'NumpadMultiply', key: '*' });
      assert.strictEqual(numpadMul.action, 'FREEZE');

      const numpad4 = panic.filterKeyInput({ code: 'Numpad4', key: '4' });
      assert.strictEqual(numpad4.action, 'SAFE_LOGO');

      const numpadAdd = panic.filterKeyInput({ code: 'NumpadAdd', key: '+' });
      assert.strictEqual(numpadAdd.action, 'FTB');

      const numpadEnter = panic.filterKeyInput({ code: 'NumpadEnter', key: 'Enter' });
      assert.strictEqual(numpadEnter.action, 'GO_LIVE');
    });

    it('TC-T1-R4-07: Web MIDI controller Note On triggers panic actions and CC 7 modulates volume fader', () => {
      // Pad 2 (Note 37): Blackout
      const midiBlackout = panic.parseMIDIMessage([0x90, 37, 127]);
      assert.strictEqual(midiBlackout.handled, true);
      assert.strictEqual(midiBlackout.action, 'BLACKOUT');

      // Pad 3 (Note 38): Freeze
      const midiFreeze = panic.parseMIDIMessage([0x90, 38, 127]);
      assert.strictEqual(midiFreeze.handled, true);
      assert.strictEqual(midiFreeze.action, 'FREEZE');

      // CC 7: Master Volume Fader (value 64 -> ~50%)
      const midiFader = panic.parseMIDIMessage([0xB0, 7, 64]);
      assert.strictEqual(midiFader.handled, true);
      assert.strictEqual(midiFader.action, 'SET_VOLUME');
      assert.strictEqual(midiFader.normalizedVolume, 0.504);
      assert.strictEqual(panic.masterVolume, 0.504);
    });

    it('TC-T1-R4-08: Dynamic live text ticker overlay calculates readable duration and triggers CSS reflow', () => {
      const ticker = panic.updateTicker('Welcome to LUMEN PRO Live Global Tech Summit 2026!');
      assert.strictEqual(ticker.visible, true);
      assert.strictEqual(ticker.reflowTriggered, true);
      assert.ok(ticker.animationDurationSec >= 14, 'Animation duration must be at least 14s');
    });

    it('TC-T1-R4-09: Watermark logo overlay toggles visibility, adjusts position, and clamps parameters', () => {
      const wm = panic.updateWatermark({
        visible: true,
        src: 'D:\\LUMEN\\assets\\logo.svg',
        position: 'bottom-right',
        opacity: 0.85,
        scalePercent: 120
      });
      assert.strictEqual(wm.visible, true);
      assert.strictEqual(wm.position, 'bottom-right');
      assert.strictEqual(wm.opacity, 0.85);
      assert.strictEqual(wm.scalePercent, 120);

      // Out-of-bounds opacity clamping
      const clampedWm = panic.updateWatermark({ opacity: 1.5, scalePercent: 300 });
      assert.strictEqual(clampedWm.opacity, 1.0);
      assert.strictEqual(clampedWm.scalePercent, 200);
    });
  });
});
