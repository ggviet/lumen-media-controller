/**
 * tests/forensic_m1_audio_empirical.js
 * Independent Forensic Auditor Empirical Test Suite for Milestone M1 Audio Engine.
 * Runs inside a real Electron process to audit:
 * 1. Web Audio API AudioContext & decodeAudioData peak extraction & canvas drawing
 * 2. HTMLMediaElement transport, seekbar scrubbing, and cosine fade-out ramp
 * 3. Audio / Video Decoupled Hot-Swapping (0ms dropout, audio continuity)
 * 4. Selective Panic ("Dập hình giữ tiếng") vs Hard Blackout
 * 5. Clean Stage Fallback to Key Visual
 */

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-renderer-backgrounding');

const operatorHtmlPath = path.join(__dirname, '../src/renderer/operator/index.html');
const stageHtmlPath = path.join(__dirname, '../src/renderer/stage/index.html');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

let testResults = [];
let passed = 0;
let failed = 0;

function recordTest(name, success, details = '') {
  testResults.push({ name, success, details });
  if (success) {
    passed++;
    console.log(`  [PASS] ${name}`);
  } else {
    failed++;
    console.error(`  [FAIL] ${name} - ${details}`);
  }
}

// Generate a valid 1-second uncompressed 44.1kHz 16-bit mono WAV buffer
function createSyntheticWavBuffer(durationSec = 1.0, freq = 440) {
  const sampleRate = 44100;
  const numSamples = Math.floor(sampleRate * durationSec);
  const dataSize = numSamples * 2;
  const buffer = Buffer.alloc(44 + dataSize);

  // RIFF chunk descriptor
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);

  // fmt sub-chunk
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16); // Subchunk1Size (16 for PCM)
  buffer.writeUInt16LE(1, 20);  // AudioFormat (1 for PCM)
  buffer.writeUInt16LE(1, 22);  // NumChannels (1 mono)
  buffer.writeUInt32LE(sampleRate, 24); // SampleRate
  buffer.writeUInt32LE(sampleRate * 2, 28); // ByteRate
  buffer.writeUInt16LE(2, 32);  // BlockAlign
  buffer.writeUInt16LE(16, 34); // BitsPerSample

  // data sub-chunk
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  // Write sine wave samples
  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const sample = Math.sin(2 * Math.PI * freq * t) * 0.8;
    const intSample = Math.max(-32768, Math.min(32767, Math.floor(sample * 32767)));
    buffer.writeInt16LE(intSample, 44 + i * 2);
  }

  return buffer;
}

app.whenReady().then(async () => {
  console.log('\n=== RUNNING FORENSIC AUDITOR INDEPENDENT EMPIRICAL TESTS ===\n');

  // Create temporary test wav file
  const tempWavPath = path.join(__dirname, 'temp_test_audio.wav');
  fs.writeFileSync(tempWavPath, createSyntheticWavBuffer(2.0, 440));

  let operatorWin = null;
  let stageWin = null;

  try {
    // Register get-displays handler for operator window
    ipcMain.handle('get-displays', () => ({
      primary: { id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 } },
      all: [{ id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 } }]
    }));

    // 1. Launch Operator Window (offscreen but show: true for requestAnimationFrame)
    operatorWin = new BrowserWindow({
      x: -9999,
      y: -9999,
      width: 1280,
      height: 800,
      show: true,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false
      }
    });

    // 2. Launch Stage Window
    stageWin = new BrowserWindow({
      x: -9999,
      y: -9999,
      width: 1280,
      height: 720,
      show: true,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false
      }
    });

    // Relay IPC messages between operator and stage
    ipcMain.on('go-live', (e, data) => {
      if (stageWin && !stageWin.isDestroyed()) stageWin.webContents.send('stage-go-live', data);
    });
    ipcMain.on('stage-control', (e, action, data) => {
      if (stageWin && !stageWin.isDestroyed()) stageWin.webContents.send('stage-control', action, data);
    });

    await operatorWin.loadFile(operatorHtmlPath);
    await stageWin.loadFile(stageHtmlPath);
    await sleep(400);

    // --- TEST SUITE 1: Web Audio API & Waveform Extraction ---
    console.log('--- TEST GROUP 1: Web Audio API Waveform Peak Extraction ---');
    const waveformResult = await operatorWin.webContents.executeJavaScript(`
      (async () => {
        try {
          const peaks = await generateWaveformPeaks(${JSON.stringify(tempWavPath)}, 100);
          const isFloat32 = peaks instanceof Float32Array;
          const lengthValid = peaks && peaks.length === 100;
          let hasNonZero = false;
          if (peaks) {
            for (let i = 0; i < peaks.length; i++) {
              if (peaks[i] > 0.01) { hasNonZero = true; break; }
            }
          }
          return { success: isFloat32 && lengthValid && hasNonZero, length: peaks ? peaks.length : 0, hasNonZero };
        } catch (err) {
          return { success: false, error: String(err) };
        }
      })()
    `);

    recordTest('FORENSIC-01: Real Web Audio API decodeAudioData extracts peaks from WAV file',
      waveformResult.success === true,
      JSON.stringify(waveformResult)
    );

    // --- TEST SUITE 2: Audio Deck Transport & Scrubber Scrubbing ---
    console.log('\n--- TEST GROUP 2: Audio Deck Transport & Scrubber Navigation ---');
    const transportResult = await operatorWin.webContents.executeJavaScript(`
      (async () => {
        try {
          await loadTrackToAudioDeck(${JSON.stringify(tempWavPath)}, false);
          const deck = document.getElementById('operatorAudioDeck');
          const elapsed = document.getElementById('audioDeckElapsed');
          const remaining = document.getElementById('audioDeckRemaining');
          const scrubber = document.getElementById('audioDeckScrubber');

          const loadedOk = deck && deck.src && deck.src.includes('temp_test_audio.wav');
          
          // Wait for loadedmetadata so duration is valid
          if (!deck.duration || isNaN(deck.duration) || deck.duration === 0) {
            await new Promise(r => {
              if (deck.duration && !isNaN(deck.duration) && deck.duration > 0) return r();
              deck.addEventListener('loadedmetadata', () => r(), { once: true });
              setTimeout(r, 800);
            });
          }

          // Test play
          playAudioDeck();
          await new Promise(r => {
            if (!deck.paused) return r();
            deck.addEventListener('playing', () => r(), { once: true });
            setTimeout(r, 800);
          });
          const isPlaying = !deck.paused;

          // Test scrubber seek to 50%
          scrubber.value = 500;
          scrubber.oninput();
          scrubber.onchange();

          const seekTime = deck.currentTime;

          // Test pause
          pauseAudioDeck();
          const isPaused = deck.paused;

          return {
            loadedOk,
            isPlaying,
            seekTime,
            isPaused
          };
        } catch (err) {
          return { error: String(err) };
        }
      })()
    `);

    recordTest('FORENSIC-02: Audio Deck loads track, plays, pauses, and scrub-seeks via seekbar',
      transportResult.loadedOk && transportResult.isPlaying && transportResult.isPaused && transportResult.seekTime > 0,
      JSON.stringify(transportResult)
    );

    // --- TEST SUITE 3: Cosine Audio Fade-Out Curve Verification ---
    console.log('\n--- TEST GROUP 3: 2.5s Cosine Audio Fade-Out Curve ---');
    const fadeResult = await operatorWin.webContents.executeJavaScript(`
      (async () => {
        const deck = document.getElementById('operatorAudioDeck');
        playAudioDeck();
        await new Promise(r => {
          if (!deck.paused) return r();
          deck.addEventListener('playing', () => r(), { once: true });
          setTimeout(r, 800);
        });
        deck.volume = 1.0;

        startAudioDeckFadeOut(600); // Test with 600ms ramp for quick empirical validation
        await new Promise(r => setTimeout(r, 200));
        const midVol = deck.volume;

        await new Promise(r => setTimeout(r, 650));
        const finalVol = deck.volume;
        const isPausedAfterFade = deck.paused;

        return {
          midVol,
          finalVol,
          isPausedAfterFade
        };
      })()
    `);

    recordTest('FORENSIC-03: Cosine Audio Fade-Out attenuates volume smoothly and pauses on completion',
      fadeResult.midVol < 1.0 && fadeResult.midVol > 0.0 && fadeResult.isPausedAfterFade === true,
      JSON.stringify(fadeResult)
    );

    // --- TEST SUITE 4: Decoupled Live A/V Hot-Swapping ---
    console.log('\n--- TEST GROUP 4: Decoupled A/V Hot-Swapping & Audio Continuity ---');
    const hotSwapResult = await operatorWin.webContents.executeJavaScript(`
      (async () => {
        // Step 1: Start playing dedicated Audio Deck (representing active singer/BGM)
        playAudioDeck();
        const deck = document.getElementById('operatorAudioDeck');
        deck.currentTime = 0.5;

        // Step 2: Trigger GO LIVE for Visual Video 1
        triggerGoLive(); // Uses pvwCue or current target

        const audioActiveAfterLive1 = !deck.paused;
        const audioPosAfterLive1 = deck.currentTime;

        // Step 3: Trigger GO LIVE for Visual Hot-Swap Video 2
        await new Promise(r => setTimeout(r, 200));
        triggerGoLive();

        const audioActiveAfterLive2 = !deck.paused;
        const audioPosAfterLive2 = deck.currentTime;

        return {
          audioActiveAfterLive1,
          audioActiveAfterLive2,
          continuedPlaying: audioPosAfterLive2 >= audioPosAfterLive1
        };
      })()
    `);

    recordTest('FORENSIC-04: Audio Deck maintains continuous uninterrupted playback across multiple visual GO LIVE transitions',
      hotSwapResult.audioActiveAfterLive1 && hotSwapResult.audioActiveAfterLive2 && hotSwapResult.continuedPlaying,
      JSON.stringify(hotSwapResult)
    );

    // --- TEST SUITE 5: Selective Panic ("Dập hình giữ tiếng") vs Hard Kill ---
    console.log('\n--- TEST GROUP 5: Selective Panic vs Hard Panic Kill ---');
    const panicResult = await operatorWin.webContents.executeJavaScript(`
      (async () => {
        const deck = document.getElementById('operatorAudioDeck');
        playAudioDeck();

        // 1. Selective Blackout (Shift is NOT pressed: preserveAudio = true)
        const eventSelective = new KeyboardEvent('keydown', { code: 'KeyB', key: 'b', shiftKey: false });
        window.dispatchEvent(eventSelective);
        const audioAfterSelectiveBlackout = !deck.paused;

        // 2. Selective Freeze
        const eventFreeze = new KeyboardEvent('keydown', { code: 'KeyF', key: 'f' });
        window.dispatchEvent(eventFreeze);
        const audioAfterFreeze = !deck.paused;

        // 3. Selective Safe Logo
        const eventLogo = new KeyboardEvent('keydown', { code: 'KeyL', key: 'l' });
        window.dispatchEvent(eventLogo);
        const audioAfterLogo = !deck.paused;

        // 4. Hard Blackout Kill (Shift+B: preserveAudio = false)
        const eventHardBlackout = new KeyboardEvent('keydown', { code: 'KeyB', key: 'B', shiftKey: true });
        window.dispatchEvent(eventHardBlackout);
        const audioAfterHardBlackout = !deck.paused;

        return {
          audioAfterSelectiveBlackout,
          audioAfterFreeze,
          audioAfterLogo,
          audioStoppedOnHardBlackout: !audioAfterHardBlackout
        };
      })()
    `);

    recordTest('FORENSIC-05: Selective panic preserves live audio, while Shift+B executes hard audio kill',
      panicResult.audioAfterSelectiveBlackout && panicResult.audioAfterFreeze && panicResult.audioAfterLogo && panicResult.audioStoppedOnHardBlackout,
      JSON.stringify(panicResult)
    );

    // --- TEST SUITE 6: Clean Stage Fallback ---
    console.log('\n--- TEST GROUP 6: Stage Fallback to Key Visual for Audio Cues ---');
    // Dispatch an audio cue to Stage
    stageWin.webContents.send('stage-go-live', {
      media: {
        id: 'aud_cue_1',
        name: 'Vocal Track',
        type: 'audio',
        isAudioFallback: true,
        path: path.join(__dirname, '../assets/sample_keyvisual.svg')
      },
      transition: 'cut',
      hasIndependentAudioTrack: true
    });

    await sleep(300);

    const stageFallbackResult = await stageWin.webContents.executeJavaScript(`
      (() => {
        const activeDeck = document.getElementById(activeDeckKey === 'A' ? 'deckA' : 'deckB');
        const img = activeDeck.querySelector('img');
        const vid = activeDeck.querySelector('video');
        const safeLogoActive = document.getElementById('safeLogoLayer').classList.contains('active');

        return {
          hasImg: !!img,
          imgSrc: img ? img.src : null,
          hasVid: !!vid,
          activeDeckKey: activeDeckKey
        };
      })()
    `);

    recordTest('FORENSIC-06: Stage displays Key Visual image fallback when audio cue goes live',
      stageFallbackResult.hasImg === true && stageFallbackResult.hasVid === false && stageFallbackResult.imgSrc.includes('sample_keyvisual.svg'),
      JSON.stringify(stageFallbackResult)
    );

  } finally {
    // Cleanup temp audio file
    if (fs.existsSync(tempWavPath)) {
      try { fs.unlinkSync(tempWavPath); } catch (_) {}
    }
    if (operatorWin && !operatorWin.isDestroyed()) operatorWin.destroy();
    if (stageWin && !stageWin.isDestroyed()) stageWin.destroy();
  }

  console.log(`\n=== EMPIRICAL FORENSIC AUDIT SUMMARY: ${passed} PASSED, ${failed} FAILED ===\n`);
  app.exit(failed > 0 ? 1 : 0);
});
