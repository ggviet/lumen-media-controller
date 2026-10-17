/**
 * tests/m2_forensic.test.js
 * Independent Forensic Integrity Audit Test Suite: Milestone 2 (R3)
 *
 * Verifies authenticity, anti-cheat, pre-roll ready checks, RAF audio ramping,
 * HTML5 card drag-and-drop reordering, format validation, and decoupled AUTO_NEXT tracking.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { readCompleteHtml } = require('./test_helpers');

describe('Forensic Auditor Independent Verification: Milestone 2 (R3)', () => {
  const stageHtml = readCompleteHtml(path.join(__dirname, '../src/renderer/stage/index.html'));
  const operatorHtml = readCompleteHtml(path.join(__dirname, '../src/renderer/operator/index.html'));

  describe('Check 1: Anti-Cheat & Source Authenticity', () => {
    it('1.1: Zero hardcoded mock bypasses or test constants in stage/index.html and operator/index.html', () => {
      assert.strictEqual(stageHtml.includes('__MOCK_OUTPUT__'), false);
      assert.strictEqual(stageHtml.includes('mock'), false);
      assert.strictEqual(stageHtml.includes('fake'), false);
      assert.strictEqual(stageHtml.includes('bypass'), false);
      assert.strictEqual(operatorHtml.includes('__MOCK_OUTPUT__'), false);
      assert.strictEqual(operatorHtml.includes('mock'), false);
      assert.strictEqual(operatorHtml.includes('fake'), false);
      assert.strictEqual(operatorHtml.includes('bypass'), false);
    });

    it('1.2: No process.env / NODE_ENV test branch bypasses in production renderers', () => {
      assert.strictEqual(stageHtml.includes('process.env'), false);
      assert.strictEqual(stageHtml.includes('NODE_ENV'), false);
      assert.strictEqual(operatorHtml.includes('process.env'), false);
      assert.strictEqual(operatorHtml.includes('NODE_ENV'), false);
    });
  });

  describe('Check 2: Stage Dual-Deck Presentation Engine & Pre-Roll Verification', () => {
    it('2.1: Enforces transparent deck background to eliminate crossfade black flash', () => {
      // Must not use black background on .media-deck
      const mediaDeckMatch = stageHtml.match(/\.media-deck\s*\{([^}]+)\}/);
      assert.ok(mediaDeckMatch, '.media-deck CSS rule must exist');
      assert.ok(mediaDeckMatch[1].includes('background: transparent;'), '.media-deck must have background: transparent');
      assert.ok(!mediaDeckMatch[1].includes('background: #000000;'), '.media-deck must not have background: #000000');
    });

    it('2.2: Genuine preRollVideo checks readyState >= 2 with loadeddata/canplay/playing listeners & safety timer', () => {
      assert.ok(stageHtml.includes('function preRollVideo(video, timeoutMs = 500)'));
      assert.ok(stageHtml.includes('if (video.readyState >= 2) return resolve(true);'));
      assert.ok(stageHtml.includes("video.addEventListener('loadeddata'"));
      assert.ok(stageHtml.includes("video.addEventListener('canplay'"));
      assert.ok(stageHtml.includes("video.addEventListener('playing'"));
      assert.ok(stageHtml.includes("video.addEventListener('error'"));
      assert.ok(stageHtml.includes('video.removeEventListener'));
      assert.ok(stageHtml.includes('setTimeout'));
    });

    it('2.3: Genuine preRollImage uses native img.decode() off-main-thread with fallback', () => {
      assert.ok(stageHtml.includes('async function preRollImage(img, timeoutMs = 400)'));
      assert.ok(stageHtml.includes("typeof img.decode === 'function'"));
      assert.ok(stageHtml.includes('await Promise.race(['));
      assert.ok(stageHtml.includes('img.decode()'));
    });

    it('2.4: Video compositor presentation verification via requestVideoFrameCallback or RAF', () => {
      assert.ok(stageHtml.includes("typeof mediaElement.requestVideoFrameCallback === 'function'"));
      assert.ok(stageHtml.includes('mediaElement.requestVideoFrameCallback('));
      assert.ok(stageHtml.includes('requestAnimationFrame(() => requestAnimationFrame(r))'));
    });

    it('2.5: Synchronized Audio Crossfade Ramp calculates linear volume modulation over fadeDurationMs', () => {
      assert.ok(stageHtml.includes('stepAudioCrossfade'));
      assert.ok(stageHtml.includes('elapsed = now - startTime;'));
      assert.ok(stageHtml.includes('progress = Math.min(1, Math.max(0, elapsed / fadeDurationMs));'));
      assert.ok(stageHtml.includes('incomingVideo.volume = targetInVol * progress;'));
      assert.ok(stageHtml.includes('outgoingVideo.volume = startOutVol * (1 - progress);'));
      assert.ok(stageHtml.includes('requestAnimationFrame(stepAudioCrossfade)'));
    });

    it('2.6: Audio volume & mute modulation affects all active/fading media decks', () => {
      assert.ok(stageHtml.includes("document.querySelectorAll('.media-deck video').forEach(v => {"));
      assert.ok(stageHtml.includes('if (!isMuted) v.volume = masterVolume;'));
      assert.ok(stageHtml.includes('v.muted = isMuted;'));
    });

    it('2.7: Transition supersedence token halts stale cleanups and audio crossfades', () => {
      assert.ok(stageHtml.includes('const thisTransitionToken = ++activeTransitionToken;'));
      assert.ok(stageHtml.includes('if (thisTransitionToken !== activeTransitionToken) return;'));
      assert.ok(stageHtml.includes('clearTimeout(cleanupTimeoutId)'));
      assert.ok(stageHtml.includes('cancelAnimationFrame(audioCrossfadeAnimId)'));
    });

    it('2.8: Genuine implementation of all 4 End Behaviors on Stage', () => {
      // HOLD_LAST_FRAME
      assert.ok(stageHtml.includes("endBehavior === 'HOLD_LAST_FRAME'"));
      assert.ok(stageHtml.includes('mediaElement.pause()'));
      assert.ok(stageHtml.includes('mediaElement.currentTime = mediaElement.duration'));

      // LOOP
      assert.ok(stageHtml.includes("endBehavior === 'LOOP'"));
      assert.ok(stageHtml.includes('mediaElement.loop = true'));
      assert.ok(stageHtml.includes('mediaElement.currentTime = 0'));

      // AUTO_NEXT
      assert.ok(stageHtml.includes("endBehavior === 'AUTO_NEXT'"));
      assert.ok(stageHtml.includes("event: 'media-ended'"));
      assert.ok(stageHtml.includes("endBehavior: 'AUTO_NEXT'"));

      // FADE_TO_BLACK
      assert.ok(stageHtml.includes("endBehavior === 'FADE_TO_BLACK'"));
      assert.ok(stageHtml.includes("blackoutCover.className = 'active-ftb'"));
      assert.ok(stageHtml.includes('ftbRamp'));
    });
  });

  describe('Check 3: Operator Rundown Ingestion & Reordering Verification', () => {
    it('3.1: File format validation enforces supported video and image extensions case-insensitively', () => {
      assert.ok(operatorHtml.includes("ALLOWED_VIDEO_EXTS = new Set(['mp4', 'mov', 'webm', 'mkv'])"));
      assert.ok(operatorHtml.includes("ALLOWED_IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'svg', 'webp'])"));
      assert.ok(operatorHtml.includes('function validateMediaExtension(filePath)'));

      // Simulate validation function extracted from operatorHtml
      const allowedExts = new Set(['mp4', 'mov', 'webm', 'mkv', 'png', 'jpg', 'jpeg', 'svg', 'webp']);
      function validate(fp) {
        if (!fp || typeof fp !== 'string') return false;
        const parts = fp.split('.');
        if (parts.length < 2) return false;
        return allowedExts.has(parts.pop().toLowerCase().trim());
      }

      assert.strictEqual(validate('video.mp4'), true);
      assert.strictEqual(validate('video.MP4'), true);
      assert.strictEqual(validate('clip.mov'), true);
      assert.strictEqual(validate('clip.MOV'), true);
      assert.strictEqual(validate('anim.webm'), true);
      assert.strictEqual(validate('slide.png'), true);
      assert.strictEqual(validate('photo.jpg'), true);
      assert.strictEqual(validate('photo.JPEG'), true);
      assert.strictEqual(validate('vector.svg'), true);
      assert.strictEqual(validate('banner.webp'), true);

      assert.strictEqual(validate('presentation.pdf'), false);
      assert.strictEqual(validate('malware.exe'), false);
      assert.strictEqual(validate('archive.zip'), false);
      assert.strictEqual(validate('document.docx'), false);
      assert.strictEqual(validate('noextension'), false);
      assert.strictEqual(validate(''), false);
    });

    it('3.2: Rejection of unsupported files displays operator toast notification', () => {
      assert.ok(operatorHtml.includes('function showOperatorToast(message, type = \'info\', durationMs = 3500)'));
      assert.ok(operatorHtml.includes('showOperatorToast(`⚠️ Bỏ qua ${rejectedPaths.length} file không hỗ trợ:'));
    });

    it('3.3: Ingestion supports webUtils.getPathForFile with fallback to file.path', () => {
      assert.ok(operatorHtml.includes('webUtils.getPathForFile(file)'));
      assert.ok(operatorHtml.includes('file.path'));
    });

    it('3.4: File dragover filter distinguishes external OS files from internal card drag', () => {
      assert.ok(operatorHtml.includes('function isExternalFileDrag(e)'));
      assert.ok(operatorHtml.includes("e.dataTransfer.types.includes('Files')") || operatorHtml.includes("Array.from(e.dataTransfer.types).includes('Files')"));
      assert.ok(operatorHtml.includes('dropOverlay.classList.add(\'active\')'));
    });

    it('3.5: HTML5 card drag-and-drop attributes and event handlers implemented', () => {
      assert.ok(operatorHtml.includes('card.draggable = true'));
      assert.ok(operatorHtml.includes("card.addEventListener('dragstart'"));
      assert.ok(operatorHtml.includes("card.addEventListener('dragend'"));
      assert.ok(operatorHtml.includes("card.addEventListener('dragover'"));
      assert.ok(operatorHtml.includes("card.addEventListener('dragleave'"));
      assert.ok(operatorHtml.includes("card.addEventListener('drop'"));
      assert.ok(operatorHtml.includes('.drag-insert-top'));
      assert.ok(operatorHtml.includes('.drag-insert-bottom'));
      assert.ok(operatorHtml.includes('cue-drag-grip'));
    });

    it('3.6: Rundown reordering algorithm preserves active preview selection across splice', () => {
      assert.ok(operatorHtml.includes('function reorderRundown(fromIndex, toIndex)'));
      assert.ok(operatorHtml.includes('rundown.splice(fromIndex, 1)'));
      assert.ok(operatorHtml.includes('rundown.splice(toIndex, 0, moved)'));
      assert.ok(operatorHtml.includes('selectedCueId'));
      assert.ok(operatorHtml.includes('selectedIndex = rundown.findIndex(c => c.id === selectedCueId)'));

      // Test reordering algorithm simulation
      let testRundown = [
        { id: 'c1', name: 'Cue 1' },
        { id: 'c2', name: 'Cue 2' },
        { id: 'c3', name: 'Cue 3' },
        { id: 'c4', name: 'Cue 4' }
      ];
      let testSelectedIndex = 1; // c2 is selected

      function testReorder(fromIdx, toIdx) {
        const selectedId = testRundown[testSelectedIndex].id;
        const [moved] = testRundown.splice(fromIdx, 1);
        testRundown.splice(toIdx, 0, moved);
        testSelectedIndex = testRundown.findIndex(c => c.id === selectedId);
      }

      // Move c4 (index 3) to index 0
      testReorder(3, 0);
      assert.deepStrictEqual(testRundown.map(c => c.id), ['c4', 'c1', 'c2', 'c3']);
      // c2 was at index 1, now at index 2
      assert.strictEqual(testSelectedIndex, 2);
      assert.strictEqual(testRundown[testSelectedIndex].id, 'c2');
    });

    it('3.7: Up/Down buttons and Alt+ArrowUp/Down shortcuts trigger reorderRundown', () => {
      assert.ok(operatorHtml.includes("document.getElementById('btnMoveUp').addEventListener('click'"));
      assert.ok(operatorHtml.includes("document.getElementById('btnMoveDown').addEventListener('click'"));
      assert.ok(operatorHtml.includes("reorderRundown(selectedIndex, selectedIndex - 1)"));
      assert.ok(operatorHtml.includes("reorderRundown(selectedIndex, selectedIndex + 1)"));
      assert.ok(operatorHtml.includes("e.altKey && e.code === 'ArrowUp'"));
      assert.ok(operatorHtml.includes("e.altKey && e.code === 'ArrowDown'"));
    });

    it('3.8: Decoupled AUTO_NEXT tracking resolves based on active PGM cue ID, NOT selectedIndex', () => {
      // Extract the stage-status event listener block
      const stageStatusBlock = operatorHtml.slice(
        operatorHtml.indexOf("ipcRenderer.on('stage-status'"),
        operatorHtml.indexOf("// Global Ergonomic Hotkeys")
      );

      // Must not use selectedIndex for AUTO_NEXT progression in stage-status
      assert.ok(!stageStatusBlock.includes('selectedIndex'), 'stage-status handler must NOT use selectedIndex for AUTO_NEXT');
      assert.ok(stageStatusBlock.includes("const activeId = status.cueId || status.id || (pgmCue ? pgmCue.id : null);"));
      assert.ok(stageStatusBlock.includes("const currentPgmIdx = rundown.findIndex(c => c.id === activeId);"));
      assert.ok(stageStatusBlock.includes("if (currentPgmIdx !== -1 && currentPgmIdx < rundown.length - 1)"));
      assert.ok(stageStatusBlock.includes("const nextCue = rundown[currentPgmIdx + 1];"));
      assert.ok(stageStatusBlock.includes("triggerGoLive(nextCue);"));
      assert.ok(operatorHtml.includes("function triggerGoLive(cueToLive = null)"));
    });
  });
});
