/**
 * tests/empirical_m2_it3_audio_runner.js
 * Electron-native empirical test runner for Milestone 2 Iteration 3
 * Audio Dynamics: Crossfade volume modulation without transient pops & steady-state responsiveness.
 *
 * Challenger 1 (Milestone 2 Iteration 3)
 */

const { app, BrowserWindow } = require('electron');
const path = require('path');
const { readCompleteHtml } = require('./test_helpers');

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-renderer-backgrounding');

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

async function runEmpiricalAudioSuite(win) {
  console.log('\n=== RUNNING ELECTRON-NATIVE M2 IT3 AUDIO DYNAMICS SUITE ===');

  // Setup initial state: Insert a video in Deck A at masterVolume = 1.0
  await win.webContents.executeJavaScript(`
    (() => {
      masterVolume = 1.0;
      isMuted = false;
      const deckA = document.getElementById('deckA');
      deckA.innerHTML = '';
      const vA = document.createElement('video');
      vA.className = 'stage-media-element';
      vA.volume = 1.0;
      deckA.appendChild(vA);
      activeDeckKey = 'A';
      return true;
    })()
  `);

  // Phase 1: Start 1.6s Slow transition from Deck A to Deck B
  console.log('  1. Initiating 1.6s Slow crossfade from Deck A to Deck B...');
  win.webContents.send('stage-go-live', {
    media: { id: 'vid2', name: 'Video 2', type: 'video', path: 'dummy_video.mp4' },
    transition: 'slow'
  });

  // Await start of audio crossfade loop deterministically
  await win.webContents.executeJavaScript(`
    new Promise(resolve => {
      const check = setInterval(() => {
        if (audioCrossfadeAnimId) {
          clearInterval(check);
          resolve(true);
        }
      }, 20);
    })
  `);

  // Wait 700ms to reach ~45-50% of 1600ms slow fade
  await sleep(700);

  const midFadeBefore = await win.webContents.executeJavaScript(`
    (() => {
      const vA = document.getElementById('deckA').querySelector('video');
      const vB = document.getElementById('deckB').querySelector('video');
      return {
        vAVol: vA ? vA.volume : null,
        vBVol: vB ? vB.volume : null,
        audioCrossfadeAnimId: !!audioCrossfadeAnimId,
        masterVolume: masterVolume
      };
    })()
  `);

  console.log('  Mid-fade state before volume reduction:', midFadeBefore);

  recordTest('CHAL-IT3-01: Crossfade is actively animating with audioCrossfadeAnimId set',
    midFadeBefore.audioCrossfadeAnimId === true &&
    midFadeBefore.vAVol !== null && midFadeBefore.vBVol !== null,
    JSON.stringify(midFadeBefore)
  );

  // Phase 2: Mid-Transition Volume Drop (1.0 -> 0.3)
  console.log('  2. Dispatching SET_VOLUME drop to 0.3 mid-crossfade...');
  win.webContents.send('stage-control', 'SET_VOLUME', { volume: 0.3 });

  // IMMEDIATELY inspect volumes right after SET_VOLUME (synchronous check before next RAF)
  const immediateAfterDrop = await win.webContents.executeJavaScript(`
    (() => {
      const vA = document.getElementById('deckA').querySelector('video');
      const vB = document.getElementById('deckB').querySelector('video');
      return {
        vAVol: vA ? vA.volume : null,
        vBVol: vB ? vB.volume : null,
        sum: (vA ? vA.volume : 0) + (vB ? vB.volume : 0),
        masterVolume: masterVolume
      };
    })()
  `);

  console.log('  Immediate state after SET_VOLUME (0.3):', immediateAfterDrop);

  // In Iteration 3, the video elements must NOT jump directly to 0.3 (which would cause sum = 0.6)
  const didNotDirectlySnap = Math.abs(immediateAfterDrop.vAVol - 0.3) > 0.05 ||
                             Math.abs(immediateAfterDrop.vBVol - 0.3) > 0.05;

  recordTest('CHAL-IT3-02: Video elements did NOT directly snap to masterVolume upon SET_VOLUME (Guard Active)',
    didNotDirectlySnap && immediateAfterDrop.masterVolume === 0.3,
    `Immediate volumes: vA=${immediateAfterDrop.vAVol}, vB=${immediateAfterDrop.vBVol}, masterVolume=${immediateAfterDrop.masterVolume}`
  );

  // Wait 120ms for RAF frames to apply smooth scaling
  await sleep(120);

  const subsequentRafDrop = await win.webContents.executeJavaScript(`
    (() => {
      const vA = document.getElementById('deckA').querySelector('video');
      const vB = document.getElementById('deckB').querySelector('video');
      return {
        vAVol: vA ? vA.volume : null,
        vBVol: vB ? vB.volume : null,
        sum: (vA ? vA.volume : 0) + (vB ? vB.volume : 0),
        masterVolume: masterVolume
      };
    })()
  `);

  console.log('  Subsequent RAF state after drop (should sum to ~0.3):', subsequentRafDrop);

  recordTest('CHAL-IT3-03: Subsequent RAF frames smoothly scale deck volumes to sum to new masterVolume (0.3)',
    Math.abs(subsequentRafDrop.sum - 0.3) < 0.05,
    `Observed sum: ${subsequentRafDrop.sum}, expected ~0.3`
  );

  // Phase 3: Mid-Transition Volume Rise (0.3 -> 0.85)
  console.log('  3. Dispatching SET_VOLUME rise to 0.85 mid-crossfade...');
  win.webContents.send('stage-control', 'SET_VOLUME', { volume: 0.85 });

  const immediateAfterRise = await win.webContents.executeJavaScript(`
    (() => {
      const vA = document.getElementById('deckA').querySelector('video');
      const vB = document.getElementById('deckB').querySelector('video');
      return {
        vAVol: vA ? vA.volume : null,
        vBVol: vB ? vB.volume : null,
        sum: (vA ? vA.volume : 0) + (vB ? vB.volume : 0),
        masterVolume: masterVolume
      };
    })()
  `);

  console.log('  Immediate state after SET_VOLUME (0.85):', immediateAfterRise);

  // Verify that neither deck snapped directly to 0.85 (which would cause sum = 1.70 clipping burst!)
  const didNotBurstOnRise = immediateAfterRise.sum < 1.4 &&
                            (Math.abs(immediateAfterRise.vAVol - 0.85) > 0.05);

  recordTest('CHAL-IT3-04: Volume rise mid-crossfade does NOT cause transient volume explosion/burst (sum < 1.4)',
    didNotBurstOnRise && immediateAfterRise.masterVolume === 0.85,
    `Immediate volumes: vA=${immediateAfterRise.vAVol}, vB=${immediateAfterRise.vBVol}, sum=${immediateAfterRise.sum}`
  );

  // Wait 120ms for RAF frames to ramp up to 0.85
  await sleep(120);

  const subsequentRafRise = await win.webContents.executeJavaScript(`
    (() => {
      const vA = document.getElementById('deckA').querySelector('video');
      const vB = document.getElementById('deckB').querySelector('video');
      return {
        vAVol: vA ? vA.volume : null,
        vBVol: vB ? vB.volume : null,
        sum: (vA ? vA.volume : 0) + (vB ? vB.volume : 0),
        masterVolume: masterVolume
      };
    })()
  `);

  console.log('  Subsequent RAF state after rise (should sum to ~0.85):', subsequentRafRise);

  recordTest('CHAL-IT3-05: Subsequent RAF frames smoothly ramp deck volumes to sum to new masterVolume (0.85)',
    Math.abs(subsequentRafRise.sum - 0.85) < 0.05,
    `Observed sum: ${subsequentRafRise.sum}, expected ~0.85`
  );

  // Phase 4: Mute / Unmute during crossfade
  console.log('  4. Testing SET_MUTE during crossfade...');
  win.webContents.send('stage-control', 'SET_MUTE', { muted: true });
  await sleep(50);

  const mutedCheck = await win.webContents.executeJavaScript(`
    (() => {
      const vA = document.getElementById('deckA').querySelector('video');
      const vB = document.getElementById('deckB').querySelector('video');
      return {
        vAMuted: vA ? vA.muted : null,
        vBMuted: vB ? vB.muted : null,
        isMuted: isMuted
      };
    })()
  `);

  recordTest('CHAL-IT3-06: SET_MUTE mutes hardware video elements immediately during crossfade',
    mutedCheck.vAMuted === true && mutedCheck.vBMuted === true && mutedCheck.isMuted === true,
    JSON.stringify(mutedCheck)
  );

  // Unmute
  win.webContents.send('stage-control', 'SET_MUTE', { muted: false });
  await sleep(50);

  // Phase 5: Crossfade Completion
  console.log('  5. Awaiting crossfade completion...');
  await sleep(1000);

  const completionState = await win.webContents.executeJavaScript(`
    (() => {
      const vA = document.getElementById('deckA').querySelector('video');
      const vB = document.getElementById('deckB').querySelector('video');
      return {
        vAExists: !!vA,
        vBVol: vB ? vB.volume : null,
        activeDeckKey: activeDeckKey,
        audioCrossfadeAnimId: audioCrossfadeAnimId,
        masterVolume: masterVolume
      };
    })()
  `);

  console.log('  Final crossfade completion state:', completionState);

  recordTest('CHAL-IT3-07: Crossfade completes on Deck B at updated masterVolume (0.85) with audioCrossfadeAnimId reset to null',
    completionState.activeDeckKey === 'B' &&
    completionState.audioCrossfadeAnimId === null &&
    completionState.vBVol !== null &&
    Math.abs(completionState.vBVol - 0.85) < 0.05,
    JSON.stringify(completionState)
  );

  // Phase 6: Steady-State Volume Responsiveness
  console.log('  6. Testing steady-state volume responsiveness (audioCrossfadeAnimId === null)...');
  win.webContents.send('stage-control', 'SET_VOLUME', { volume: 0.42 });

  // In steady-state, the video volume must update synchronously
  const steadyStateCheck1 = await win.webContents.executeJavaScript(`
    (() => {
      const vB = document.getElementById('deckB').querySelector('video');
      return {
        vBVol: vB ? vB.volume : null,
        masterVolume: masterVolume
      };
    })()
  `);

  console.log('  Steady-state volume change (0.42):', steadyStateCheck1);

  recordTest('CHAL-IT3-08: Steady-state volume change updates active video element immediately to 0.42',
    steadyStateCheck1.masterVolume === 0.42 &&
    Math.abs(steadyStateCheck1.vBVol - 0.42) < 0.001,
    JSON.stringify(steadyStateCheck1)
  );

  // Second steady-state adjustment: increase to 0.95
  win.webContents.send('stage-control', 'SET_VOLUME', { volume: 0.95 });

  const steadyStateCheck2 = await win.webContents.executeJavaScript(`
    (() => {
      const vB = document.getElementById('deckB').querySelector('video');
      return {
        vBVol: vB ? vB.volume : null,
        masterVolume: masterVolume
      };
    })()
  `);

  console.log('  Steady-state volume change (0.95):', steadyStateCheck2);

  recordTest('CHAL-IT3-09: Steady-state volume change updates active video element immediately to 0.95',
    steadyStateCheck2.masterVolume === 0.95 &&
    Math.abs(steadyStateCheck2.vBVol - 0.95) < 0.001,
    JSON.stringify(steadyStateCheck2)
  );

  // Phase 7: Cut Transition (Duration 0) Audio Assignment & Steady-State Check
  console.log('  7. Triggering Cut transition (duration 0) to Deck A and testing immediate audio assignment...');
  win.webContents.send('stage-go-live', {
    media: { id: 'vid1', name: 'Video 1', type: 'video', path: 'dummy_video1.mp4' },
    transition: 'cut'
  });

  await sleep(200);

  const cutState = await win.webContents.executeJavaScript(`
    (() => {
      const vA = document.getElementById('deckA').querySelector('video');
      return {
        activeDeckKey: activeDeckKey,
        audioCrossfadeAnimId: audioCrossfadeAnimId,
        vAVol: vA ? vA.volume : null,
        masterVolume: masterVolume
      };
    })()
  `);

  console.log('  Cut transition state:', cutState);

  recordTest('CHAL-IT3-10: Cut transition immediately assigns masterVolume (0.95) to new active deck and leaves audioCrossfadeAnimId null',
    cutState.activeDeckKey === 'A' &&
    cutState.audioCrossfadeAnimId === null &&
    Math.abs(cutState.vAVol - 0.95) < 0.001,
    JSON.stringify(cutState)
  );

  console.log(`\n=== ELECTRON-NATIVE AUDIO DYNAMICS TESTS COMPLETED: ${passed} PASSED, ${failed} FAILED ===`);
  process.exit(failed > 0 ? 1 : 0);
}

app.whenReady().then(() => {
  const win = new BrowserWindow({
    x: -9999,
    y: -9999,
    width: 1280,
    height: 720,
    show: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webSecurity: false,
      backgroundThrottling: false
    }
  });

  win.loadFile(stageHtmlPath);

  win.webContents.on('did-finish-load', () => {
    setTimeout(() => {
      runEmpiricalAudioSuite(win).catch(err => {
        console.error('Test runner runtime error:', err);
        process.exit(1);
      });
    }, 300);
  });
});
