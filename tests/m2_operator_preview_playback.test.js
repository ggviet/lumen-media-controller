const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { readCompleteHtml } = require('./test_helpers');

describe('Milestone 2: Operator Preview Playback Engine & Transport Scrubber', () => {
  const operatorHtml = readCompleteHtml(path.join(__dirname, '../src/renderer/operator/index.html'));
  const stageHtml = readCompleteHtml(path.join(__dirname, '../src/renderer/stage/index.html'));

  it('TC-PVW-01: toMediaUrl helper exists and converts Windows paths with spaces, unicode, and special chars to valid file URLs', () => {
    assert.ok(operatorHtml.includes('function toMediaUrl(filePath)'), 'toMediaUrl function must be declared in operator');
    assert.ok(stageHtml.includes('function toMediaUrl(filePath)'), 'toMediaUrl function must be declared in stage');

    // Extract function implementation from operatorHtml
    const match = operatorHtml.match(/function toMediaUrl\(filePath\)\s*\{([\s\S]*?)\n        \}/);
    assert.ok(match, 'toMediaUrl function body must match');
    const toMediaUrl = new Function('filePath', match[1]);

    // Test URL conversions
    const normalPath = 'D:\\LUMEN\\assets\\video.mp4';
    const spacesPath = 'D:\\Events\\Tech Summit 2026\\clip.mp4';
    const vietnamesePath = 'D:\\LUMEN\\Video sự kiện\\intro.mp4';
    const specialCharsPath = 'D:\\Videos\\Show #1 (100%).mp4';
    const alreadyUrl = 'file:///C:/test.mp4';

    assert.ok(toMediaUrl(normalPath).startsWith('file:///'), 'Normal path must produce file:/// URL');
    assert.ok(toMediaUrl(spacesPath).includes('%20'), 'Spaces must be encoded to %20');
    assert.ok(toMediaUrl(vietnamesePath).startsWith('file:///'), 'Vietnamese paths must resolve to valid file URL');
    assert.ok(toMediaUrl(specialCharsPath).includes('%23'), '# must be encoded as %23 to avoid hash fragment cutoff');
    assert.ok(toMediaUrl(specialCharsPath).includes('%25'), '% must be encoded as %25');
    assert.strictEqual(toMediaUrl(alreadyUrl), alreadyUrl, 'Pre-formatted file:// URLs must be preserved');
    assert.strictEqual(toMediaUrl(''), '', 'Empty string must return empty');
    assert.strictEqual(toMediaUrl(null), '', 'Null must return empty');
  });

  it('TC-PVW-02: loadPvw resets transport controls and synchronizes video events', () => {
    assert.ok(operatorHtml.includes("btnPvwPlayPause.innerText = '▶ Play'"), 'Must reset Play button label');
    assert.ok(operatorHtml.includes("pvwScrubber.value = 0"), 'Must reset scrubber value');
    assert.ok(operatorHtml.includes("video.preload = 'auto'"), 'Must set preload auto for responsive playback');
    assert.ok(operatorHtml.includes("video.playsInline = true"), 'Must set playsInline true');
    assert.ok(operatorHtml.includes("video.onloadedmetadata"), 'Must handle onloadedmetadata');
    assert.ok(operatorHtml.includes("video.ontimeupdate"), 'Must handle ontimeupdate');
    assert.ok(operatorHtml.includes("video.onplay"), 'Must handle onplay event');
    assert.ok(operatorHtml.includes("video.onpause"), 'Must handle onpause event');
    assert.ok(operatorHtml.includes("video.onended"), 'Must handle onended event');
    assert.ok(operatorHtml.includes("video.onerror"), 'Must handle video load error');
  });

  it('TC-PVW-03: Preview play button handles promise rejection without freezing button state', () => {
    assert.ok(operatorHtml.includes('playPromise.then('), 'Must handle play promise resolution');
    assert.ok(operatorHtml.includes('.catch('), 'Must handle play promise rejection');
    assert.ok(operatorHtml.includes("showOperatorToast"), 'Must notify user via toast on video play error');
  });

  it('TC-PVW-04: Scrubber dragging supports smooth bidirectional seeking', () => {
    assert.ok(operatorHtml.includes('pvwScrubber.oninput'), 'Must handle scrubber oninput for live seeking');
    assert.ok(operatorHtml.includes('pvwScrubber.onchange'), 'Must handle scrubber onchange');
    assert.ok(operatorHtml.includes('isScrubbing'), 'Must guard against scrubber jitter during active scrubbing');
  });

  it('TC-PVW-05: PGM Program mirror provides fallback live timer when stage is disconnected or single-monitor', () => {
    assert.ok(operatorHtml.includes('vid.ontimeupdate'), 'PGM mirror video must have local ontimeupdate fallback');
    assert.ok(operatorHtml.includes('pgmElapsed.innerText = formatTime'), 'Must update pgmElapsed timer');
    assert.ok(operatorHtml.includes('pgmRemaining.innerText = formatTime'), 'Must update pgmRemaining countdown');
  });
});
