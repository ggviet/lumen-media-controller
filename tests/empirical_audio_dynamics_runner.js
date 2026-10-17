/**
 * tests/empirical_audio_dynamics_runner.js
 * Electron-native empirical test runner for Milestone 2 Iteration 2
 * Audio Dynamics & Volume Scaling during Crossfades.
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
  console.log('\n--- STARTING ELECTRON-NATIVE AUDIO DYNAMICS TESTS ---');

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

  // Test 1: Start 1.6s Slow transition to Deck B with video media
  console.log('  Triggering 1.6s Slow transition from Deck A to Deck B...');
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

  // Wait 800ms to reach ~50% of 1600ms slow fade
  await sleep(800);

  const midFadeVolumesBefore = await win.webContents.executeJavaScript(`
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

  console.log('  Mid-fade state before volume change:', midFadeVolumesBefore);

  recordTest('CHAL-AUD-01: Crossfade is actively running at ~50% progress',
    midFadeVolumesBefore.audioCrossfadeAnimId &&
    midFadeVolumesBefore.vAVol > 0.2 && midFadeVolumesBefore.vAVol < 0.8 &&
    midFadeVolumesBefore.vBVol > 0.2 && midFadeVolumesBefore.vBVol < 0.8,
    JSON.stringify(midFadeVolumesBefore)
  );

  // Now, simulate Master Volume Drop: masterVolume drops from 1.0 to 0.3
  console.log('  Simulating SET_VOLUME drop to 0.3 mid-crossfade...');
  win.webContents.send('stage-control', 'SET_VOLUME', { volume: 0.3 });

  // IMMEDIATELY inspect volumes right after SET_VOLUME (before next RAF frame)
  const immediateStateAfterDrop = await win.webContents.executeJavaScript(`
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

  console.log('  Immediate state right after SET_VOLUME (drop to 0.3):', immediateStateAfterDrop);

  // Wait 100ms for RAF to execute multiple frames
  await sleep(100);

  const subsequentRafState = await win.webContents.executeJavaScript(`
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

  console.log('  Subsequent RAF frame state after drop:', subsequentRafState);

  // Audit finding: Check if SET_VOLUME directly overwrote vA and vB to 0.3
  const didDirectlyOverrideOnDrop = Math.abs(immediateStateAfterDrop.vAVol - 0.3) < 0.01 &&
                                    Math.abs(immediateStateAfterDrop.vBVol - 0.3) < 0.01;

  recordTest('CHAL-AUD-02: AUDIT CHECK: Does SET_VOLUME directly override deck volumes to masterVolume before RAF?',
    didDirectlyOverrideOnDrop,
    `Observed immediate volumes: vA=${immediateStateAfterDrop.vAVol}, vB=${immediateStateAfterDrop.vBVol}, sum=${immediateStateAfterDrop.sum}`
  );

  // Test 3: Test Mute toggle during crossfade
  console.log('  Testing SET_MUTE during crossfade...');
  win.webContents.send('stage-control', 'SET_MUTE', { muted: true });
  await sleep(50);

  const mutedState = await win.webContents.executeJavaScript(`
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

  recordTest('CHAL-AUD-03: SET_MUTE immediately mutes both video elements',
    mutedState.vAMuted === true && mutedState.vBMuted === true && mutedState.isMuted === true,
    JSON.stringify(mutedState)
  );

  // Unmute and test volume rise (0.2 -> 0.8)
  win.webContents.send('stage-control', 'SET_MUTE', { muted: false });
  win.webContents.send('stage-control', 'SET_VOLUME', { volume: 0.8 });
  await sleep(50);

  const unmutedState = await win.webContents.executeJavaScript(`
    (() => {
      const vA = document.getElementById('deckA').querySelector('video');
      const vB = document.getElementById('deckB').querySelector('video');
      return {
        vAMuted: vA ? vA.muted : null,
        vBMuted: vB ? vB.muted : null,
        isMuted: isMuted,
        masterVolume: masterVolume
      };
    })()
  `);

  recordTest('CHAL-AUD-04: SET_MUTE false cleanly un-mutes both decks',
    unmutedState.vAMuted === false && unmutedState.vBMuted === false && !unmutedState.isMuted,
    JSON.stringify(unmutedState)
  );

  // Await crossfade completion (1.6s fade + cleanup buffer)
  await sleep(1000);

  const finalCrossfadeState = await win.webContents.executeJavaScript(`
    (() => {
      const vA = document.getElementById('deckA').querySelector('video');
      const vB = document.getElementById('deckB').querySelector('video');
      return {
        vAExists: !!vA,
        vBVol: vB ? vB.volume : null,
        activeDeckKey: activeDeckKey,
        masterVolume: masterVolume
      };
    })()
  `);

  console.log('  Final crossfade completion state:', finalCrossfadeState);

  recordTest('CHAL-AUD-05: Crossfade completes on Deck B at updated masterVolume (0.8)',
    finalCrossfadeState.activeDeckKey === 'B' &&
    finalCrossfadeState.vBVol !== null &&
    Math.abs(finalCrossfadeState.vBVol - 0.8) < 0.05,
    JSON.stringify(finalCrossfadeState)
  );

  console.log(`\n--- AUDIO DYNAMICS TESTS COMPLETED: ${passed} PASSED, ${failed} FAILED ---`);
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
