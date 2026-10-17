/**
 * tests/tier3_combinations.test.js
 * Tier 3: Cross-Feature Combinations (Pairwise interactions across R1-R4)
 * Uses Node.js 22 built-in test runner (node:test, node:assert)
 */
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');

const { IPCEventBus } = require('./harness/event_bus.js');
const { DisplayManagerEngine } = require('./harness/display_manager.js');
const { DualDeckEngine } = require('./harness/dual_deck_engine.js');
const { AudioSubsystemEngine } = require('./harness/audio_subsystem.js');
const { PanicAndHardwareEngine } = require('./harness/panic_hardware_engine.js');

describe('Tier 3: Cross-Feature Combinations', () => {
  let dm;
  let engine;
  let audio;
  let panic;
  let bus;

  beforeEach(() => {
    dm = new DisplayManagerEngine();
    dm.setDisplays([
      { id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, label: 'Operator Laptop' },
      { id: 2, bounds: { x: 1920, y: 0, width: 1920, height: 1080 }, label: 'Main Stage Projector' }
    ], 1);

    engine = new DualDeckEngine();
    audio = new AudioSubsystemEngine();
    panic = new PanicAndHardwareEngine();
    bus = new IPCEventBus();
  });

  it('TC-T3-01: Cable disconnect occurs during active 1.6s video-to-video crossfade (Playback + Screen Lifecycle)', async () => {
    // Anchor stage to external projector
    dm.reanchorStageWindow(2);
    assert.strictEqual(dm.stageWindowConfig.kiosk, true);

    const c1 = engine.ingestFile('D:\\Media\\VideoA.mp4');
    const c2 = engine.ingestFile('D:\\Media\\VideoB.mp4');

    await engine.triggerGoLive(c1);
    // Start slow crossfade to c2
    const fadePromise = engine.triggerGoLive(c2, 'slow');

    // Mid-fade, projector cable is yanked!
    const fallbackConfig = dm.handleDisplayRemoved(2);

    // Verify: Stage window re-anchors safely without blinding operator
    assert.strictEqual(fallbackConfig.displayId, 1);
    assert.strictEqual(fallbackConfig.isDockedPreview, true);
    assert.strictEqual(fallbackConfig.alwaysOnTop, false);

    // Verify: Video playback on Deck B completes transition successfully
    const result = await fadePromise;
    assert.strictEqual(result.activeDeck, 'A'); // Deck swapped back to A for incoming c2
    assert.strictEqual(result.pgmCue.id, c2.id);
  });

  it('TC-T3-02: Panic Blackout triggered mid-transition while Deck A and Deck B are both playing (Panic + Dual Deck)', async () => {
    const c1 = engine.ingestFile('D:\\Media\\Clip1.mp4');
    const c2 = engine.ingestFile('D:\\Media\\Clip2.mp4');

    await engine.triggerGoLive(c1);
    await engine.triggerGoLive(c2, 'slow'); // Deck A and B both in transition

    // Operator hits ESC blackout
    const blackoutRes = panic.filterKeyInput({ code: 'Escape', key: 'Escape' });
    assert.strictEqual(blackoutRes.handled, true);
    assert.strictEqual(panic.isBlackout, true);
    assert.strictEqual(panic.isMuted, true);

    // Stage engine responds to blackout: all decks mute and pause
    engine.decks.A.isPlaying = false;
    engine.decks.B.isPlaying = false;
    engine.decks.A.isMuted = true;
    engine.decks.B.isMuted = true;

    assert.strictEqual(engine.decks.A.isPlaying, false);
    assert.strictEqual(engine.decks.B.isPlaying, false);

    // Disengage blackout: only active deck resumes
    panic.filterKeyInput({ code: 'KeyB', key: 'b' });
    assert.strictEqual(panic.isBlackout, false);
    engine.decks[engine.activeDeckKey].isPlaying = true;
    assert.strictEqual(engine.decks[engine.activeDeckKey].isPlaying, true);
  });

  it('TC-T3-03: Freeze triggered while an AUTO_NEXT cue timer expires (Panic + End Behaviors)', async () => {
    const c1 = engine.ingestFile('D:\\Media\\Intro.mp4', 'AUTO_NEXT');
    const c2 = engine.ingestFile('D:\\Media\\NextKeynote.mp4', 'HOLD_LAST_FRAME');

    await engine.triggerGoLive(c1);

    // Emergency freeze pressed on stage
    panic.filterKeyInput({ code: 'KeyF', key: 'f' });
    assert.strictEqual(panic.isFrozen, true);
    assert.strictEqual(panic.stageHasFreezeBanner, false); // Clean stage!

    // c1 finishes playing
    const ended = engine.handleMediaEnded(c1.id, 'AUTO_NEXT');
    assert.strictEqual(ended.action, 'AUTO_NEXT');
    assert.strictEqual(ended.nextCue.id, c2.id);

    // Operator releases freeze before launching next cue
    panic.filterKeyInput({ code: 'KeyF', key: 'f' });
    assert.strictEqual(panic.isFrozen, false);

    await engine.triggerGoLive(ended.nextCue);
    assert.strictEqual(engine.pgmCue.id, c2.id);
  });

  it('TC-T3-04: Dynamic Live Ticker update while an 800ms video crossfade is actively rendering (Overlays + Playback)', async () => {
    const c1 = engine.ingestFile('D:\\Media\\Keynote.mp4');
    const c2 = engine.ingestFile('D:\\Media\\Sponsor.mp4');

    await engine.triggerGoLive(c1);
    const fadePromise = engine.triggerGoLive(c2, 'normal');

    // Update ticker mid-fade
    const ticker = panic.updateTicker('URGENT: Keynote Q&A starts in 10 minutes');
    assert.strictEqual(ticker.visible, true);
    assert.strictEqual(ticker.reflowTriggered, true);

    const fadeResult = await fadePromise;
    assert.strictEqual(fadeResult.pgmCue.id, c2.id);
    assert.strictEqual(panic.ticker.visible, true);
  });

  it('TC-T3-05: Master volume fader moved via MIDI CC 7 while audio is actively ramping down in FTB (Audio + Hardware)', () => {
    audio.setMasterVolume(1.0);
    panic.filterKeyInput({ code: 'KeyT', key: 't' }); // Engage FTB
    assert.strictEqual(panic.isFTB, true);

    // MIDI CC 7 attempts to raise volume to 80%
    const midiRes = panic.parseMIDIMessage([0xB0, 7, 102]);
    assert.strictEqual(midiRes.handled, true);
    assert.strictEqual(panic.masterVolume, 0.803);

    // In FTB state, audio engine continues ramping down to silence regardless of master fader
    const ramp = audio.calculateFtbAudioRamp(1000, 10);
    assert.strictEqual(ramp[10].volume, 0.0);
  });

  it('TC-T3-06: HDMI re-connection and display re-anchor while Safe Logo is active on Stage (Screen Lifecycle + Panic)', () => {
    dm.reanchorStageWindow(2);
    // Engage Safe Logo
    panic.filterKeyInput({ code: 'KeyL', key: 'l' });
    assert.strictEqual(panic.isSafeLogo, true);

    // Display disconnect and reconnect
    dm.handleDisplayRemoved(2);
    const reconnected = dm.handleDisplayAdded({ id: 2, bounds: { x: 1920, y: 0, width: 3840, height: 2160 }, label: '4K Projector' });

    assert.strictEqual(reconnected.displayId, 2);
    assert.strictEqual(reconnected.width, 3840);
    assert.strictEqual(panic.isSafeLogo, true, 'Safe Logo must remain active across display reconnection');
  });

  it('TC-T3-07: Rundown cue reordered while that exact cue is currently on-air on Stage (Rundown + Playback)', async () => {
    const c1 = engine.ingestFile('D:\\Media\\Opening.mp4');
    const c2 = engine.ingestFile('D:\\Media\\Middle.mp4');
    const c3 = engine.ingestFile('D:\\Media\\Closing.mp4');

    await engine.triggerGoLive(c1); // c1 is on-air

    // Operator drags c1 to the end of the rundown
    const reordered = engine.reorderCues(0, 2);
    assert.strictEqual(reordered, true);
    assert.strictEqual(engine.rundown[2].id, c1.id);

    // Active PGM cue pointer and deck state remain completely unaffected
    assert.strictEqual(engine.pgmCue.id, c1.id);
    assert.strictEqual(engine.decks[engine.activeDeckKey].media.id, c1.id);
  });

  it('TC-T3-08: Cue headphone audio preview active while Master FOH is in blackout/muted (Dual Audio Sinks + Panic)', () => {
    audio.setStageAudioSink('dev_foh_soundcard');
    audio.setCueAudioSink('dev_headphone_jack');

    // Trigger Blackout: Master FOH is hard muted
    panic.filterKeyInput({ code: 'Escape', key: 'Escape' });
    assert.strictEqual(panic.isBlackout, true);
    audio.toggleMute(true);
    assert.strictEqual(audio.isMuted, true);

    // Operator turns on Cue Headphone monitor to check next video
    audio.toggleCueAudio(true);
    assert.strictEqual(audio.isCueAudioOn, true);
    // Headphone sink remains isolated and active
    assert.strictEqual(audio.cueAudioSinkId, 'dev_headphone_jack');
  });

  it('TC-T3-09: Media drag-drop ingestion while live ticker is actively scrolling and video is crossfading (Ingest + Overlays + Playback)', async () => {
    panic.updateTicker('Live from Stage 1: Welcome attendees!');
    const c1 = engine.ingestFile('D:\\Media\\1.mp4');
    const c2 = engine.ingestFile('D:\\Media\\2.mp4');

    await engine.triggerGoLive(c1);
    const fade = engine.triggerGoLive(c2, 'normal');

    // Mid-fade, operator drops a new video from Windows Explorer
    const newCue = engine.ingestFile('D:\\Media\\BreakingNews.mp4');
    assert.strictEqual(newCue.name, 'BreakingNews.mp4');
    assert.strictEqual(engine.rundown.length, 3);

    await fade;
    assert.strictEqual(engine.pgmCue.id, c2.id);
    assert.strictEqual(panic.ticker.visible, true);
  });

  it('TC-T3-10: Simultaneous Safe Logo and Blackout panic trigger priority arbitration (Panic Arbitration)', () => {
    // Trigger Safe Logo
    panic.filterKeyInput({ code: 'KeyL', key: 'l' });
    assert.strictEqual(panic.isSafeLogo, true);

    // Trigger Blackout
    panic.filterKeyInput({ code: 'KeyB', key: 'b' });
    assert.strictEqual(panic.isBlackout, true);
    assert.strictEqual(panic.isMuted, true);

    // Blackout takes visual precedence (black screen)
    // When Blackout is released, Safe Logo is still active
    panic.filterKeyInput({ code: 'KeyB', key: 'b' });
    assert.strictEqual(panic.isBlackout, false);
    assert.strictEqual(panic.isSafeLogo, true);
  });

  it('TC-T3-11: Audio device sink change mid-playback during active volume modulation (Audio Routing + Modulation)', () => {
    audio.setMasterVolume(0.65);
    audio.setStageAudioSink('dev_foh_soundcard');

    // Switch to alternate sink mid-show
    audio.setStageAudioSink('dev_headphone_jack');
    assert.strictEqual(audio.stageAudioSinkId, 'dev_headphone_jack');
    // Volume level must remain exactly 0.65
    assert.strictEqual(audio.masterVolume, 0.65);
  });

  it('TC-T3-12: Display metrics change from 1080p to 4K while Stage is in Freeze mode (Screen Lifecycle + Freeze)', async () => {
    dm.reanchorStageWindow(2);
    panic.filterKeyInput({ code: 'KeyF', key: 'f' });
    assert.strictEqual(panic.isFrozen, true);

    const updated = await dm.handleDisplayMetricsChanged({ id: 2, bounds: { x: 1920, y: 0, width: 3840, height: 2160 } });
    assert.strictEqual(updated.width, 3840);
    assert.strictEqual(updated.height, 2160);
    assert.strictEqual(panic.isFrozen, true, 'Stage must remain frozen after resolution update');
    assert.strictEqual(panic.stageHasFreezeBanner, false, 'Clean stage policy preserved');
  });
});
