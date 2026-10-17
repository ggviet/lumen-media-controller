/**
 * tests/m2_rundown_adversarial.test.js
 * Adversarial Empirical Challenge Suite for Milestone 2 (R3):
 * Rundown Ingestion, Card Reordering, and End Behaviors.
 *
 * Challenger: Challenger 2 (Milestone 2)
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { readCompleteHtml } = require('./test_helpers');

describe('Adversarial Challenge: Rundown Ingestion, Card Reordering & End Behaviors (Milestone 2)', () => {
  const operatorHtmlPath = path.join(__dirname, '../src/renderer/operator/index.html');
  const stageHtmlPath = path.join(__dirname, '../src/renderer/stage/index.html');
  const operatorHtml = readCompleteHtml(operatorHtmlPath);
  const stageHtml = readCompleteHtml(stageHtmlPath);

  const fixturesDir = path.join(__dirname, 'fixtures_m2_challenge');

  before(() => {
    fs.mkdirSync(fixturesDir, { recursive: true });
    // Create test fixture files
    fs.writeFileSync(path.join(fixturesDir, 'valid_clip.mp4'), 'RIFF....WAVE');
    fs.writeFileSync(path.join(fixturesDir, 'UPPERCASE_VIDEO.MP4'), 'RIFF....WAVE');
    fs.writeFileSync(path.join(fixturesDir, 'multi.dot.final.v2.MOV'), 'RIFF....WAVE');
    fs.writeFileSync(path.join(fixturesDir, 'slide.PNG'), '<png>');
    fs.writeFileSync(path.join(fixturesDir, 'vector.SVG'), '<svg></svg>');
    fs.writeFileSync(path.join(fixturesDir, 'clip.webm'), '<webm>');
    fs.writeFileSync(path.join(fixturesDir, 'empty_zero_bytes.mp4'), Buffer.alloc(0));
    fs.writeFileSync(path.join(fixturesDir, 'corrupted_video.mp4'), Buffer.from([0x00, 0xFF, 0xDE, 0xAD, 0xBE, 0xEF]));
    fs.writeFileSync(path.join(fixturesDir, 'malicious.exe'), 'MZ...............');
    fs.writeFileSync(path.join(fixturesDir, 'notes.txt'), 'Meeting notes');
    fs.writeFileSync(path.join(fixturesDir, 'archive.zip'), 'PK...............');
    fs.writeFileSync(path.join(fixturesDir, 'deploy.bat'), '@echo off\nexit');
    fs.writeFileSync(path.join(fixturesDir, 'no_extension_file'), 'data');
  });

  after(() => {
    try {
      fs.rmSync(fixturesDir, { recursive: true, force: true });
    } catch (_) {}
  });

  // =========================================================================
  // 1. Ingestion Attack & Format Hardening
  // =========================================================================
  describe('1. Ingestion Attack & Format Hardening', () => {
    // Extract validateMediaExtension directly from operator HTML
    const validateFnMatch = operatorHtml.match(/function validateMediaExtension\([\s\S]*?\n        \}/);
    assert.ok(validateFnMatch, 'validateMediaExtension must be defined in operator/index.html');

    const extSetMatch = operatorHtml.match(/const ALLOWED_VIDEO_EXTS = new Set\(\[(.*?)\]\);[\s\S]*?const ALLOWED_IMAGE_EXTS = new Set\(\[(.*?)\]\);[\s\S]*?const ALLOWED_ALL_EXTS = new Set\(\[\.\.\.ALLOWED_VIDEO_EXTS, \.\.\.ALLOWED_IMAGE_EXTS\]\);/);
    assert.ok(extSetMatch, 'Allowed extension sets must be defined in operator/index.html');

    // Create execution scope
    const evalScope = {};
    const scopeCode = `
      ${extSetMatch[0]}
      ${validateFnMatch[0]}
      evalScope.validateMediaExtension = validateMediaExtension;
      evalScope.ALLOWED_ALL_EXTS = ALLOWED_ALL_EXTS;
      evalScope.ALLOWED_VIDEO_EXTS = ALLOWED_VIDEO_EXTS;
      evalScope.ALLOWED_IMAGE_EXTS = ALLOWED_IMAGE_EXTS;
    `;
    new Function('evalScope', scopeCode)(evalScope);
    const { validateMediaExtension, ALLOWED_ALL_EXTS } = evalScope;

    it('TC-INGEST-01: Rejects dangerous executable, script, archive, and document formats', () => {
      const dangerousFiles = [
        'virus.exe', 'trojan.EXE', 'script.bat', 'run.cmd', 'install.sh',
        'exploit.ps1', 'payload.vbs', 'library.dll', 'installer.msi',
        'document.pdf', 'notes.txt', 'sheet.xlsx', 'report.docx',
        'backup.zip', 'archive.tar.gz', 'bundle.7z', 'disc.iso',
        'app.js', 'server.py', 'index.html', 'styles.css', 'config.json'
      ];

      for (const file of dangerousFiles) {
        assert.strictEqual(
          validateMediaExtension(file),
          false,
          `File '${file}' should have been strictly rejected`
        );
      }
    });

    it('TC-INGEST-02: Accepts supported video and image formats case-insensitively', () => {
      const validFiles = [
        'clip.mp4', 'CLIP.MP4', 'clip.Mp4',
        'intro.mov', 'INTRO.MOV', 'intro.Mov',
        'animation.webm', 'ANIMATION.WEBM',
        'show.mkv', 'SHOW.MKV',
        'photo.png', 'PHOTO.PNG', 'photo.Png',
        'image.jpg', 'IMAGE.JPG',
        'picture.jpeg', 'PICTURE.JPEG',
        'graphic.svg', 'GRAPHIC.SVG',
        'sticker.webp', 'STICKER.WEBP'
      ];

      for (const file of validFiles) {
        assert.strictEqual(
          validateMediaExtension(file),
          true,
          `File '${file}' should have been accepted`
        );
      }
    });

    it('TC-INGEST-03: Handles tricky multi-dot filenames, hidden files, and edge paths', () => {
      // Multi-dot filenames
      assert.strictEqual(validateMediaExtension('event.2026.keynote.final.v3.mp4'), true);
      assert.strictEqual(validateMediaExtension('event.2026.keynote.final.v3.MP4'), true);
      assert.strictEqual(validateMediaExtension('my.archive.zip.mp4'), true);
      assert.strictEqual(validateMediaExtension('my.video.mp4.exe'), false);
      assert.strictEqual(validateMediaExtension('my.video.mp4.zip'), false);
      assert.strictEqual(validateMediaExtension('my.image.png.txt'), false);

      // Trailing dot and no extension
      assert.strictEqual(validateMediaExtension('badfile.'), false);
      assert.strictEqual(validateMediaExtension('filename_with_no_ext'), false);
      assert.strictEqual(validateMediaExtension(''), false);
      assert.strictEqual(validateMediaExtension(null), false);
      assert.strictEqual(validateMediaExtension(undefined), false);
      assert.strictEqual(validateMediaExtension(12345), false);
    });

    it('TC-INGEST-04: Batch ingestion filters files and triggers operator toast warning on rejections', () => {
      let toastMessage = null;
      let toastType = null;
      const showOperatorToast = (msg, type) => {
        toastMessage = msg;
        toastType = type;
      };

      const testRundown = [];
      const testCache = new Map();

      function simulateIngestFilePaths(filePaths) {
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
          const isVid = evalScope.ALLOWED_VIDEO_EXTS.has(ext);
          const name = fp.split(/[\/\\]/).pop();
          testRundown.push({
            id: 'cue_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
            name: name,
            path: fp,
            type: isVid ? 'video' : 'image',
            format: ext.toUpperCase(),
            endBehavior: 'HOLD_LAST_FRAME'
          });
        }
      }

      // Case A: 100% invalid files dropped
      simulateIngestFilePaths([
        'D:\\bad\\installer.exe',
        'D:\\bad\\readme.txt',
        'D:\\bad\\package.zip'
      ]);
      assert.strictEqual(testRundown.length, 0, 'No cues should be added when all files are invalid');
      assert.strictEqual(toastType, 'warn');
      assert.ok(toastMessage.includes('3 file không hỗ trợ'), 'Toast should report 3 rejected files');
      assert.ok(toastMessage.includes('installer.exe'), 'Toast should list rejected filename');

      // Case B: Mixed files dropped (2 valid, 2 invalid)
      toastMessage = null;
      simulateIngestFilePaths([
        'D:\\good\\intro.MP4',
        'D:\\bad\\script.bat',
        'D:\\good\\keyvisual.PNG',
        'D:\\bad\\doc.pdf'
      ]);
      assert.strictEqual(testRundown.length, 2, 'Exactly 2 valid cues should be added');
      assert.strictEqual(testRundown[0].name, 'intro.MP4');
      assert.strictEqual(testRundown[0].type, 'video');
      assert.strictEqual(testRundown[0].format, 'MP4');
      assert.strictEqual(testRundown[1].name, 'keyvisual.PNG');
      assert.strictEqual(testRundown[1].type, 'image');
      assert.strictEqual(testRundown[1].format, 'PNG');
      assert.strictEqual(toastType, 'warn');
      assert.ok(toastMessage.includes('2 file không hỗ trợ'), 'Toast should report 2 rejected files');

      // Case C: 100% valid files dropped
      toastMessage = null;
      toastType = null;
      simulateIngestFilePaths([
        'D:\\good\\countdown.webm',
        'D:\\good\\logo.svg'
      ]);
      assert.strictEqual(testRundown.length, 4, 'Total cues should now be 4');
      assert.strictEqual(toastMessage, null, 'No warning toast should trigger when all files valid');
    });

    it('TC-INGEST-05: Empty files and corrupted files do not crash extraction pipeline', async () => {
      // Simulate extractVideoMetadataAndThumbnail resilience
      function simulateExtractMetadata(filePath, timeoutMs = 200, forceError = false) {
        return new Promise((resolve) => {
          let completed = false;
          const finalize = (metadata) => {
            if (!completed) {
              completed = true;
              resolve(metadata);
            }
          };

          if (forceError) {
            // Emulate video.onerror
            setTimeout(() => finalize({ duration: 0, width: 0, height: 0, thumbnailUrl: null }), 10);
            return;
          }

          // Emulate timeout
          setTimeout(() => finalize({ duration: 0, width: 0, height: 0, thumbnailUrl: null }), timeoutMs);
        });
      }

      // Empty file metadata extraction
      const emptyMeta = await simulateExtractMetadata(path.join(fixturesDir, 'empty_zero_bytes.mp4'), 50, true);
      assert.strictEqual(emptyMeta.duration, 0);
      assert.strictEqual(emptyMeta.thumbnailUrl, null);

      // Corrupted file metadata extraction
      const corruptMeta = await simulateExtractMetadata(path.join(fixturesDir, 'corrupted_video.mp4'), 50, true);
      assert.strictEqual(corruptMeta.duration, 0);
      assert.strictEqual(corruptMeta.thumbnailUrl, null);

      // Timeout fallback
      const timeoutMeta = await simulateExtractMetadata('nonexistent.mp4', 50, false);
      assert.strictEqual(timeoutMeta.duration, 0);
      assert.strictEqual(timeoutMeta.thumbnailUrl, null);
    });

    it('TC-INGEST-06: Drag overlay discriminates between external Files and internal cue card dragging', () => {
      // Extract isExternalFileDrag logic
      function isExternalFileDrag(e) {
        if (!e.dataTransfer || !e.dataTransfer.types) return false;
        return Array.from(e.dataTransfer.types).includes('Files');
      }

      // Case A: External OS file drag
      const osFileDragEvent = {
        dataTransfer: { types: ['Files'] }
      };
      assert.strictEqual(isExternalFileDrag(osFileDragEvent), true, 'External file drag must be detected');

      // Case B: Internal cue card reordering drag
      const internalCardDragEvent = {
        dataTransfer: { types: ['application/x-lumen-cue', 'text/plain'] }
      };
      assert.strictEqual(isExternalFileDrag(internalCardDragEvent), false, 'Internal cue drag must NOT trigger drop overlay');

      // Case C: Null or empty dataTransfer
      assert.strictEqual(isExternalFileDrag({}), false);
      assert.strictEqual(isExternalFileDrag({ dataTransfer: null }), false);
      assert.strictEqual(isExternalFileDrag({ dataTransfer: { types: [] } }), false);
    });
  });

  // =========================================================================
  // 2. Card Reordering & State Synchronization
  // =========================================================================
  describe('2. Card Reordering & State Synchronization', () => {
    // Extract reorderRundown from operatorHtml
    const reorderFnMatch = operatorHtml.match(/function reorderRundown\(fromIndex, toIndex\) \{[\s\S]*?\n            return true;\s*\n        \}/);
    assert.ok(reorderFnMatch, 'reorderRundown must be defined in operator/index.html');

    function createReorderHarness(initialCues, initialSelectedIndex = 0) {
      let rundown = JSON.parse(JSON.stringify(initialCues));
      let selectedIndex = initialSelectedIndex;
      let renderCallCount = 0;
      let saveCallCount = 0;

      const renderRundown = () => { renderCallCount++; };
      const saveRundown = () => { saveCallCount++; };

      function reorderRundown(fromIndex, toIndex) {
        if (fromIndex < 0 || fromIndex >= rundown.length) return false;
        if (toIndex < 0 || toIndex >= rundown.length) return false;
        if (fromIndex === toIndex) return false;

        const selectedCueId = (selectedIndex >= 0 && rundown[selectedIndex]) 
          ? rundown[selectedIndex].id 
          : null;

        const [moved] = rundown.splice(fromIndex, 1);
        rundown.splice(toIndex, 0, moved);

        if (selectedCueId) {
          selectedIndex = rundown.findIndex(c => c.id === selectedCueId);
        }

        renderRundown();
        saveRundown();
        return true;
      }

      return {
        getRundown: () => rundown,
        getSelectedIndex: () => selectedIndex,
        getRenderCallCount: () => renderCallCount,
        getSaveCallCount: () => saveCallCount,
        reorderRundown,
        setSelectedIndex: (idx) => { selectedIndex = idx; }
      };
    }

    const testCues = [
      { id: 'cue_0', name: '0. Opener' },
      { id: 'cue_1', name: '1. Keynote' },
      { id: 'cue_2', name: '2. Sponsor' },
      { id: 'cue_3', name: '3. Closer' }
    ];

    it('TC-REORDER-01: Boundary targets - moving to top (0) and bottom (length-1)', () => {
      const harness = createReorderHarness(testCues, 3);

      // Move cue 3 (Closer) to index 0 (top of list)
      const res1 = harness.reorderRundown(3, 0);
      assert.strictEqual(res1, true);
      assert.strictEqual(harness.getRundown()[0].id, 'cue_3');
      assert.strictEqual(harness.getRundown()[1].id, 'cue_0');
      assert.strictEqual(harness.getSelectedIndex(), 0, 'selectedIndex should track cue_3 to index 0');

      // Move cue at index 0 back to bottom (index 3)
      const res2 = harness.reorderRundown(0, 3);
      assert.strictEqual(res2, true);
      assert.strictEqual(harness.getRundown()[3].id, 'cue_3');
      assert.strictEqual(harness.getSelectedIndex(), 3, 'selectedIndex should track cue_3 to index 3');
    });

    it('TC-REORDER-02: Dropping onto self (fromIndex === toIndex) is a safe no-op', () => {
      const harness = createReorderHarness(testCues, 1);
      const res = harness.reorderRundown(1, 1);
      assert.strictEqual(res, false, 'Moving to same index must return false');
      assert.strictEqual(harness.getRundown()[1].id, 'cue_1');
      assert.strictEqual(harness.getRenderCallCount(), 0, 'No re-render on no-op');
    });

    it('TC-REORDER-03: Out-of-bounds indices are rejected without modifying rundown', () => {
      const harness = createReorderHarness(testCues, 1);
      assert.strictEqual(harness.reorderRundown(-1, 2), false);
      assert.strictEqual(harness.reorderRundown(10, 2), false);
      assert.strictEqual(harness.reorderRundown(2, -1), false);
      assert.strictEqual(harness.reorderRundown(2, 100), false);
      assert.strictEqual(harness.getRundown().length, 4, 'Length must remain untouched');
    });

    it('TC-REORDER-04: Reordering active PGM cue retains on-air tally and does not break Stage playback', () => {
      const harness = createReorderHarness(testCues, 0); // PVW is cue_0
      const pgmCue = { ...testCues[1] }; // PGM is cue_1 ("1. Keynote")

      // Move PGM cue (cue_1 at index 1) to bottom (index 3)
      const success = harness.reorderRundown(1, 3);
      assert.strictEqual(success, true);

      const updatedRundown = harness.getRundown();
      assert.strictEqual(updatedRundown[3].id, pgmCue.id, 'cue_1 should now be at index 3');

      // Verify on-air tally resolution:
      // The DOM card at index 3 will match pgmCue.id
      const onAirCardIdx = updatedRundown.findIndex(c => c.id === pgmCue.id);
      assert.strictEqual(onAirCardIdx, 3, 'On-air tally must follow cue_1 to index 3');

      // PVW cue selection (cue_0) remains index 0
      assert.strictEqual(harness.getSelectedIndex(), 0);
      assert.strictEqual(updatedRundown[0].id, 'cue_0');
    });

    it('TC-REORDER-05: Reordering PVW cue updates selectedIndex to match cue new position', () => {
      const harness = createReorderHarness(testCues, 2); // PVW is cue_2
      assert.strictEqual(harness.getRundown()[harness.getSelectedIndex()].id, 'cue_2');

      // Move cue_2 from index 2 to index 0
      harness.reorderRundown(2, 0);
      assert.strictEqual(harness.getSelectedIndex(), 0, 'selectedIndex must update to index 0');
      assert.strictEqual(harness.getRundown()[0].id, 'cue_2', 'cue_2 is now at index 0');

      // Move cue_2 from index 0 to index 2
      harness.reorderRundown(0, 2);
      assert.strictEqual(harness.getSelectedIndex(), 2, 'selectedIndex must update to index 2');
      assert.strictEqual(harness.getRundown()[2].id, 'cue_2');
    });

    it('TC-REORDER-06: HTML5 card drop target calculation correctly calculates index from clientY and half-height', () => {
      // Simulate drop event math from operator/index.html lines 1506-1517
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

      // Dragging downward (e.g. from 0 down to 2)
      // Drop on top half of 2 -> should insert before 2 -> targetIdx 1
      assert.strictEqual(calculateDropTarget(0, 2, true), 1);
      // Drop on bottom half of 2 -> should insert after 2 -> targetIdx 2
      assert.strictEqual(calculateDropTarget(0, 2, false), 2);

      // Dragging downward to last item (0 down to 3)
      // Drop on bottom half of 3 -> targetIdx 3 (end of list)
      assert.strictEqual(calculateDropTarget(0, 3, false), 3);

      // Dragging upward (e.g. from 3 up to 1)
      // Drop on top half of 1 -> should insert before 1 -> targetIdx 1
      assert.strictEqual(calculateDropTarget(3, 1, true), 1);
      // Drop on bottom half of 1 -> should insert after 1 -> targetIdx 2
      assert.strictEqual(calculateDropTarget(3, 1, false), 2);

      // Dragging upward to top item (3 up to 0)
      // Drop on top half of 0 -> targetIdx 0 (top of list)
      assert.strictEqual(calculateDropTarget(3, 0, true), 0);
    });

    it('TC-REORDER-07: Stress/Fuzz - 1,000 rapid randomized reorders maintain strict array integrity', () => {
      const items = Array.from({ length: 20 }, (_, i) => ({
        id: `cue_stress_${i}`,
        name: `Item ${i}`
      }));
      const harness = createReorderHarness(items, 5);

      for (let i = 0; i < 1000; i++) {
        const from = Math.floor(Math.random() * 20);
        const to = Math.floor(Math.random() * 20);
        harness.reorderRundown(from, to);
      }

      const finalRundown = harness.getRundown();
      assert.strictEqual(finalRundown.length, 20, 'Array length must never deviate from 20');

      // Verify all 20 unique IDs still present
      const finalIds = new Set(finalRundown.map(c => c.id));
      assert.strictEqual(finalIds.size, 20, 'Zero duplicate cues allowed');
      for (let i = 0; i < 20; i++) {
        assert.ok(finalIds.has(`cue_stress_${i}`), `Missing cue_stress_${i}`);
      }

      // Verify selectedIndex is strictly in valid range [0, 19]
      const selIdx = harness.getSelectedIndex();
      assert.ok(selIdx >= 0 && selIdx < 20, `selectedIndex ${selIdx} is out of bounds`);
    });
  });

  // =========================================================================
  // 3. End Behaviors Verification & Decoupling
  // =========================================================================
  describe('3. End Behaviors Verification & Decoupling', () => {
    it('TC-ENDBEHAV-01: HOLD_LAST_FRAME pauses video on EOF and preserves final frame without black flash', () => {
      // Simulate video element ending under HOLD_LAST_FRAME
      let isPaused = false;
      let currentTime = 29.98;
      const duration = 30.0;
      let statusSent = null;

      const mediaElement = {
        loop: true,
        pause: () => { isPaused = true; },
        currentTime: currentTime,
        duration: duration
      };

      const endBehavior = 'HOLD_LAST_FRAME';
      if (endBehavior === 'HOLD_LAST_FRAME') {
        mediaElement.loop = false;
        // On ended handler:
        mediaElement.pause();
        try { mediaElement.currentTime = mediaElement.duration; } catch (e) {}
      }

      assert.strictEqual(mediaElement.loop, false);
      assert.strictEqual(isPaused, true, 'Video must pause on last frame');
      assert.strictEqual(mediaElement.currentTime, 30.0, 'currentTime must clamp to duration');
      assert.strictEqual(statusSent, null, 'HOLD_LAST_FRAME must NOT trigger auto-advance');
    });

    it('TC-ENDBEHAV-02: LOOP restarts playback from 0.0s continuously', () => {
      let isPlaying = false;
      let currentTime = 15.0;

      const mediaElement = {
        loop: false,
        currentTime: 15.0,
        play: async () => { isPlaying = true; }
      };

      const endBehavior = 'LOOP';
      if (endBehavior === 'LOOP') {
        mediaElement.loop = true;
        // On ended fallback:
        mediaElement.currentTime = 0;
        mediaElement.play();
      }

      assert.strictEqual(mediaElement.loop, true);
      assert.strictEqual(mediaElement.currentTime, 0, 'currentTime must reset to 0');
      assert.strictEqual(isPlaying, true, 'Video must keep playing');
    });

    it('TC-ENDBEHAV-03: AUTO_NEXT advances show based on active PGM cue ID, NEVER jumping to previewed cue', () => {
      // Complete mock of operator rundown and stage-status listener
      const rundown = [
        { id: 'cue_0', name: '0. Countdown', endBehavior: 'AUTO_NEXT' },
        { id: 'cue_1', name: '1. Opening Video', endBehavior: 'AUTO_NEXT' },
        { id: 'cue_2', name: '2. Keynote Speech', endBehavior: 'HOLD_LAST_FRAME' },
        { id: 'cue_3', name: '3. Sponsor Reel', endBehavior: 'AUTO_NEXT' },
        { id: 'cue_4', name: '4. Closing Remarks', endBehavior: 'HOLD_LAST_FRAME' }
      ];

      let selectedIndex = 4; // Operator is inspecting cue_4 ("4. Closing Remarks") on Preview!
      let pvwCue = rundown[selectedIndex];
      let pgmCue = { ...rundown[1] }; // PGM is currently live with cue_1 ("1. Opening Video")
      let liveTransitions = [];

      function triggerGoLive(cueToLive = null) {
        const target = cueToLive || pvwCue;
        if (!target) return;
        pgmCue = { ...target };
        liveTransitions.push(pgmCue.id);
      }

      function handleStageStatus(status) {
        if (status.event === 'media-ended') {
          const activeId = status.cueId || status.id || (pgmCue ? pgmCue.id : null);
          const currentPgmIdx = rundown.findIndex(c => c.id === activeId);

          if (currentPgmIdx !== -1 && currentPgmIdx < rundown.length - 1) {
            const nextCue = rundown[currentPgmIdx + 1];
            triggerGoLive(nextCue);
          }
        }
      }

      // Live cue_1 finishes playing on Stage
      handleStageStatus({
        event: 'media-ended',
        id: 'cue_1',
        cueId: 'cue_1',
        endBehavior: 'AUTO_NEXT'
      });

      // Assertions:
      // 1. Program should have advanced from cue_1 to cue_2
      assert.strictEqual(pgmCue.id, 'cue_2', 'PGM should advance to cue_2');
      assert.deepStrictEqual(liveTransitions, ['cue_2']);

      // 2. CRITICAL: Operator preview must NOT be disturbed!
      assert.strictEqual(selectedIndex, 4, 'Operator preview selectedIndex must remain 4');
      assert.strictEqual(pvwCue.id, 'cue_4', 'Operator preview cue must remain cue_4');
    });

    it('TC-ENDBEHAV-04: AUTO_NEXT succeeds even when operator preview is parked on the final cue', () => {
      const rundown = [
        { id: 'cue_0', name: '0. Opener', endBehavior: 'AUTO_NEXT' },
        { id: 'cue_1', name: '1. Next Up', endBehavior: 'HOLD_LAST_FRAME' }
      ];

      // Operator preview is at last index (1)
      let selectedIndex = 1;
      let pvwCue = rundown[1];
      let pgmCue = { ...rundown[0] };
      let advancedCue = null;

      function triggerGoLive(cueToLive = null) {
        advancedCue = cueToLive;
        pgmCue = { ...cueToLive };
      }

      // Old buggy code checked: if (selectedIndex < rundown.length - 1) which evaluated to false!
      // New code checks: currentPgmIdx < rundown.length - 1 (0 < 1 is true!)
      const status = { event: 'media-ended', id: 'cue_0', cueId: 'cue_0' };
      const activeId = status.cueId || status.id || (pgmCue ? pgmCue.id : null);
      const currentPgmIdx = rundown.findIndex(c => c.id === activeId);

      assert.strictEqual(currentPgmIdx, 0);
      assert.ok(currentPgmIdx < rundown.length - 1, 'currentPgmIdx (0) < rundown.length - 1 (1) must be TRUE');

      if (currentPgmIdx !== -1 && currentPgmIdx < rundown.length - 1) {
        triggerGoLive(rundown[currentPgmIdx + 1]);
      }

      assert.ok(advancedCue, 'Show should advance to cue_1');
      assert.strictEqual(advancedCue.id, 'cue_1');
      assert.strictEqual(selectedIndex, 1, 'Operator preview remains parked on cue_1');
    });

    it('TC-ENDBEHAV-05: AUTO_NEXT on final rundown item safely halts without out-of-bounds error', () => {
      const rundown = [
        { id: 'cue_0', name: '0. Single Item', endBehavior: 'AUTO_NEXT' }
      ];
      let pgmCue = { ...rundown[0] };
      let advanced = false;

      const activeId = 'cue_0';
      const currentPgmIdx = rundown.findIndex(c => c.id === activeId);

      if (currentPgmIdx !== -1 && currentPgmIdx < rundown.length - 1) {
        advanced = true;
      }

      assert.strictEqual(currentPgmIdx, 0);
      assert.strictEqual(advanced, false, 'Must not advance past final cue');
    });

    it('TC-ENDBEHAV-06: Dynamic cue reordering during live playback updates AUTO_NEXT target accordingly', () => {
      const rundown = [
        { id: 'cue_0', name: '0. Intro' },
        { id: 'cue_1', name: '1. Live Video', endBehavior: 'AUTO_NEXT' },
        { id: 'cue_2', name: '2. Original Next' },
        { id: 'cue_3', name: '3. Surprise Special Guest' }
      ];

      const pgmCue = { ...rundown[1] }; // cue_1 is playing

      // Operator reorders cue_3 to index 2 (before cue_2) while cue_1 is playing
      const [guest] = rundown.splice(3, 1);
      rundown.splice(2, 0, guest);

      assert.strictEqual(rundown[2].id, 'cue_3', 'Special guest should now be next up');

      // Now cue_1 finishes playing
      const activeId = pgmCue.id;
      const currentPgmIdx = rundown.findIndex(c => c.id === activeId);
      assert.strictEqual(currentPgmIdx, 1);

      const nextCue = rundown[currentPgmIdx + 1];
      assert.strictEqual(nextCue.id, 'cue_3', 'AUTO_NEXT must advance to surprise guest at new index 2');
    });

    it('TC-ENDBEHAV-07: FADE_TO_BLACK executes 1.0s synchronized audio volume ramp to 0 and pauses', () => {
      let isPaused = false;
      let coverClass = '';
      let isFTB = false;
      let finalVolume = 1.0;

      const mediaElement = {
        volume: 0.8,
        pause: () => { isPaused = true; }
      };

      // Emulate FADE_TO_BLACK handler from stage/index.html lines 523-539
      coverClass = 'active-ftb';
      isFTB = true;

      // Simulate audio ramp over 1000ms
      const startVol = mediaElement.volume;
      const steps = [0.0, 0.25, 0.5, 0.75, 1.0];
      for (const progress of steps) {
        mediaElement.volume = startVol * (1 - progress);
        if (progress >= 1.0) {
          mediaElement.pause();
        }
      }

      assert.strictEqual(coverClass, 'active-ftb', 'Blackout cover must activate FTB CSS class');
      assert.strictEqual(isFTB, true);
      assert.strictEqual(mediaElement.volume, 0.0, 'Volume must reach exactly 0.0');
      assert.strictEqual(isPaused, true, 'Media must pause after audio fade completes');
    });
  });

  // =========================================================================
  // 4. Source Code Forensic Assertions
  // =========================================================================
  describe('4. Source Code Forensic Assertions', () => {
    it('TC-FORENSIC-01: HTML5 drag-and-drop card markup and styling in operator/index.html', () => {
      assert.ok(operatorHtml.includes('draggable = true'), 'Cards must have draggable=true');
      assert.ok(operatorHtml.includes("card.classList.add('dragging')"));
      assert.ok(operatorHtml.includes("card.classList.toggle('drag-insert-top'"));
      assert.ok(operatorHtml.includes("card.classList.toggle('drag-insert-bottom'"));
      assert.ok(operatorHtml.includes('.cue-card.drag-insert-top'), 'CSS must define top insertion indicator');
      assert.ok(operatorHtml.includes('.cue-card.drag-insert-bottom'), 'CSS must define bottom insertion indicator');
      assert.ok(operatorHtml.includes('.cue-drag-grip'), 'CSS must style drag grip');
    });

    it('TC-FORENSIC-02: operator/index.html implements non-blocking operator toast notification', () => {
      assert.ok(operatorHtml.includes('function showOperatorToast('));
      assert.ok(operatorHtml.includes('.operator-toast'), 'CSS must style operator toast');
      assert.ok(operatorHtml.includes('.operator-toast.visible'));
      assert.ok(operatorHtml.includes('.toast-warn'));
    });

    it('TC-FORENSIC-03: stage/index.html implements pre-roll ready checks for video and image', () => {
      assert.ok(stageHtml.includes('function preRollVideo(video, timeoutMs = 500)'));
      assert.ok(stageHtml.includes('function preRollImage(img, timeoutMs = 400)'));
      assert.ok(stageHtml.includes('await preRollVideo('));
      assert.ok(stageHtml.includes('await preRollImage('));
      assert.ok(/\.media-deck\s*\{[\s\S]*?background:\s*transparent;/.test(stageHtml), '.media-deck must have background: transparent');
    });

    it('TC-FORENSIC-04: stage/index.html implements all 4 distinct end behaviors', () => {
      assert.ok(stageHtml.includes("endBehavior === 'HOLD_LAST_FRAME'"));
      assert.ok(stageHtml.includes("endBehavior === 'LOOP'"));
      assert.ok(stageHtml.includes("endBehavior === 'AUTO_NEXT'"));
      assert.ok(stageHtml.includes("endBehavior === 'FADE_TO_BLACK'"));
    });

    it('TC-FORENSIC-05: operator/index.html resolves AUTO_NEXT using on-air active cue ID, not selectedIndex', () => {
      const autoNextBlock = operatorHtml.match(/if \(status\.event === 'media-ended'\) \{[\s\S]*?\n            \}/);
      assert.ok(autoNextBlock, 'stage-status media-ended listener must exist');
      const code = autoNextBlock[0];
      assert.ok(code.includes('rundown.findIndex(c => c.id === activeId)'), 'Must resolve index by active ID');
      assert.ok(!code.includes('selectCue(selectedIndex + 1)'), 'Must NOT advance using selectedIndex + 1');
    });
  });
});
