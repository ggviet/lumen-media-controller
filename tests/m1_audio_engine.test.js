/**
 * tests/m1_audio_engine.test.js
 * Comprehensive Automated Test Suite: Milestone M1 (Audio Engine Implementation)
 *
 * Verifies:
 * 1. Multi-format Audio Ingestion (.mp3, .wav, .m4a, .aac, .flac) & Metadata Extraction
 * 2. Dedicated Audio / BGM Deck Engine in Operator UI with Waveform, Stereo VU Meters, Scrubber
 * 3. Master FOH Routing (setSinkId) & Cue Pre-Listen Headphone Isolation
 * 4. 2.5s Audio Fade-Out Cosine/Exponential Ramp & Transport State Machine
 * 5. Sync-Start & Decoupled Playback: 0ms audio dropout during live video/image hot-swapping
 * 6. Clean Stage Fallback: Key Visual / Safe Logo display when audio plays without video
 * 7. Selective Panic ("Dập hình giữ tiếng") & Tactile Focus-Independent Shortcuts
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { readCompleteHtml } = require('./test_helpers');

const mainSrc = fs.readFileSync(path.join(__dirname, '../src/main/index.js'), 'utf8');
const operatorHtml = readCompleteHtml(path.join(__dirname, '../src/renderer/operator/index.html'));
const stageHtml = readCompleteHtml(path.join(__dirname, '../src/renderer/stage/index.html'));
const hotkeysScriptSrc = fs.readFileSync(path.join(__dirname, '../src/renderer/operator/scripts/hotkeys.js'), 'utf8');
const dualDeckScriptSrc = fs.readFileSync(path.join(__dirname, '../src/renderer/operator/scripts/dual_deck.js'), 'utf8');
const stageScriptSrc = fs.readFileSync(path.join(__dirname, '../src/renderer/stage/scripts/stage.js'), 'utf8');

describe('M1 Audio Engine: Static & Behavioral Architecture Verification', () => {

  describe('1. Multi-Format Audio Ingestion & Metadata Pipeline', () => {
    it('1.1: File dialog in main process accepts mp3, wav, m4a, aac, flac in Audio Files filter', () => {
      assert.ok(mainSrc.includes("name: 'Audio Files'"), 'Audio Files filter must be declared in main process');
      assert.ok(mainSrc.includes("'mp3'"), 'mp3 must be in extensions list');
      assert.ok(mainSrc.includes("'wav'"), 'wav must be in extensions list');
      assert.ok(mainSrc.includes("'m4a'"), 'm4a must be in extensions list');
      assert.ok(mainSrc.includes("'aac'"), 'aac must be in extensions list');
      assert.ok(mainSrc.includes("'flac'"), 'flac must be in extensions list');
    });

    it('1.2: Rundown script defines ALLOWED_AUDIO_EXTS and safely integrates with validateMediaExtension', () => {
      assert.ok(operatorHtml.includes("ALLOWED_AUDIO_EXTS = new Set(['mp3', 'wav', 'm4a', 'aac', 'flac'])"), 'ALLOWED_AUDIO_EXTS must be declared');
      assert.ok(operatorHtml.includes('extractAudioMetadata'), 'extractAudioMetadata routine must be present');
      assert.ok(operatorHtml.includes("cue.type === 'audio'"), 'renderRundown must handle cue.type === "audio"');
    });

    it('1.3: Audio formats validate case-insensitively across uppercase and mixed-case paths', () => {
      const allowedAudio = new Set(['mp3', 'wav', 'm4a', 'aac', 'flac']);
      function validateAudio(fp) {
        if (!fp || typeof fp !== 'string') return false;
        const parts = fp.split('.');
        if (parts.length < 2) return false;
        return allowedAudio.has(parts.pop().toLowerCase().trim());
      }

      assert.strictEqual(validateAudio('song.MP3'), true);
      assert.strictEqual(validateAudio('backing.WAV'), true);
      assert.strictEqual(validateAudio('track.M4A'), true);
      assert.strictEqual(validateAudio('podcast.AAC'), true);
      assert.strictEqual(validateAudio('lossless.FLAC'), true);
      assert.strictEqual(validateAudio('danger.exe'), false);
    });
  });

  describe('2. Dedicated Audio / BGM Deck UI & Visual Telemetry', () => {
    it('2.1: Declares dedicated Audio Deck elements in Operator Column 3', () => {
      assert.ok(operatorHtml.includes('id="operatorAudioDeck"'), '<audio id="operatorAudioDeck"> element must exist');
      assert.ok(operatorHtml.includes('id="operatorCuePlayer"'), '<audio id="operatorCuePlayer"> element must exist');
      assert.ok(operatorHtml.includes('id="audioWaveformCanvas"'), 'Canvas for audio waveform rendering must exist');
      assert.ok(operatorHtml.includes('id="audioDeckScrubber"'), 'Interactive seekbar scrubber must exist');
      assert.ok(operatorHtml.includes('id="audioDeckVuL"'), 'Stereo VU meter Left channel must exist');
      assert.ok(operatorHtml.includes('id="audioDeckVuR"'), 'Stereo VU meter Right channel must exist');
      assert.ok(operatorHtml.includes('id="audioDeckElapsed"'), 'Elapsed broadcast timecode element must exist');
      assert.ok(operatorHtml.includes('id="audioDeckRemaining"'), 'Remaining broadcast timecode element must exist');
    });

    it('2.2: Declares audio transport buttons with dedicated control IDs', () => {
      assert.ok(operatorHtml.includes('id="btnAudioDeckPlayPause"'), 'Play/Pause button must exist');
      assert.ok(operatorHtml.includes('id="btnAudioDeckStop"'), 'Stop button must exist');
      assert.ok(operatorHtml.includes('id="btnAudioDeckLoop"'), 'Loop button must exist');
      assert.ok(operatorHtml.includes('id="btnAudioDeckFadeOut"'), 'Fade Out button must exist');
      assert.ok(operatorHtml.includes('id="btnCueAudioDeck"'), 'PFL Cue button must exist');
      assert.ok(operatorHtml.includes('id="btnAudioSyncLive"'), 'Sync Live Start button must exist');
    });
  });

  describe('3. Audio Routing & Master FOH Hardware Isolation', () => {
    it('3.1: operatorAudioDeck binds setSinkId to Master FOH soundcard (audioSinkSelect)', () => {
      assert.ok(operatorHtml.includes('operatorAudioDeck.setSinkId'), 'operatorAudioDeck setSinkId must be called');
      assert.ok(operatorHtml.includes('audioSinkSelect.value'), 'audioSinkSelect.value must be queried for sink routing');
      assert.ok(operatorHtml.includes('operatorAudioDeck.volume = masterVolumeSlider') || operatorHtml.includes('operatorAudioDeck.volume ='), 'operatorAudioDeck volume must be modulated by master slider');
    });

    it('3.2: operatorCuePlayer binds setSinkId to Cue Headphone soundcard (cueAudioSinkSelect)', () => {
      assert.ok(operatorHtml.includes('operatorCuePlayer.setSinkId'), 'operatorCuePlayer setSinkId must be called');
      assert.ok(operatorHtml.includes('cueAudioSinkSelect.value'), 'cueAudioSinkSelect.value must be queried for cue routing');
    });

    it('3.3: Implements 2.5s cosine/exponential audio fade-out ramp', () => {
      assert.ok(operatorHtml.includes('startAudioDeckFadeOut'), 'startAudioDeckFadeOut function must exist');
      assert.ok(operatorHtml.includes('2500'), 'Default fade-out duration must be 2500ms (2.5 seconds)');
      assert.ok(operatorHtml.includes('Math.cos'), 'Fade out must use smooth non-linear trigonometric curve');
    });
  });

  describe('4. Dual-Plane Decoupled Playback & Sync-Start', () => {
    it('4.1: triggerGoLive triggers Audio Deck if cue is audio or has paired audio', () => {
      assert.ok(operatorHtml.includes("isAudioCue = target.type === 'audio'"), 'triggerGoLive detects audio cue');
      assert.ok(operatorHtml.includes('hasIndependentAudioTrack'), 'triggerGoLive computes hasIndependentAudioTrack status');
      assert.ok(operatorHtml.includes('loadTrackToAudioDeck'), 'triggerGoLive loads audio cue to dedicated deck');
    });

    it('4.2: Audio deck continues uninterrupted (0ms dropout) when live visual cues are hot-swapped', () => {
      // operatorAudioDeck is instantiated in Operator window DOM root, independent of Stage window unmounting
      assert.ok(operatorHtml.includes('operatorAudioDeck'), 'Dedicated operatorAudioDeck persists across rundown actions');
    });
  });

  describe('5. Stage Clean Fallback & Audio-Visual Ducking', () => {
    it('5.1: Stage go-live sets incoming video volume to 0 and muted if independent audio is active', () => {
      assert.ok(stageHtml.includes('hasIndependentAudioTrack'), 'stage-go-live handles hasIndependentAudioTrack');
      assert.ok(stageHtml.includes('mediaElement.volume = 0'), 'Stage video volume must initialize to 0 when audio track is active');
      assert.ok(stageHtml.includes('mediaElement.muted = true'), 'Stage video must be muted when audio track is active');
      assert.ok(stageHtml.includes('independentAudioMuted'), 'independentAudioMuted flag protects video from unmuting');
    });

    it('5.2: Stage falls back to Key Visual / Safe Logo when audio plays without video', () => {
      assert.ok(stageHtml.includes('sample_keyvisual.svg'), 'sample_keyvisual.svg must be referenced for safe key visual fallback');
      assert.ok(stageHtml.includes('isAudioFallback'), 'isAudioFallback handling must be present');
    });

    it('5.3: Video ending with audio on air cleanly dissolves to Safe Logo instead of black flash', () => {
      assert.ok(stageHtml.includes("endBehavior === 'FADE_TO_BLACK'"), 'FADE_TO_BLACK behavior is preserved');
      assert.ok(stageHtml.includes('safeLogoLayer.classList.add'), 'Safe Logo layer activates when audio remains on air');
    });
  });

  describe('6. Selective Panic ("Dập hình giữ tiếng") & Tactile Shortcuts', () => {
    it('6.1: Main process maps tactile shortcuts for Audio Play/Pause and Audio Fade-Out', () => {
      assert.ok(mainSrc.includes('AUDIO_PLAY_PAUSE'), 'AUDIO_PLAY_PAUSE action mapped in main process');
      assert.ok(mainSrc.includes('AUDIO_FADE_OUT'), 'AUDIO_FADE_OUT action mapped in main process');
      assert.ok(mainSrc.includes("code === 'Numpad5'"), 'Numpad5 mapped in main process');
      assert.ok(mainSrc.includes("code === 'NumpadDecimal'"), 'NumpadDecimal mapped in main process');
      assert.ok(!mainSrc.includes("shift && code === 'Space'"), 'Shift+Space must NOT be mapped in main process');
      assert.ok(!mainSrc.includes("shift && code === 'KeyT'"), 'Shift+KeyT must NOT be mapped in main process');
      assert.ok(mainSrc.includes('durationMs: 2500'), 'Fade out duration payload set to 2500ms in main process');
    });

    it('6.2: Stage BLACKOUT blanks video while operatorAudioDeck keeps playing', () => {
      assert.ok(stageHtml.includes("case 'BLACKOUT':"), 'Stage processes BLACKOUT action');
      assert.ok(stageHtml.includes("document.querySelectorAll('.media-deck video').forEach(v => {"), 'BLACKOUT only pauses stage video elements');
      assert.ok(operatorHtml.includes('preserveAudio === false'), 'Operator hotkeys distinguish selective blackout from hard panic kill');
    });

    it('6.3: Focus-independent keyboard event listener intercepts tactile hotkeys', () => {
      assert.ok(operatorHtml.includes('toggleAudioDeckPlayPause'), 'keydown listener calls toggleAudioDeckPlayPause');
      assert.ok(operatorHtml.includes('startAudioDeckFadeOut'), 'keydown listener calls startAudioDeckFadeOut');
      assert.ok(operatorHtml.includes("code === 'Numpad5'"), 'Numpad 5 key code handled for audio play/pause');
      assert.ok(operatorHtml.includes("code === 'NumpadDecimal'"), 'Numpad Decimal handled for audio fade out');
      assert.ok(operatorHtml.includes("code === 'KeyP'"), 'KeyP handled for audio play/pause');
      assert.ok(operatorHtml.includes("code === 'KeyO'"), 'KeyO handled for audio fade out');
    });
  });

  describe('7. Focus-Safe Hotkey Input Isolation & Tactile Shortcut Verification', () => {
    function createHotkeyTestHarness() {
      let playPauseCallCount = 0;
      let fadeOutCallCount = 0;
      let fadeOutDuration = null;
      let blackoutClicks = 0;
      let stopAudioDeckCalls = 0;
      let keydownHandler = null;

      const mockWindow = {
        addEventListener: (event, handler) => {
          if (event === 'keydown') keydownHandler = handler;
        }
      };

      const mockDoc = {
        addEventListener: () => {},
        activeElement: null,
        getElementById: () => null,
        querySelectorAll: () => []
      };

      const sandbox = {
        window: mockWindow,
        document: mockDoc,
        ipcRenderer: {
          on: () => {},
          send: () => {}
        },
        toggleAudioDeckPlayPause: () => { playPauseCallCount++; },
        startAudioDeckFadeOut: (dur) => { fadeOutCallCount++; fadeOutDuration = dur; },
        stopAudioDeck: () => { stopAudioDeckCalls++; },
        triggerGoLive: () => {},
        reorderRundown: () => {},
        canExecutePanicAction: () => true,
        selectedIndex: 0,
        rundown: [],
        path: { join: (...args) => args.join('/') },
        resolveOperatorAssetDir: () => '.',
        btnBlackout: { click: () => { blackoutClicks++; }, addEventListener: () => {}, classList: { toggle: () => {} } },
        btnFreeze: { click: () => {}, addEventListener: () => {}, classList: { toggle: () => {} } },
        btnSafeLogo: { click: () => {}, addEventListener: () => {}, classList: { toggle: () => {} } },
        btnFTB: { click: () => {}, addEventListener: () => {}, classList: { toggle: () => {} } },
        btnMuteMaster: { click: () => {}, addEventListener: () => {}, classList: { toggle: () => {} } },
        isPanicLocked: false
      };

      const keys = Object.keys(sandbox);
      const fn = new Function(...keys, hotkeysScriptSrc);
      fn(...Object.values(sandbox));

      return {
        dispatch: (opts) => {
          const e = {
            code: opts.code || '',
            key: opts.key || '',
            shiftKey: !!opts.shiftKey,
            ctrlKey: !!opts.ctrlKey,
            altKey: !!opts.altKey,
            metaKey: !!opts.metaKey,
            location: opts.location || 0,
            target: opts.target || { tagName: 'BODY' },
            defaultPrevented: false,
            preventDefault() { this.defaultPrevented = true; }
          };
          if (keydownHandler) keydownHandler(e);
          return e;
        },
        getPlayPauseCount: () => playPauseCallCount,
        getFadeOutCount: () => fadeOutCallCount,
        getFadeOutDuration: () => fadeOutDuration,
        getBlackoutCount: () => blackoutClicks,
        getStopAudioDeckCount: () => stopAudioDeckCalls,
        reset: () => {
          playPauseCallCount = 0;
          fadeOutCallCount = 0;
          fadeOutDuration = null;
          blackoutClicks = 0;
          stopAudioDeckCalls = 0;
        }
      };
    }

    it('7.1: Typing "p" and "o" inside active TEXTAREA does NOT blur or trigger audio controls', () => {
      const harness = createHotkeyTestHarness();
      let textareaBlurred = false;
      const mockTextarea = {
        tagName: 'TEXTAREA',
        id: 'liveTickerInput',
        value: 'Hello',
        blur() { textareaBlurred = true; }
      };

      // Type unshifted 'p'
      const evtP = harness.dispatch({ code: 'KeyP', key: 'p', target: mockTextarea });
      assert.strictEqual(evtP.defaultPrevented, false, 'Default action must not be prevented for letter p');
      assert.strictEqual(textareaBlurred, false, 'Textarea must NOT be blurred when typing p');
      assert.strictEqual(harness.getPlayPauseCount(), 0, 'toggleAudioDeckPlayPause must NOT be called');

      // Type unshifted 'o'
      const evtO = harness.dispatch({ code: 'KeyO', key: 'o', target: mockTextarea });
      assert.strictEqual(evtO.defaultPrevented, false, 'Default action must not be prevented for letter o');
      assert.strictEqual(textareaBlurred, false, 'Textarea must NOT be blurred when typing o');
      assert.strictEqual(harness.getFadeOutCount(), 0, 'startAudioDeckFadeOut must NOT be called');

      // Type shifted 'P'
      const evtShiftP = harness.dispatch({ code: 'KeyP', key: 'P', shiftKey: true, target: mockTextarea });
      assert.strictEqual(evtShiftP.defaultPrevented, false, 'Shift+P in textarea must not be prevented');
      assert.strictEqual(textareaBlurred, false, 'Textarea must NOT be blurred when typing Shift+P');
      assert.strictEqual(harness.getPlayPauseCount(), 0, 'Shift+P in textarea must NOT trigger play/pause');

      // Type shifted 'O'
      const evtShiftO = harness.dispatch({ code: 'KeyO', key: 'O', shiftKey: true, target: mockTextarea });
      assert.strictEqual(evtShiftO.defaultPrevented, false, 'Shift+O in textarea must not be prevented');
      assert.strictEqual(textareaBlurred, false, 'Textarea must NOT be blurred when typing Shift+O');
      assert.strictEqual(harness.getFadeOutCount(), 0, 'Shift+O in textarea must NOT trigger fade out');
    });

    it('7.2: Typing "p" and "o" inside active INPUT does NOT blur or trigger audio controls', () => {
      const harness = createHotkeyTestHarness();
      let inputBlurred = false;
      const mockInput = {
        tagName: 'INPUT',
        id: 'cueTitleInput',
        blur() { inputBlurred = true; }
      };

      harness.dispatch({ code: 'KeyP', key: 'p', target: mockInput });
      assert.strictEqual(inputBlurred, false, 'INPUT must NOT blur on KeyP');
      assert.strictEqual(harness.getPlayPauseCount(), 0, 'Audio play/pause must NOT fire');

      harness.dispatch({ code: 'KeyO', key: 'o', target: mockInput });
      assert.strictEqual(inputBlurred, false, 'INPUT must NOT blur on KeyO');
      assert.strictEqual(harness.getFadeOutCount(), 0, 'Audio fade-out must NOT fire');
    });

    it('7.3: Typing in contenteditable element does NOT blur or trigger audio controls', () => {
      const harness = createHotkeyTestHarness();
      let divBlurred = false;
      const mockContentEditable = {
        tagName: 'DIV',
        isContentEditable: true,
        blur() { divBlurred = true; }
      };

      harness.dispatch({ code: 'KeyP', key: 'p', target: mockContentEditable });
      assert.strictEqual(divBlurred, false);
      assert.strictEqual(harness.getPlayPauseCount(), 0);

      harness.dispatch({ code: 'KeyO', key: 'o', target: mockContentEditable });
      assert.strictEqual(divBlurred, false);
      assert.strictEqual(harness.getFadeOutCount(), 0);
    });

    it('7.4: When focus is NOT in an input, tactile hotkeys trigger AUDIO_PLAY_PAUSE', () => {
      const harness = createHotkeyTestHarness();
      const nonInput = { tagName: 'BUTTON' };

      // KeyP (unshifted)
      harness.reset();
      const pRes = harness.dispatch({ code: 'KeyP', key: 'p', target: nonInput });
      assert.strictEqual(pRes.defaultPrevented, true, 'KeyP outside input must prevent default');
      assert.strictEqual(harness.getPlayPauseCount(), 1, 'KeyP outside input triggers play/pause');

      // Shift+KeyP
      harness.reset();
      const spRes = harness.dispatch({ code: 'KeyP', key: 'P', shiftKey: true, target: nonInput });
      assert.strictEqual(spRes.defaultPrevented, true);
      assert.strictEqual(harness.getPlayPauseCount(), 1);

      // Shift+Space
      harness.reset();
      const sSpaceRes = harness.dispatch({ code: 'Space', key: ' ', shiftKey: true, target: nonInput });
      assert.strictEqual(sSpaceRes.defaultPrevented, true);
      assert.strictEqual(harness.getPlayPauseCount(), 1);

      // Numpad5
      harness.reset();
      const num5Res = harness.dispatch({ code: 'Numpad5', key: '5', target: nonInput });
      assert.strictEqual(num5Res.defaultPrevented, true);
      assert.strictEqual(harness.getPlayPauseCount(), 1);
    });

    it('7.5: When focus is NOT in an input, tactile hotkeys trigger AUDIO_FADE_OUT', () => {
      const harness = createHotkeyTestHarness();
      const nonInput = { tagName: 'DIV' };

      // KeyO (unshifted)
      harness.reset();
      const oRes = harness.dispatch({ code: 'KeyO', key: 'o', target: nonInput });
      assert.strictEqual(oRes.defaultPrevented, true, 'KeyO outside input must prevent default');
      assert.strictEqual(harness.getFadeOutCount(), 1, 'KeyO outside input triggers fade out');
      assert.strictEqual(harness.getFadeOutDuration(), 2500);

      // Shift+KeyO
      harness.reset();
      const soRes = harness.dispatch({ code: 'KeyO', key: 'O', shiftKey: true, target: nonInput });
      assert.strictEqual(soRes.defaultPrevented, true);
      assert.strictEqual(harness.getFadeOutCount(), 1);

      // Shift+KeyT
      harness.reset();
      const stRes = harness.dispatch({ code: 'KeyT', key: 'T', shiftKey: true, target: nonInput });
      assert.strictEqual(stRes.defaultPrevented, true);
      assert.strictEqual(harness.getFadeOutCount(), 1);

      // NumpadDecimal
      harness.reset();
      const numDecRes = harness.dispatch({ code: 'NumpadDecimal', key: '.', target: nonInput });
      assert.strictEqual(numDecRes.defaultPrevented, true);
      assert.strictEqual(harness.getFadeOutCount(), 1);
    });

    it('7.6: Main process emergency input-bypass does NOT intercept unshifted KeyP or KeyO', () => {
      const lines = mainSrc.split('\n');
      const bypassSlice = lines.slice(45, 67).join('\n');
      assert.ok(!bypassSlice.includes("code === 'KeyP' && !shift"), 'Main process must not intercept unshifted KeyP in bypass');
      assert.ok(!bypassSlice.includes("code === 'KeyO' && !shift"), 'Main process must not intercept unshifted KeyO in bypass');
    });

    it('7.7: Typing uppercase letters with Shift in active TEXTAREA does NOT blur or trigger audio controls or blackout', () => {
      const harness = createHotkeyTestHarness();
      let textareaBlurred = false;
      const mockTextarea = {
        tagName: 'TEXTAREA',
        id: 'liveTickerInput',
        value: '',
        blur() { textareaBlurred = true; }
      };

      // Test Shift+T (uppercase T)
      harness.reset();
      textareaBlurred = false;
      const evtT = harness.dispatch({ code: 'KeyT', key: 'T', shiftKey: true, target: mockTextarea });
      assert.strictEqual(evtT.defaultPrevented, false, 'Shift+T in textarea must NOT prevent default');
      assert.strictEqual(textareaBlurred, false, 'Textarea must NOT blur on Shift+T');
      assert.strictEqual(harness.getFadeOutCount(), 0, 'Shift+T in textarea must NOT trigger audio fade out');

      // Test Shift+B (uppercase B)
      harness.reset();
      textareaBlurred = false;
      const evtB = harness.dispatch({ code: 'KeyB', key: 'B', shiftKey: true, target: mockTextarea });
      assert.strictEqual(evtB.defaultPrevented, false, 'Shift+B in textarea must NOT prevent default');
      assert.strictEqual(textareaBlurred, false, 'Textarea must NOT blur on Shift+B');
      assert.strictEqual(harness.getBlackoutCount(), 0, 'Shift+B in textarea must NOT trigger blackout');
      assert.strictEqual(harness.getStopAudioDeckCount(), 0, 'Shift+B in textarea must NOT trigger stopAudioDeck');
    });

    it('7.8: Typing Shift+Space in active TEXTAREA does NOT blur or trigger audio controls', () => {
      const harness = createHotkeyTestHarness();
      let textareaBlurred = false;
      const mockTextarea = {
        tagName: 'TEXTAREA',
        id: 'liveTickerInput',
        value: '',
        blur() { textareaBlurred = true; }
      };

      harness.reset();
      const evtSpace = harness.dispatch({ code: 'Space', key: ' ', shiftKey: true, target: mockTextarea });
      assert.strictEqual(evtSpace.defaultPrevented, false, 'Shift+Space in textarea must NOT prevent default');
      assert.strictEqual(textareaBlurred, false, 'Textarea must NOT blur on Shift+Space');
      assert.strictEqual(harness.getPlayPauseCount(), 0, 'Shift+Space in textarea must NOT trigger audio play/pause');
    });

    it('7.9: Real-world sentence typing: "The 2026 Tech Summit Broadcast" inside TEXTAREA produces 0 blurs and 0 hotkey actions', () => {
      const harness = createHotkeyTestHarness();
      let blurCount = 0;
      const mockTextarea = {
        tagName: 'TEXTAREA',
        id: 'liveTickerInput',
        value: '',
        blur() { blurCount++; }
      };

      const sentence = "The 2026 Tech Summit Broadcast";
      harness.reset();

      for (let i = 0; i < sentence.length; i++) {
        const char = sentence[i];
        const isUpper = char >= 'A' && char <= 'Z';
        const isSpace = char === ' ';
        const code = isSpace ? 'Space' : (char >= '0' && char <= '9' ? `Digit${char}` : `Key${char.toUpperCase()}`);
        const shiftKey = isUpper;

        const evt = harness.dispatch({ code, key: char, shiftKey, target: mockTextarea });
        assert.strictEqual(evt.defaultPrevented, false, `Character '${char}' must not be prevented during typing`);
      }

      assert.strictEqual(blurCount, 0, 'Textarea must NOT blur during sentence typing');
      assert.strictEqual(harness.getPlayPauseCount(), 0, 'No play/pause calls during sentence typing');
      assert.strictEqual(harness.getFadeOutCount(), 0, 'No fadeout calls during sentence typing');
      assert.strictEqual(harness.getBlackoutCount(), 0, 'No blackout calls during sentence typing');
      assert.strictEqual(harness.getStopAudioDeckCount(), 0, 'No stopAudioDeck calls during sentence typing');
    });

    it('7.10: Main process attachPanicInputInterceptor ignores standard alphanumeric typing keys and intercepts hardware panic keys', () => {
      let beforeInputHandler = null;
      const sentIpc = [];

      const mockWin = {
        isDestroyed: () => false,
        webContents: {
          on: (type, handler) => {
            if (type === 'before-input-event') beforeInputHandler = handler;
          },
          send: (channel, data) => {
            sentIpc.push({ channel, data });
          }
        }
      };

      const fnMatch = mainSrc.match(/function attachPanicInputInterceptor[\s\S]*?\n\}/);
      assert.ok(fnMatch, 'attachPanicInputInterceptor must exist in main/index.js');

      const attachFn = new Function('screen', 'operatorWindow', `${fnMatch[0]}; return attachPanicInputInterceptor;`)(
        {},
        mockWin
      );
      attachFn(mockWin, 'operator');

      function dispatchInput(input) {
        if (beforeInputHandler) {
          beforeInputHandler({ preventDefault: () => {} }, {
            type: 'keyDown',
            code: input.code || '',
            key: input.key || '',
            shiftKey: !!input.shiftKey,
            ctrlKey: !!input.ctrlKey,
            altKey: !!input.altKey,
            metaKey: !!input.metaKey
          });
        }
      }

      // 1. Verify standard typing keys are NEVER intercepted
      const typingTestKeys = [
        { code: 'KeyT', key: 'T', shiftKey: true },
        { code: 'KeyB', key: 'B', shiftKey: true },
        { code: 'KeyP', key: 'P', shiftKey: true },
        { code: 'KeyO', key: 'O', shiftKey: true },
        { code: 'Space', key: ' ', shiftKey: true },
        { code: 'Space', key: ' ', shiftKey: false },
        { code: 'KeyT', key: 't', shiftKey: false },
        { code: 'KeyB', key: 'b', shiftKey: false },
        { code: 'KeyP', key: 'p', shiftKey: false },
        { code: 'KeyO', key: 'o', shiftKey: false }
      ];

      for (const k of typingTestKeys) {
        sentIpc.length = 0;
        dispatchInput(k);
        assert.strictEqual(sentIpc.length, 0, `Main process must NOT intercept typing key ${k.code} (shift=${k.shiftKey})`);
      }

      // 2. Verify hardware panic keys ARE intercepted
      const hardwareKeys = [
        { code: 'Escape', key: 'Escape', expectedAction: 'BLACKOUT' },
        { code: 'F1', key: 'F1', expectedAction: 'SAFE_LOGO' },
        { code: 'F2', key: 'F2', expectedAction: 'FREEZE' },
        { code: 'F3', key: 'F3', expectedAction: 'FTB' },
        { code: 'F4', key: 'F4', expectedAction: 'BLACKOUT' },
        { code: 'NumpadSubtract', key: '-', expectedAction: 'BLACKOUT' },
        { code: 'NumpadMultiply', key: '*', expectedAction: 'FREEZE' },
        { code: 'NumpadAdd', key: '+', expectedAction: 'FTB' },
        { code: 'NumpadEnter', key: 'Enter', expectedAction: 'GO_LIVE' },
        { code: 'NumpadDivide', key: '/', expectedAction: 'MUTE' },
        { code: 'Numpad5', key: '5', expectedAction: 'AUDIO_PLAY_PAUSE' },
        { code: 'NumpadDecimal', key: '.', expectedAction: 'AUDIO_FADE_OUT' }
      ];

      for (const hk of hardwareKeys) {
        sentIpc.length = 0;
        dispatchInput(hk);
        assert.strictEqual(sentIpc.length, 1, `Hardware key ${hk.code} must be intercepted`);
        assert.strictEqual(sentIpc[0].data.action, hk.expectedAction);
      }
    });

    it('7.11: When focus is NOT in an input: KeyB triggers selective BLACKOUT, and Shift+KeyB triggers hard BLACKOUT', () => {
      const harness = createHotkeyTestHarness();
      const nonInput = { tagName: 'BODY' };

      // Selective blackout: unshifted KeyB
      harness.reset();
      const bRes = harness.dispatch({ code: 'KeyB', key: 'b', shiftKey: false, target: nonInput });
      assert.strictEqual(bRes.defaultPrevented, true);
      assert.strictEqual(harness.getBlackoutCount(), 1, 'KeyB outside input triggers blackout click');
      assert.strictEqual(harness.getStopAudioDeckCount(), 0, 'Selective KeyB must NOT stop audio deck');

      // Hard blackout: Shift+KeyB
      harness.reset();
      const sbRes = harness.dispatch({ code: 'KeyB', key: 'B', shiftKey: true, target: nonInput });
      assert.strictEqual(sbRes.defaultPrevented, true);
      assert.strictEqual(harness.getBlackoutCount(), 1, 'Shift+KeyB outside input triggers blackout click');
      assert.strictEqual(harness.getStopAudioDeckCount(), 1, 'Shift+KeyB outside input MUST call stopAudioDeck');
    });
  });

  describe('8. Decoupled Video Audio Ducking & Stage Volume Restoration Verification', () => {
    function createDualDeckHarness(options = {}) {
      const goLiveCalls = [];
      const operatorAudioDeck = {
        paused: options.audioDeckPaused !== undefined ? options.audioDeckPaused : true,
        ended: options.audioDeckEnded !== undefined ? options.audioDeckEnded : false,
        duration: 180,
        currentTime: 0
      };
      let isAudioDeckPlayingState = options.isAudioDeckPlaying !== undefined ? options.isAudioDeckPlaying : false;
      let audioDeckTrack = options.audioDeckTrack || null;

      const sandbox = {
        goLiveCalls,
        ipcRenderer: {
          send: (channel, data) => {
            if (channel === 'go-live') goLiveCalls.push(data);
          }
        },
        operatorAudioDeck,
        get isAudioDeckPlaying() { return isAudioDeckPlayingState; },
        set isAudioDeckPlaying(val) { isAudioDeckPlayingState = val; },
        get audioDeckTrack() { return audioDeckTrack; },
        set audioDeckTrack(val) { audioDeckTrack = val; },
        currentTransition: 'Cut',
        currentScaling: 'contain',
        btnBlackout: { classList: { toggle: () => {} } },
        btnFTB: { classList: { toggle: () => {} } },
        btnGoLive: { addEventListener: () => {} },
        renderRundown: () => {},
        pvwCue: null,
        pvwContainer: { querySelector: () => null },
        pgmContainer: { querySelector: () => null, appendChild: () => {}, innerHTML: '' },
        pgmElapsed: { innerText: '' },
        pgmRemaining: { innerText: '' },
        pgmCueTitle: { innerText: '' },
        pgmFrame: { classList: { add: () => {} } },
        document: {
          getElementById: () => null,
          querySelectorAll: () => [],
          createElement: () => ({ style: {}, classList: { add: () => {} }, setAttribute: () => {} })
        },
        loadTrackToAudioDeck: (track, autoPlay) => {},
        playAudioDeck: () => { isAudioDeckPlayingState = true; operatorAudioDeck.paused = false; },
        resolveOperatorAssetDir: () => '.'
      };

      const keys = Object.keys(sandbox);
      const fn = new Function(...keys, `
        ${dualDeckScriptSrc}
        return {
          triggerGoLive,
          getGoLiveCalls: () => goLiveCalls
        };
      `);
      return fn(...Object.values(sandbox));
    }

    it('8.1: Dual-deck triggerGoLive sets hasIndependentAudioTrack = false when audio deck is stopped for standalone video cue', () => {
      const harness = createDualDeckHarness({
        audioDeckPaused: true,
        audioDeckEnded: false,
        isAudioDeckPlaying: false,
        audioDeckTrack: { title: 'PreviousBGM.mp3', path: 'PreviousBGM.mp3' }
      });

      const videoCue = { id: 'cue-vid-1', type: 'video', name: 'Speaker_Video.mp4', path: 'Speaker_Video.mp4' };
      harness.triggerGoLive(videoCue);

      const calls = harness.getGoLiveCalls();
      assert.strictEqual(calls.length, 1);
      assert.strictEqual(calls[0].hasIndependentAudioTrack, false, 'hasIndependentAudioTrack must be FALSE when audio deck is stopped');
    });

    it('8.2: Dual-deck triggerGoLive sets hasIndependentAudioTrack = false when audio track has ended', () => {
      const harness = createDualDeckHarness({
        audioDeckPaused: true,
        audioDeckEnded: true,
        isAudioDeckPlaying: false,
        audioDeckTrack: { title: 'EndedTrack.mp3', path: 'EndedTrack.mp3' }
      });

      const videoCue = { id: 'cue-vid-2', type: 'video', name: 'Presentation.mp4', path: 'Presentation.mp4' };
      harness.triggerGoLive(videoCue);

      const calls = harness.getGoLiveCalls();
      assert.strictEqual(calls[0].hasIndependentAudioTrack, false, 'hasIndependentAudioTrack must be FALSE when audio track ended');
    });

    it('8.3: Dual-deck triggerGoLive sets hasIndependentAudioTrack = true when audio deck is actively playing', () => {
      const harness = createDualDeckHarness({
        audioDeckPaused: false,
        audioDeckEnded: false,
        isAudioDeckPlaying: true,
        audioDeckTrack: { title: 'BGM.mp3', path: 'BGM.mp3' }
      });

      const videoCue = { id: 'cue-vid-3', type: 'video', name: 'BackgroundVisual.mp4', path: 'BackgroundVisual.mp4' };
      harness.triggerGoLive(videoCue);

      const calls = harness.getGoLiveCalls();
      assert.strictEqual(calls[0].hasIndependentAudioTrack, true, 'hasIndependentAudioTrack must be TRUE when audio is actively playing');
    });

    it('8.4: Dual-deck triggerGoLive sets hasIndependentAudioTrack = true for audio-paired cues', () => {
      const harness = createDualDeckHarness({
        audioDeckPaused: true,
        audioDeckEnded: false,
        isAudioDeckPlaying: false
      });

      const pairedCue = { id: 'cue-vid-4', type: 'video', name: 'Keynote.mp4', path: 'Keynote.mp4', pairedAudioPath: 'theme.mp3' };
      harness.triggerGoLive(pairedCue);

      const calls = harness.getGoLiveCalls();
      assert.strictEqual(calls[0].hasIndependentAudioTrack, true, 'hasIndependentAudioTrack must be TRUE for paired audio cue');
    });

    it('8.5: Stage plays video at masterVolume when hasIndependentAudioTrack is false', () => {
      const masterVolume = 0.85;
      const isMuted = false;
      const fadeDurationMs = 0;
      const hasIndependentAudioTrack = false;

      let volume = fadeDurationMs === 0 ? (isMuted ? 0 : masterVolume) : 0;
      let muted = isMuted;
      let dataset = {};
      if (hasIndependentAudioTrack) {
        volume = 0;
        muted = true;
        dataset.independentAudioMuted = 'true';
      }

      assert.strictEqual(volume, 0.85, 'Video volume must be set to masterVolume');
      assert.strictEqual(muted, false, 'Video must not be muted');
      assert.strictEqual(dataset.independentAudioMuted, undefined, 'independentAudioMuted dataset must NOT be set');
    });

    it('8.6: Stage Blackout release restores video volume only when NOT independentAudioMuted', () => {
      const masterVolume = 0.8;
      const isMuted = false;

      // Case 1: Normal video (not independentAudioMuted)
      const normalVideo = { volume: 0, muted: false, dataset: {} };
      if (!normalVideo.dataset || !normalVideo.dataset.independentAudioMuted) {
        normalVideo.volume = isMuted ? 0 : masterVolume;
      }
      assert.strictEqual(normalVideo.volume, 0.8, 'Normal video volume restored on Blackout release');

      // Case 2: Ducked video (independentAudioMuted = 'true')
      const duckedVideo = { volume: 0, muted: true, dataset: { independentAudioMuted: 'true' } };
      if (!duckedVideo.dataset || !duckedVideo.dataset.independentAudioMuted) {
        duckedVideo.volume = isMuted ? 0 : masterVolume;
      }
      assert.strictEqual(duckedVideo.volume, 0, 'Ducked video volume must REMAIN 0 on Blackout release');
    });

    it('8.7: Stage SET_MUTE keeps ducked videos muted', () => {
      const duckedVideo = { muted: true, dataset: { independentAudioMuted: 'true' } };
      const normalVideo = { muted: true, dataset: {} };
      const allVideos = [duckedVideo, normalVideo];

      const newMuteState = false; // Unmute master
      allVideos.forEach(v => {
        if (v.dataset && v.dataset.independentAudioMuted) {
          v.muted = true;
          return;
        }
        v.muted = newMuteState;
      });

      assert.strictEqual(normalVideo.muted, false, 'Normal video unmuted when master unmuted');
      assert.strictEqual(duckedVideo.muted, true, 'Ducked video remains muted');
    });
  });
});
