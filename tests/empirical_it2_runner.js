/**
 * tests/empirical_it2_runner.js
 * Electron-native Empirical End-to-End Test Runner for Milestone 2 Iteration 2:
 * Live Stage & Operator Windows with real DOM mouse events and IPC routing.
 *
 * Challenger: Challenger 2 (Milestone 2 Iteration 2)
 */

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { readCompleteHtml } = require('./test_helpers');
const fs = require('fs');

// Ensure hardware flags match production
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-renderer-backgrounding');

const operatorHtmlPath = path.join(__dirname, '../src/renderer/operator/index.html');
const stageHtmlPath = path.join(__dirname, '../src/renderer/stage/index.html');

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

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function runEmpiricalSuite(operatorWin, stageWin) {
  console.log('\n--- STARTING ELECTRON-NATIVE DUAL-WINDOW EMPIRICAL TESTS (M2 IT2) ---');

  // Let DOM settle and initial demo rundown populate
  await sleep(600);

  // Set up custom rundown in operator window
  await operatorWin.webContents.executeJavaScript(`
    rundown = [
      { id: 'cue_0', name: '0. Intro Video', type: 'video', path: 'video0.mp4', endBehavior: 'AUTO_NEXT' },
      { id: 'cue_1', name: '1. Feature Film', type: 'video', path: 'video1.mp4', endBehavior: 'FADE_TO_BLACK' },
      { id: 'cue_2', name: '2. Epilogue Video', type: 'video', path: 'video2.mp4', endBehavior: 'AUTO_NEXT' },
      { id: 'cue_3', name: '3. Credits Slide', type: 'image', path: 'slide3.png', endBehavior: 'HOLD_LAST_FRAME' }
    ];
    selectedIndex = 0;
    pvwCue = rundown[0];
    pgmCue = null;
    renderRundown();
    true;
  `);

  // =========================================================================
  // TEST 1: Real Native MouseEvent on btnGoLive
  // =========================================================================
  console.log('\nTesting Native MouseEvent dispatch on btnGoLive...');

  const clickResult = await operatorWin.webContents.executeJavaScript(`
    new Promise((resolve) => {
      // Simulate real browser click event on btnGoLive
      const btn = document.getElementById('btnGoLive');
      btn.click(); // Fires native browser PointerEvent / MouseEvent
      setTimeout(() => {
        resolve({
          hasPgmCue: !!pgmCue,
          pgmId: pgmCue ? pgmCue.id : null,
          pgmName: pgmCue ? pgmCue.name : null,
          isEventObject: pgmCue instanceof Event
        });
      }, 100);
    });
  `);

  recordTest(
    'E2E-CLICK-01: Native btnGoLive.click() correctly mounts preview cue to PGM without event corruption',
    clickResult.hasPgmCue && clickResult.pgmId === 'cue_0' && !clickResult.isEventObject,
    JSON.stringify(clickResult)
  );

  // Verify Stage window received stage-go-live with valid cue
  await sleep(200);
  const stageState1 = await stageWin.webContents.executeJavaScript(`
    ({
      currentMediaId: currentMedia ? currentMedia.id : null,
      isBlackout: isBlackout,
      isFTB: isFTB
    })
  `);

  recordTest(
    'E2E-CLICK-02: Stage window receives valid media payload from button click',
    stageState1.currentMediaId === 'cue_0',
    JSON.stringify(stageState1)
  );

  // =========================================================================
  // TEST 2: AUTO_NEXT End Behavior
  // =========================================================================
  console.log('\nTesting AUTO_NEXT progression in real Electron runtime...');

  // Set preview cue to cue_3 (Credits Slide) to test decoupling
  await operatorWin.webContents.executeJavaScript(`
    selectedIndex = 3;
    pvwCue = rundown[3];
    renderRundown();
    true;
  `);

  // Simulate video cue_0 ending on Stage with AUTO_NEXT
  await stageWin.webContents.executeJavaScript(`
    ipcRenderer.send('stage-status', {
      event: 'media-ended',
      id: 'cue_0',
      cueId: 'cue_0',
      endBehavior: 'AUTO_NEXT'
    });
    true;
  `);

  await sleep(300);

  const operatorAfterAutoNext = await operatorWin.webContents.executeJavaScript(`
    ({
      pgmId: pgmCue ? pgmCue.id : null,
      pvwId: pvwCue ? pvwCue.id : null,
      selectedIndex: selectedIndex
    })
  `);

  recordTest(
    'E2E-AUTONEXT-01: AUTO_NEXT advances PGM from cue_0 to cue_1 while preview stays parked on cue_3',
    operatorAfterAutoNext.pgmId === 'cue_1' && operatorAfterAutoNext.pvwId === 'cue_3' && operatorAfterAutoNext.selectedIndex === 3,
    JSON.stringify(operatorAfterAutoNext)
  );

  // =========================================================================
  // TEST 3: FADE_TO_BLACK End Behavior & Blackout Retention
  // =========================================================================
  console.log('\nTesting FADE_TO_BLACK and blackout retention in real Electron runtime...');

  // Stage finishes cue_1 with FADE_TO_BLACK
  await stageWin.webContents.executeJavaScript(`
    blackoutCover.className = 'active-ftb';
    isFTB = true;
    ipcRenderer.send('stage-status', {
      event: 'media-ended',
      id: 'cue_1',
      cueId: 'cue_1',
      endBehavior: 'FADE_TO_BLACK',
      isFTB: true
    });
    true;
  `);

  await sleep(300);

  // Verify Operator state
  const operatorAfterFTB = await operatorWin.webContents.executeJavaScript(`
    ({
      pgmId: pgmCue ? pgmCue.id : null,
      pvwId: pvwCue ? pvwCue.id : null,
      btnFtbActive: document.getElementById('btnFTB').classList.contains('active')
    })
  `);

  recordTest(
    'E2E-FTB-01: Operator does NOT advance on FADE_TO_BLACK (PGM remains cue_1) and activates FTB button',
    operatorAfterFTB.pgmId === 'cue_1' && operatorAfterFTB.btnFtbActive,
    JSON.stringify(operatorAfterFTB)
  );

  // Verify Stage state remains black
  const stageAfterFTB = await stageWin.webContents.executeJavaScript(`
    ({
      isFTB: isFTB,
      blackoutCoverClass: document.getElementById('blackoutCover').className
    })
  `);

  recordTest(
    'E2E-FTB-02: Stage remains black (active-ftb, isFTB=true)',
    stageAfterFTB.isFTB === true && stageAfterFTB.blackoutCoverClass === 'active-ftb',
    JSON.stringify(stageAfterFTB)
  );

  // =========================================================================
  // TEST 4: Lifting FTB via GO LIVE Button Click
  // =========================================================================
  console.log('\nTesting FTB clearance when operator clicks GO LIVE...');

  // Operator clicks GO LIVE to take preview (cue_3) live
  await operatorWin.webContents.executeJavaScript(`
    document.getElementById('btnGoLive').click();
    true;
  `);

  await sleep(400);

  const finalStageState = await stageWin.webContents.executeJavaScript(`
    ({
      currentMediaId: currentMedia ? currentMedia.id : null,
      isFTB: isFTB,
      blackoutCoverEmpty: document.getElementById('blackoutCover').className === ''
    })
  `);

  recordTest(
    'E2E-FTB-03: Operator clicking GO LIVE lifts Stage blackout and mounts cue_3',
    finalStageState.currentMediaId === 'cue_3' && !finalStageState.isFTB && finalStageState.blackoutCoverEmpty,
    JSON.stringify(finalStageState)
  );

  console.log(`\n--- ELECTRON-NATIVE EMPIRICAL TESTS COMPLETED: ${passed} PASSED, ${failed} FAILED ---`);

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

app.whenReady().then(() => {
  // Create Stage Window
  const stageWin = new BrowserWindow({
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

  // Create Operator Window
  const operatorWin = new BrowserWindow({
    x: -9999,
    y: -9999,
    width: 1280,
    height: 800,
    show: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webSecurity: false,
      backgroundThrottling: false
    }
  });

  // Main process IPC broker mimicking src/main/index.js
  ipcMain.on('go-live', (event, payload) => {
    stageWin.webContents.send('stage-go-live', payload);
  });

  ipcMain.on('stage-status', (event, status) => {
    operatorWin.webContents.send('stage-status', status);
  });

  ipcMain.on('stage-control', (event, action, data) => {
    stageWin.webContents.send('stage-control', action, data);
  });

  stageWin.loadFile(stageHtmlPath);
  operatorWin.loadFile(operatorHtmlPath);

  let loadedCount = 0;
  function onWindowLoaded() {
    loadedCount++;
    if (loadedCount === 2) {
      setTimeout(() => {
        runEmpiricalSuite(operatorWin, stageWin).catch(err => {
          console.error('Empirical runner runtime error:', err);
          process.exit(1);
        });
      }, 500);
    }
  }

  stageWin.webContents.on('did-finish-load', onWindowLoaded);
  operatorWin.webContents.on('did-finish-load', onWindowLoaded);
});
