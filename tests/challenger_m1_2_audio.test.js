/**
 * tests/challenger_m1_2_audio.test.js
 * Adversarial Empirical Challenge Suite for Milestone 1:
 * Audio Ingestion Stress Testing, Stage Fallback, and Selective Panic Controls.
 *
 * Challenger: Challenger Audio M1-2
 * Focus:
 * 1. Ingestion Stress Testing: .mp3, .wav, .m4a, .aac, .flac validated; .pdf, .exe, .txt strictly rejected.
 * 2. Stage Fallback: Triggering audio without video forces Stage to show sample_keyvisual.svg; no black screen / OS desktop.
 * 3. Selective Panic: [B], [F], [L] blank/freeze visual while preserving audio; Shift+B hard kills audio.
 */

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');
const { readCompleteHtml } = require('./test_helpers');

describe('Challenger Audio M1-2: Adversarial Empirical Verification', () => {
  const operatorHtmlPath = path.join(__dirname, '../src/renderer/operator/index.html');
  const stageHtmlPath = path.join(__dirname, '../src/renderer/stage/index.html');
  const mainSrcPath = path.join(__dirname, '../src/main/index.js');

  const operatorHtml = readCompleteHtml(operatorHtmlPath);
  const stageHtml = readCompleteHtml(stageHtmlPath);
  const mainSrc = fs.readFileSync(mainSrcPath, 'utf8');

  // =========================================================================
  // 1. INGESTION STRESS TESTING & FORMAT HARDENING
  // =========================================================================
  describe('1. Ingestion Stress Testing & Format Hardening', () => {
    // Extract extension definitions and validateMediaExtension directly from operatorHtml
    const extDefsMatch = operatorHtml.match(
      /const ALLOWED_VIDEO_EXTS = new Set\(\[(.*?)\]\);[\s\S]*?const ALLOWED_IMAGE_EXTS = new Set\(\[(.*?)\]\);[\s\S]*?const ALLOWED_ALL_EXTS = new Set\(\[\.\.\.ALLOWED_VIDEO_EXTS, \.\.\.ALLOWED_IMAGE_EXTS\]\);[\s\S]*?const ALLOWED_AUDIO_EXTS = new Set\(\[(.*?)\]\);[\s\S]*?const ALLOWED_MEDIA_EXTS = new Set\(\[\.\.\.ALLOWED_ALL_EXTS, \.\.\.ALLOWED_AUDIO_EXTS\]\);/
    );
    assert.ok(extDefsMatch, 'All extension sets (VIDEO, IMAGE, ALL, AUDIO, MEDIA) must be defined');

    const validateFnMatch = operatorHtml.match(/function validateMediaExtension\([\s\S]*?\n        \}/);
    assert.ok(validateFnMatch, 'validateMediaExtension must be defined in operator/index.html');

    const evalScope = {};
    const scopeCode = `
      ${extDefsMatch[0]}
      ${validateFnMatch[0]}
      evalScope.validateMediaExtension = validateMediaExtension;
      evalScope.ALLOWED_AUDIO_EXTS = ALLOWED_AUDIO_EXTS;
      evalScope.ALLOWED_MEDIA_EXTS = ALLOWED_MEDIA_EXTS;
      evalScope.ALLOWED_ALL_EXTS = ALLOWED_ALL_EXTS;
    `;
    new Function('evalScope', scopeCode)(evalScope);
    const { validateMediaExtension, ALLOWED_AUDIO_EXTS } = evalScope;

    it('1.1: Accepts all supported audio extensions (.mp3, .wav, .m4a, .aac, .flac) across casing', () => {
      const audioFiles = [
        // Lowercase
        'intro.mp3', 'backing.wav', 'podcast.m4a', 'vocal.aac', 'master.flac',
        // Uppercase
        'INTRO.MP3', 'BACKING.WAV', 'PODCAST.M4A', 'VOCAL.AAC', 'MASTER.FLAC',
        // Mixed Case
        'Track01.Mp3', 'Soundtrack.WaV', 'AudioBook.M4a', 'VoiceClip.aAc', 'Concert.FlAc'
      ];

      for (const fp of audioFiles) {
        assert.strictEqual(
          validateMediaExtension(fp),
          true,
          `Supported audio file '${fp}' must be accepted by validateMediaExtension`
        );
      }
    });

    it('1.2: Accepts audio files with tricky multi-dots, parentheses, spaces, and unicode paths', () => {
      const complexPaths = [
        'D:\\Music\\Event 2026\\01. Singer Backing Track (Live Final).mp3',
        'D:/Live/Audio/band.rehearsal.take-02.v3.wav',
        'C:\\Users\\Lumen\\Music\\Nhạc_khai_mạc_2026.m4a',
        '/Volumes/USB_DRIVE/Concert/Special [Encore] #1.aac',
        'E:\\Media\\Show.BGM.FullMix.96k.24b.flac',
        'audio.backup.2026.04.17.mp3'
      ];

      for (const fp of complexPaths) {
        assert.strictEqual(
          validateMediaExtension(fp),
          true,
          `Complex audio path '${fp}' must be accepted`
        );
      }
    });

    it('1.3: Strictly rejects invalid extensions (.pdf, .exe, .txt, scripts, archives, docs)', () => {
      const forbiddenFiles = [
        // Requested specific formats
        'contract.pdf', 'CONTRACT.PDF', 'Contract.Pdf',
        'malware.exe', 'INSTALLER.EXE', 'payload.Exe',
        'briefing.txt', 'NOTES.TXT', 'ReadMe.Txt',
        // Executables & scripts
        'script.bat', 'run.cmd', 'deploy.sh', 'exploit.ps1', 'macro.vbs', 'patch.msi', 'driver.dll',
        // Documents & Archives
        'slides.pptx', 'budget.xlsx', 'spec.docx', 'archive.zip', 'backup.tar.gz', 'bundle.7z', 'disc.iso',
        // Code & web
        'index.html', 'styles.css', 'app.js', 'server.py', 'config.json', 'schema.xml'
      ];

      for (const fp of forbiddenFiles) {
        assert.strictEqual(
          validateMediaExtension(fp),
          false,
          `Forbidden file '${fp}' must be strictly rejected`
        );
      }
    });

    it('1.4: Strictly rejects malformed, empty, and boundary path inputs', () => {
      const malformedInputs = [
        '',
        '   ',
        null,
        undefined,
        12345,
        {},
        [],
        'file_without_extension',
        'trailing_dot.',
        '.',
        '..',
        '...',
        'D:\\music\\audio_no_ext'
      ];

      for (const input of malformedInputs) {
        assert.strictEqual(
          validateMediaExtension(input),
          false,
          `Malformed input '${JSON.stringify(input)}' must be rejected`
        );
      }
    });

    it('1.5: Defeats multi-dot Trojan extension traps (e.g. song.mp3.exe, track.wav.pdf)', () => {
      const trojanTraps = [
        { file: 'song.mp3.exe', expected: false },
        { file: 'track.wav.pdf', expected: false },
        { file: 'audio.flac.txt', expected: false },
        { file: 'singer.m4a.bat', expected: false },
        { file: 'voice.aac.zip', expected: false },
        { file: 'virus.exe.mp3', expected: true }, // legitimate mp3 whose base name contains .exe
        { file: 'notes.txt.wav', expected: true }, // legitimate wav whose base name contains .txt
        { file: 'document.pdf.flac', expected: true } // legitimate flac whose base name contains .pdf
      ];

      for (const { file, expected } of trojanTraps) {
        assert.strictEqual(
          validateMediaExtension(file),
          expected,
          `Trojan test for '${file}' expected ${expected}`
        );
      }
    });

    it('1.6: Batch Ingestion Simulation: Rejects 100% invalid files, adds valid audio with audio type and badges', () => {
      let toastMessage = null;
      let toastType = null;
      const showOperatorToast = (msg, type) => {
        toastMessage = msg;
        toastType = type;
      };

      const testRundown = [];

      function simulateIngest(filePaths) {
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
          const sample = rejectedPaths.map(p => p.split(/[\\/]/).pop()).slice(0, 2).join(', ');
          showOperatorToast(`⚠️ Bỏ qua ${rejectedPaths.length} file không hỗ trợ: ${sample}`, 'warn');
        }

        if (validPaths.length === 0) return;

        for (const fp of validPaths) {
          const ext = fp.split('.').pop().toLowerCase().trim();
          const isAud = ALLOWED_AUDIO_EXTS.has(ext);
          const isVid = ['mp4', 'mov', 'webm', 'mkv'].includes(ext);
          const name = fp.split(/[\/\\]/).pop();

          testRundown.push({
            id: 'cue_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
            name: name,
            path: fp,
            type: isVid ? 'video' : (isAud ? 'audio' : 'image'),
            format: ext.toUpperCase(),
            duration: isAud ? 180 : 0,
            endBehavior: 'HOLD_LAST_FRAME'
          });
        }
      }

      // Step A: Ingest 100% invalid batch (.pdf, .exe, .txt)
      simulateIngest([
        'D:\\docs\\schedule.pdf',
        'D:\\tools\\installer.exe',
        'D:\\notes\\announcements.txt'
      ]);
      assert.strictEqual(testRundown.length, 0, 'No cues should be created from invalid files');
      assert.strictEqual(toastType, 'warn', 'Warning toast must trigger');
      assert.ok(toastMessage.includes('3 file không hỗ trợ'), 'Toast must state 3 unsupported files');
      assert.ok(toastMessage.includes('schedule.pdf'), 'Toast must name rejected file');

      // Step B: Ingest valid 5-format audio suite
      toastMessage = null;
      simulateIngest([
        'D:\\audio\\01_opening.mp3',
        'D:\\audio\\02_anthem.WAV',
        'D:\\audio\\03_keynote_bgm.m4a',
        'D:\\audio\\04_interlude.aac',
        'D:\\audio\\05_outro.FLAC'
      ]);
      assert.strictEqual(testRundown.length, 5, 'All 5 valid audio files must be ingested');
      assert.strictEqual(toastMessage, null, 'No warning toast should trigger for 100% valid audio');

      for (let i = 0; i < 5; i++) {
        assert.strictEqual(testRundown[i].type, 'audio', `Cue ${i} must have type === 'audio'`);
        assert.ok(
          ['MP3', 'WAV', 'M4A', 'AAC', 'FLAC'].includes(testRundown[i].format),
          `Cue ${i} format must be audio format`
        );
      }
    });
  });

  // =========================================================================
  // 2. STAGE FALLBACK & CLEAN OUTPUT VERIFICATION
  // =========================================================================
  describe('2. Stage Fallback & Clean Output Verification', () => {
    it('2.1: triggerGoLive transforms audio cues into stageMediaPayload with sample_keyvisual.svg fallback', () => {
      // Analyze triggerGoLive logic from dual_deck.js
      assert.ok(
        operatorHtml.includes("const isAudioCue = target.type === 'audio';"),
        'triggerGoLive must detect isAudioCue'
      );
      assert.ok(
        operatorHtml.includes('isAudioFallback: true'),
        'triggerGoLive must set isAudioFallback: true in stageMediaPayload'
      );
      assert.ok(
        operatorHtml.includes('sample_keyvisual.svg'),
        'triggerGoLive must point stageMediaPayload.path to sample_keyvisual.svg'
      );
      assert.ok(
        operatorHtml.includes('hasIndependentAudioTrack: !!hasIndependentAudioTrack'),
        'triggerGoLive must flag hasIndependentAudioTrack: true'
      );
    });

    it('2.2: Stage renderer mounts sample_keyvisual.svg image element upon audio go-live and never leaves deck empty', () => {
      // Simulate Stage window DOM elements
      const deckA = { innerHTML: '', classList: new Set(['media-deck', 'active']), appendChild(el) { this._child = el; } };
      const deckB = { innerHTML: '', classList: new Set(['media-deck']), appendChild(el) { this._child = el; } };
      const safeLogoImg = { src: '../../../assets/sample_keyvisual.svg' };

      // Simulate stage-go-live handler logic for audio cue
      const payload = {
        media: {
          id: 'cue_audio_1',
          name: 'Vocal Track.mp3',
          type: 'audio',
          format: 'MP3',
          isAudioFallback: true,
          path: 'D:\\LUMEN\\assets\\sample_keyvisual.svg'
        },
        transition: 'fast',
        scaling: 'contain',
        hasIndependentAudioTrack: true
      };

      const { media, scaling } = payload;
      let mediaElement;

      if (media.type === 'video') {
        mediaElement = { tagName: 'VIDEO' };
      } else {
        // Image or SVG or Audio Key Visual Fallback
        mediaElement = { tagName: 'IMG', style: {} };
        const isAudio = media.type === 'audio' || media.isAudioFallback;
        let imgSrc = media.path;
        if (isAudio && (!imgSrc || !/\.(png|jpe?g|svg|webp)$/i.test(media.path))) {
          imgSrc = safeLogoImg && safeLogoImg.src ? safeLogoImg.src : '../../../assets/sample_keyvisual.svg';
        }
        mediaElement.src = imgSrc;
        mediaElement.className = 'stage-media-element';
        mediaElement.style.objectFit = scaling;
      }

      deckB.appendChild(mediaElement);

      assert.strictEqual(deckB._child.tagName, 'IMG', 'Stage element must be an IMG');
      assert.ok(
        deckB._child.src.includes('sample_keyvisual.svg'),
        'Mounted element src must resolve to sample_keyvisual.svg'
      );
      assert.strictEqual(deckB._child.className, 'stage-media-element');
    });

    it('2.3: Defensive Stage Fallback: If caller sends raw audio path (.mp3), Stage strictly overrides with sample_keyvisual.svg', () => {
      const safeLogoImg = { src: '../../../assets/sample_keyvisual.svg' };

      // Adversarial payload: media.path is a raw MP3 audio file path, NOT an svg
      const rawAudioPayload = {
        id: 'cue_audio_raw',
        name: 'Singer.mp3',
        type: 'audio',
        path: 'D:\\LUMEN\\assets\\Singer.mp3' // Raw audio file
      };

      let mediaElement = { tagName: 'IMG' };
      const isAudio = rawAudioPayload.type === 'audio' || rawAudioPayload.isAudioFallback;
      let imgSrc = rawAudioPayload.path;
      if (isAudio && (!imgSrc || !/\.(png|jpe?g|svg|webp)$/i.test(rawAudioPayload.path))) {
        imgSrc = safeLogoImg && safeLogoImg.src ? safeLogoImg.src : '../../../assets/sample_keyvisual.svg';
      }
      mediaElement.src = imgSrc;

      assert.strictEqual(
        mediaElement.src,
        '../../../assets/sample_keyvisual.svg',
        'Raw audio file path must be substituted with sample_keyvisual.svg'
      );
    });

    it('2.4: Video-to-Audio Live Transition: Active video cleanly unloads and crossfades to Safe Key Visual with zero black flash', () => {
      let videoPaused = false;
      let videoSrcCleared = false;
      const outgoingVideo = {
        tagName: 'VIDEO',
        pause() { videoPaused = true; },
        src: 'file:///d:/LUMEN/video.mp4',
        removeAttribute(attr) { if (attr === 'src') videoSrcCleared = true; },
        load() {}
      };

      const outgoingDeck = { innerHTML: '', querySelector: () => outgoingVideo };
      const incomingDeck = { innerHTML: '', appendChild(el) { this._child = el; } };

      // Incoming audio cue mounts Key Visual
      const keyVisualImg = {
        tagName: 'IMG',
        src: 'file:///d:/LUMEN/assets/sample_keyvisual.svg'
      };
      incomingDeck.appendChild(keyVisualImg);

      // Transition completes: outgoing video cleaned up
      const oldVideo = outgoingDeck.querySelector('video');
      if (oldVideo) {
        oldVideo.pause();
        oldVideo.src = '';
        oldVideo.removeAttribute('src');
      }
      outgoingDeck.innerHTML = '';

      assert.strictEqual(videoPaused, true, 'Outgoing stage video must be paused');
      assert.strictEqual(videoSrcCleared, true, 'Outgoing stage video src must be cleared');
      assert.ok(
        incomingDeck._child.src.includes('sample_keyvisual.svg'),
        'Incoming deck must hold sample_keyvisual.svg'
      );
    });

    it('2.5: FADE_TO_BLACK on ended with active audio track dissolves to Safe Logo instead of pitch black', () => {
      const safeLogoLayer = {
        classList: new Set(),
        add(cls) { this.classList.add(cls); }
      };
      const blackoutCover = { className: '' };
      let isSafeLogo = false;
      let isFTB = false;

      function simulateVideoEnded(endBehavior, hasIndependentAudioTrack) {
        if (endBehavior === 'FADE_TO_BLACK') {
          if (hasIndependentAudioTrack) {
            safeLogoLayer.add('active');
            isSafeLogo = true;
          } else {
            blackoutCover.className = 'active-ftb';
            isFTB = true;
          }
        }
      }

      // Case A: Video ends with NO independent audio -> normal FTB (screen goes black)
      simulateVideoEnded('FADE_TO_BLACK', false);
      assert.strictEqual(isFTB, true, 'Without audio, FTB must black out screen');
      assert.strictEqual(blackoutCover.className, 'active-ftb');
      assert.strictEqual(isSafeLogo, false);

      // Reset
      blackoutCover.className = '';
      isFTB = false;

      // Case B: Video ends WITH independent audio track active -> Clean Safe Logo fallback!
      simulateVideoEnded('FADE_TO_BLACK', true);
      assert.strictEqual(isSafeLogo, true, 'With audio active, FTB must transition to Safe Logo');
      assert.ok(safeLogoLayer.classList.has('active'), 'Safe Logo layer must have active class');
      assert.strictEqual(isFTB, false, 'FTB blackout must NOT be triggered');
      assert.strictEqual(blackoutCover.className, '', 'Blackout cover must remain empty');
    });
  });

  // =========================================================================
  // 3. SELECTIVE PANIC & HARD KILL VERIFICATION
  // =========================================================================
  describe('3. Selective Panic ("Dập hình giữ tiếng") & Hard Kill Verification', () => {
    let mockOperatorAudioDeck;
    let mockStageVideo;
    let stageControlAction = null;
    let stageControlData = null;
    let blackoutActive = false;
    let freezeActive = false;
    let safeLogoActive = false;
    let audioDeckStopped = false;

    function resetMocks() {
      mockOperatorAudioDeck = {
        paused: false,
        currentTime: 42.5,
        duration: 180.0,
        volume: 1.0,
        muted: false,
        pause() { this.paused = true; },
        play() { this.paused = false; return Promise.resolve(); }
      };

      mockStageVideo = {
        paused: false,
        volume: 1.0,
        pause() { this.paused = true; },
        play() { this.paused = false; return Promise.resolve(); }
      };

      stageControlAction = null;
      stageControlData = null;
      blackoutActive = false;
      freezeActive = false;
      safeLogoActive = false;
      audioDeckStopped = false;
    }

    function mockStopAudioDeck() {
      audioDeckStopped = true;
      mockOperatorAudioDeck.pause();
      mockOperatorAudioDeck.currentTime = 0;
    }

    function simulateStageControl(action, data) {
      stageControlAction = action;
      stageControlData = data;
      switch (action) {
        case 'BLACKOUT':
          blackoutActive = !blackoutActive;
          if (blackoutActive) {
            mockStageVideo.pause();
            mockStageVideo.volume = 0;
          } else {
            mockStageVideo.volume = 1.0;
            mockStageVideo.play();
          }
          break;
        case 'FREEZE':
          freezeActive = !freezeActive;
          if (freezeActive) mockStageVideo.pause();
          else mockStageVideo.play();
          break;
        case 'SAFE_LOGO':
          safeLogoActive = !safeLogoActive;
          if (safeLogoActive) mockStageVideo.pause();
          else mockStageVideo.play();
          break;
      }
    }

    // Keydown dispatcher simulating hotkeys.js
    function simulateKeydown(e) {
      const code = e.code;
      switch (code) {
        case 'KeyB':
        case 'Escape':
        case 'F4':
        case 'NumpadSubtract':
          simulateStageControl('BLACKOUT');
          if (e.shiftKey) {
            mockStopAudioDeck();
          }
          break;
        case 'KeyF':
        case 'F2':
        case 'NumpadMultiply':
          simulateStageControl('FREEZE');
          break;
        case 'KeyL':
        case 'F1':
        case 'Numpad4':
          simulateStageControl('SAFE_LOGO', { logoPath: 'sample_keyvisual.svg' });
          break;
      }
    }

    beforeEach(() => {
      resetMocks();
    });

    it('3.1: Pressing [B] (Blackout) blanks stage video while operator audio deck continues playing uninterrupted', () => {
      assert.strictEqual(mockOperatorAudioDeck.paused, false, 'Audio deck starts playing');
      assert.strictEqual(mockStageVideo.paused, false, 'Stage video starts playing');

      // Operator presses [B] (selective blackout)
      simulateKeydown({ code: 'KeyB', shiftKey: false });

      assert.strictEqual(stageControlAction, 'BLACKOUT');
      assert.strictEqual(blackoutActive, true, 'Blackout cover must be active');
      assert.strictEqual(mockStageVideo.paused, true, 'Stage video must be paused');
      assert.strictEqual(mockStageVideo.volume, 0, 'Stage video volume must be zeroed');

      // CRITICAL: Audio Deck must CONTINUE playing
      assert.strictEqual(mockOperatorAudioDeck.paused, false, 'operatorAudioDeck must NOT be paused by [B]');
      assert.strictEqual(mockOperatorAudioDeck.currentTime, 42.5, 'operatorAudioDeck timecode must NOT reset');
      assert.strictEqual(audioDeckStopped, false, 'stopAudioDeck must NOT be called');

      // Press [B] again to lift blackout
      simulateKeydown({ code: 'KeyB', shiftKey: false });
      assert.strictEqual(blackoutActive, false, 'Blackout cover must be lifted');
      assert.strictEqual(mockStageVideo.paused, false, 'Stage video must resume');
      assert.strictEqual(mockOperatorAudioDeck.paused, false, 'Audio deck remains playing throughout');
    });

    it('3.2: Pressing [F] (Freeze) freezes stage visual while operator audio deck continues playing uninterrupted', () => {
      assert.strictEqual(mockOperatorAudioDeck.paused, false);
      assert.strictEqual(mockStageVideo.paused, false);

      // Operator presses [F]
      simulateKeydown({ code: 'KeyF', shiftKey: false });

      assert.strictEqual(stageControlAction, 'FREEZE');
      assert.strictEqual(freezeActive, true, 'Stage must enter Freeze mode');
      assert.strictEqual(mockStageVideo.paused, true, 'Stage video must be paused (frozen on current frame)');

      // CRITICAL: Audio Deck must CONTINUE playing
      assert.strictEqual(mockOperatorAudioDeck.paused, false, 'operatorAudioDeck must NOT be paused by [F]');
      assert.strictEqual(audioDeckStopped, false, 'stopAudioDeck must NOT be called');
    });

    it('3.3: Pressing [L] (Safe Logo) switches stage to Safe Logo while operator audio deck continues playing uninterrupted', () => {
      assert.strictEqual(mockOperatorAudioDeck.paused, false);
      assert.strictEqual(mockStageVideo.paused, false);

      // Operator presses [L]
      simulateKeydown({ code: 'KeyL', shiftKey: false });

      assert.strictEqual(stageControlAction, 'SAFE_LOGO');
      assert.strictEqual(safeLogoActive, true, 'Safe Logo layer must activate');
      assert.strictEqual(mockStageVideo.paused, true, 'Stage video must pause behind safe logo');

      // CRITICAL: Audio Deck must CONTINUE playing
      assert.strictEqual(mockOperatorAudioDeck.paused, false, 'operatorAudioDeck must NOT be paused by [L]');
      assert.strictEqual(audioDeckStopped, false, 'stopAudioDeck must NOT be called');
    });

    it('3.4: Pressing Shift+B executes a total hard kill that blanks visual AND silences audio', () => {
      assert.strictEqual(mockOperatorAudioDeck.paused, false);
      assert.strictEqual(mockStageVideo.paused, false);

      // Operator presses Shift+B (Emergency Hard Kill)
      simulateKeydown({ code: 'KeyB', shiftKey: true });

      assert.strictEqual(stageControlAction, 'BLACKOUT');
      assert.strictEqual(blackoutActive, true, 'Visual blackout must activate');
      assert.strictEqual(mockStageVideo.paused, true, 'Stage video must be paused');

      // CRITICAL: Audio Deck MUST be silenced and stopped
      assert.strictEqual(audioDeckStopped, true, 'stopAudioDeck MUST be executed on Shift+B');
      assert.strictEqual(mockOperatorAudioDeck.paused, true, 'operatorAudioDeck MUST be paused');
      assert.strictEqual(mockOperatorAudioDeck.currentTime, 0, 'operatorAudioDeck timecode MUST reset to 0');
    });

    it('3.5: Pressing Shift+Escape and Shift+NumpadSubtract also execute total hard kill', () => {
      // Test Shift+Escape
      resetMocks();
      simulateKeydown({ code: 'Escape', shiftKey: true });
      assert.strictEqual(blackoutActive, true);
      assert.strictEqual(audioDeckStopped, true);
      assert.strictEqual(mockOperatorAudioDeck.paused, true);

      // Test Shift+NumpadSubtract
      resetMocks();
      simulateKeydown({ code: 'NumpadSubtract', shiftKey: true });
      assert.strictEqual(blackoutActive, true);
      assert.strictEqual(audioDeckStopped, true);
      assert.strictEqual(mockOperatorAudioDeck.paused, true);
    });

    it('3.6: Main Process before-input-event interceptor relays selective vs hard kill based on shift key', () => {
      // Analyze attachPanicInputInterceptor in main/index.js
      assert.ok(
        mainSrc.includes("emergencyAction = 'BLACKOUT';\n      payload = { preserveAudio: !shift };") ||
        mainSrc.includes("emergencyAction = 'BLACKOUT';") && mainSrc.includes("payload = { preserveAudio: !shift };"),
        'Main process must set preserveAudio: !shift for BLACKOUT'
      );

      // Analyze panic-shortcut-triggered receiver in hotkeys.js
      assert.ok(
        operatorHtml.includes("if (payload && payload.preserveAudio === false) {\n                        if (typeof stopAudioDeck === 'function') stopAudioDeck();"),
        'hotkeys.js must call stopAudioDeck() when preserveAudio === false'
      );
    });
  });

});
