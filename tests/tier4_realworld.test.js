/**
 * tests/tier4_realworld.test.js
 * Tier 4: Real-World Application Scenarios (>=5 realistic live event workflows)
 * Uses Node.js 22 built-in test runner (node:test, node:assert)
 */
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');

const { IPCEventBus } = require('./harness/event_bus.js');
const { DisplayManagerEngine } = require('./harness/display_manager.js');
const { DualDeckEngine } = require('./harness/dual_deck_engine.js');
const { AudioSubsystemEngine } = require('./harness/audio_subsystem.js');
const { PanicAndHardwareEngine } = require('./harness/panic_hardware_engine.js');

describe('Tier 4: Real-World Application Scenarios', () => {
  let dm;
  let engine;
  let audio;
  let panic;
  let bus;

  beforeEach(() => {
    dm = new DisplayManagerEngine();
    dm.setDisplays([
      { id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, label: 'Operator Laptop' },
      { id: 2, bounds: { x: 1920, y: 0, width: 3840, height: 2160 }, label: 'Main Stage 4K LED Wall' }
    ], 1);

    engine = new DualDeckEngine();
    audio = new AudioSubsystemEngine();
    panic = new PanicAndHardwareEngine();
    bus = new IPCEventBus();

    audio.setStageAudioSink('dev_foh_soundcard');
    audio.setCueAudioSink('dev_headphone_jack');
  });

  it('TC-T4-01: Keynote Summit Opening Show Workflow', async () => {
    // 1. Stage window is anchored on external 4K LED processor
    const stageConfig = dm.reanchorStageWindow(2);
    assert.strictEqual(stageConfig.kiosk, true);
    assert.strictEqual(stageConfig.width, 3840);

    // 2. Pre-show countdown loop running on Stage Deck A
    const countdownCue = engine.ingestFile('D:\\LUMEN\\assets\\sample_countdown.svg', 'LOOP');
    const walkupCue = engine.ingestFile('D:\\Media\\Speaker_Walkup_Theme.mp4', 'HOLD_LAST_FRAME');

    await engine.triggerGoLive(countdownCue, 'cut');
    assert.strictEqual(engine.activeDeckKey, 'B'); // Deck B live with countdown
    assert.strictEqual(engine.decks.B.isPlaying, true);

    // 3. Operator auditions speaker walkup music in headphones via Cue Audio sink
    audio.toggleCueAudio(true);
    assert.strictEqual(audio.isCueAudioOn, true);
    assert.strictEqual(audio.cueAudioSinkId, 'dev_headphone_jack');

    // 4. MC introduces keynote speaker: Operator triggers GO LIVE with 0.8s crossfade
    const fadeResult = await engine.triggerGoLive(walkupCue, 'normal');
    assert.strictEqual(fadeResult.activeDeck, 'A');
    assert.strictEqual(fadeResult.pgmCue.id, walkupCue.id);
    assert.strictEqual(fadeResult.transitionDurationMs, 800);

    // Audio crossfade curve smoothly ramps up walkup music to Master FOH
    const audioRamp = audio.calculateCrossfadeCurve(800, 5);
    assert.strictEqual(audioRamp[0].incomingVolume, 0.0);
    assert.strictEqual(audioRamp[5].incomingVolume, 1.0);

    // 5. Walkup video reaches completion: triggers HOLD_LAST_FRAME
    const ended = engine.handleMediaEnded(walkupCue.id, 'HOLD_LAST_FRAME');
    assert.strictEqual(ended.action, 'HOLD_LAST_FRAME');
    assert.strictEqual(engine.decks.A.isPlaying, false);

    // 6. Live text ticker announces opening keynote
    const ticker = panic.updateTicker('Opening Keynote: Global Tech Horizons 2026 - Dr. Elena Vance');
    assert.strictEqual(ticker.visible, true);
    assert.ok(ticker.animationDurationSec >= 14);
  });

  it('TC-T4-02: Live Event Emergency Glitch & Panic Recovery Workflow', async () => {
    dm.reanchorStageWindow(2);

    const mainVideo = engine.ingestFile('D:\\Media\\Corporate_Reel.mp4');
    const backupVideo = engine.ingestFile('D:\\Media\\Corporate_Reel_Backup.mp4');

    await engine.triggerGoLive(mainVideo, 'normal');
    assert.strictEqual(engine.pgmCue.id, mainVideo.id);

    // EMERGENCY: Video artifacts / freeze glitch detected on Stage!
    // Operator hits Escape key
    const panicBlackout = panic.filterKeyInput({ code: 'Escape', key: 'Escape' });
    assert.strictEqual(panicBlackout.handled, true);
    assert.strictEqual(panic.isBlackout, true);
    assert.strictEqual(panic.isMuted, true);
    assert.ok(panicBlackout.latencyMs < 50, 'Emergency blackout must resolve in <50ms');

    // Operator activates Safe Logo behind blackout cover
    panic.filterKeyInput({ code: 'KeyL', key: 'l' });
    assert.strictEqual(panic.isSafeLogo, true);

    // Disengage blackout: audience smoothly sees Safe Logo Key Visual
    panic.filterKeyInput({ code: 'Escape', key: 'Escape' });
    assert.strictEqual(panic.isBlackout, false);
    assert.strictEqual(panic.isSafeLogo, true);

    // Operator cues backup video and triggers GO LIVE
    const recoveryResult = await engine.triggerGoLive(backupVideo, 'normal');
    // GO LIVE automatically releases Safe Logo
    panic.executePanicAction('GO_LIVE');
    assert.strictEqual(panic.isSafeLogo, false);
    assert.strictEqual(recoveryResult.pgmCue.id, backupVideo.id);
  });

  it('TC-T4-03: Multi-Speaker Sponsor Panel with Live Marquee Ticker & Freeze', async () => {
    dm.reanchorStageWindow(2);

    const sponsor1 = engine.ingestFile('D:\\Media\\Sponsor_Gold.mp4', 'AUTO_NEXT');
    const sponsor2 = engine.ingestFile('D:\\Media\\Sponsor_Platinum.mp4', 'HOLD_LAST_FRAME');

    // Activate live ticker
    panic.updateTicker('Welcome Gold & Platinum Partners to LUMEN PRO 2026');
    assert.strictEqual(panic.ticker.visible, true);

    // Start Sponsor 1
    await engine.triggerGoLive(sponsor1, 'normal');

    // Sponsor 1 completes: AUTO_NEXT automatically cues and fires Sponsor 2
    const endEvent = engine.handleMediaEnded(sponsor1.id, 'AUTO_NEXT');
    assert.strictEqual(endEvent.action, 'AUTO_NEXT');
    assert.strictEqual(endEvent.nextCue.id, sponsor2.id);

    await engine.triggerGoLive(endEvent.nextCue, 'fast');
    assert.strictEqual(engine.pgmCue.id, sponsor2.id);

    // Speaker requests freeze on comparison chart: Operator hits 'F'
    const freezeRes = panic.filterKeyInput({ code: 'KeyF', key: 'f' });
    assert.strictEqual(freezeRes.handled, true);
    assert.strictEqual(panic.isFrozen, true);
    assert.strictEqual(panic.stageHasFreezeBanner, false, 'No freeze watermark on stage screen');
    assert.strictEqual(panic.operatorFreezeTallyActive, true);

    // Discussion concludes: Operator unfreezes
    panic.filterKeyInput({ code: 'KeyF', key: 'f' });
    assert.strictEqual(panic.isFrozen, false);
  });

  it('TC-T4-04: Accidental HDMI Disconnect During Live Keynote & Hotplug Re-anchor', async () => {
    dm.reanchorStageWindow(2);
    assert.strictEqual(dm.stageWindowConfig.kiosk, true);

    const keynoteVideo = engine.ingestFile('D:\\Media\\Keynote_Speech.mp4', 'HOLD_LAST_FRAME');
    await engine.triggerGoLive(keynoteVideo, 'normal');

    // Technician trips over cable: Display 2 unplugged
    const fallbackConfig = dm.handleDisplayRemoved(2);
    // CRITICAL: Stage must NOT blind operator!
    assert.strictEqual(fallbackConfig.displayId, 1);
    assert.strictEqual(fallbackConfig.alwaysOnTop, false);
    assert.strictEqual(fallbackConfig.isDockedPreview, true);
    assert.strictEqual(engine.pgmCue.id, keynoteVideo.id, 'Playback state preserved across disconnect');

    // Technician plugs cable back in
    dm.handleDisplayAdded({ id: 2, bounds: { x: 1920, y: 0, width: 1920, height: 1080 }, label: 'Reconnected Projector' });

    // OS negotiates 4K resolution after 400ms debounce
    const reanchored = await dm.handleDisplayMetricsChanged({ id: 2, bounds: { x: 1920, y: 0, width: 3840, height: 2160 } });
    assert.strictEqual(reanchored.displayId, 2);
    assert.strictEqual(reanchored.width, 3840);
    assert.strictEqual(reanchored.height, 2160);
    assert.strictEqual(reanchored.kiosk, true);
    assert.strictEqual(reanchored.alwaysOnTopLevel, 'screen-saver');
  });

  it('TC-T4-05: High-Stakes VIP Product Launch with Dual Audio Monitoring & Synchronized FTB', async () => {
    dm.reanchorStageWindow(2);

    const standbyClip = engine.ingestFile('D:\\Media\\Hall_Standby.mp4', 'LOOP');
    const productReveal = engine.ingestFile('D:\\Media\\Nova_Product_Launch.mp4', 'FADE_TO_BLACK');

    // Hall standby music playing on FOH
    await engine.triggerGoLive(standbyClip, 'normal');

    // Operator checks Product Reveal in headphones
    audio.toggleCueAudio(true);
    assert.strictEqual(audio.isCueAudioOn, true);
    assert.strictEqual(audio.cueAudioSinkId, 'dev_headphone_jack');

    // Turn on Watermark Logo overlay in top-right corner
    panic.updateWatermark({ visible: true, position: 'top-right', opacity: 0.85 });
    assert.strictEqual(panic.watermark.visible, true);

    // Moment of reveal: Launch Product Video with 1.6s SLOW crossfade
    const launch = await engine.triggerGoLive(productReveal, 'slow');
    assert.strictEqual(launch.pgmCue.id, productReveal.id);
    assert.strictEqual(launch.transitionDurationMs, 1600);

    // Audio crossfade curve maintains soundstage
    const equalPowerCurve = audio.calculateCrossfadeCurve(1600, 8, 'equal-power');
    assert.ok(equalPowerCurve[4].incomingVolume > 0.65, 'Equal power curve preserves energy at midpoint');

    // Video concludes with FADE_TO_BLACK
    const endEvent = engine.handleMediaEnded(productReveal.id, 'FADE_TO_BLACK');
    assert.strictEqual(endEvent.action, 'FADE_TO_BLACK');

    // Synchronized 1.0s audio fade down
    const ftbRamp = audio.calculateFtbAudioRamp(1000, 10);
    assert.strictEqual(ftbRamp[0].volume, 1.0);
    assert.strictEqual(ftbRamp[10].volume, 0.0);
    assert.strictEqual(ftbRamp[10].isComplete, true);
  });
});
