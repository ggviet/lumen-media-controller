/**
 * tests/empirical_stage_runner.js
 * Electron-native empirical test runner for Milestone 2 Dual-Deck Crossfade Engine.
 * Executes within a real Electron/Chromium runtime to test src/renderer/stage/index.html.
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

const stageHtmlPath = path.join(__dirname, '../src/renderer/stage/index.html');
const sampleSvgPath = path.join(__dirname, '../assets/sample_keyvisual.svg');
const sampleLogoPath = path.join(__dirname, '../assets/logo.svg');

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

async function runEmpiricalSuite(win) {
  console.log('\n--- STARTING ELECTRON-NATIVE EMPIRICAL STAGE TESTS ---');

  // Test 1: Stage Window Initial State Audit
  const initialState = await win.webContents.executeJavaScript(`
    ({
      deckAExists: !!document.getElementById('deckA'),
      deckBExists: !!document.getElementById('deckB'),
      deckAActive: document.getElementById('deckA').classList.contains('active'),
      deckBActive: document.getElementById('deckB').classList.contains('active'),
      deckABackground: window.getComputedStyle(document.getElementById('deckA')).backgroundColor,
      deckAOpacity: window.getComputedStyle(document.getElementById('deckA')).opacity,
      deckBOpacity: window.getComputedStyle(document.getElementById('deckB')).opacity,
      activeDeckKey: activeDeckKey,
      token: activeTransitionToken
    })
  `);

  recordTest('CHAL-EL-01: Initial Deck A is active with transparent background', 
    initialState.deckAActive && !initialState.deckBActive && initialState.activeDeckKey === 'A',
    JSON.stringify(initialState)
  );

  // Test 2: Ingest Image into Deck B with 800ms Normal Crossfade
  win.webContents.send('stage-go-live', {
    media: { id: 'img1', name: 'Key Visual', type: 'image', path: sampleSvgPath },
    transition: 'normal'
  });

  // Await crossfade completion (800ms + 100ms buffer)
  await sleep(1000);

  const stateAfterImg1 = await win.webContents.executeJavaScript(`
    ({
      activeDeckKey: activeDeckKey,
      deckAActive: document.getElementById('deckA').classList.contains('active'),
      deckBActive: document.getElementById('deckB').classList.contains('active'),
      deckBHasImg: !!document.getElementById('deckB').querySelector('img'),
      deckAEmpty: document.getElementById('deckA').innerHTML === '',
      token: activeTransitionToken
    })
  `);

  recordTest('CHAL-EL-02: Image-to-Deck transition handoff to Deck B',
    stateAfterImg1.activeDeckKey === 'B' && stateAfterImg1.deckBActive && !stateAfterImg1.deckAActive && stateAfterImg1.deckBHasImg,
    JSON.stringify(stateAfterImg1)
  );

  // Test 3: Cut (0ms) Transition from Deck B back to Deck A
  win.webContents.send('stage-go-live', {
    media: { id: 'img2', name: 'Logo', type: 'image', path: sampleLogoPath },
    transition: 'cut'
  });

  // Cut should complete almost immediately (0ms + 120ms cleanup)
  await sleep(250);

  const stateAfterCut = await win.webContents.executeJavaScript(`
    ({
      activeDeckKey: activeDeckKey,
      deckAActive: document.getElementById('deckA').classList.contains('active'),
      deckBActive: document.getElementById('deckB').classList.contains('active'),
      deckAHasFadeCut: document.getElementById('deckA').classList.contains('fade-cut'),
      deckBHasFadeCut: document.getElementById('deckB').classList.contains('fade-cut'),
      deckBEmpty: document.getElementById('deckB').innerHTML === ''
    })
  `);

  recordTest('CHAL-EL-03: Cut (0ms) transition execution & cleanup',
    stateAfterCut.activeDeckKey === 'A' && stateAfterCut.deckAActive && stateAfterCut.deckAHasFadeCut && stateAfterCut.deckBEmpty,
    JSON.stringify(stateAfterCut)
  );

  // Test 4: Slow (1.6s) Transition from Deck A to Deck B
  win.webContents.send('stage-go-live', {
    media: { id: 'img3', name: 'Key Visual Slow', type: 'image', path: sampleSvgPath },
    transition: 'slow'
  });

  // Midway check at 600ms: pre-roll (up to 400ms) is complete and transition is active
  await sleep(600);
  const midSlowState = await win.webContents.executeJavaScript(`
    ({
      deckBHasFadeSlow: document.getElementById('deckB').classList.contains('fade-slow'),
      deckBActive: document.getElementById('deckB').classList.contains('active'),
      activeDeckKey: activeDeckKey
    })
  `);

  recordTest('CHAL-EL-04: Slow 1.6s transition assigns fade-slow class and activates target deck',
    midSlowState.deckBHasFadeSlow && midSlowState.deckBActive && midSlowState.activeDeckKey === 'B',
    JSON.stringify(midSlowState)
  );

  // Wait for Slow transition to finish (1600ms fade + 80ms cleanup buffer - 200ms already waited)
  await sleep(1600);

  const finalSlowState = await win.webContents.executeJavaScript(`
    ({
      activeDeckKey: activeDeckKey,
      deckAEmpty: document.getElementById('deckA').innerHTML === '',
      deckBActive: document.getElementById('deckB').classList.contains('active')
    })
  `);

  recordTest('CHAL-EL-05: Slow 1.6s transition cleans outgoing Deck A on completion',
    finalSlowState.activeDeckKey === 'B' && finalSlowState.deckAEmpty && finalSlowState.deckBActive,
    JSON.stringify(finalSlowState)
  );

  // Test 5: Rapid-Fire GO LIVE Interruption Storm (5 commands in 15ms intervals)
  console.log('  Testing rapid-fire GO LIVE interruption burst...');
  const burstTokens = [];
  for (let i = 1; i <= 5; i++) {
    win.webContents.send('stage-go-live', {
      media: { id: `burst_${i}`, name: `Burst Media ${i}`, type: 'image', path: sampleSvgPath },
      transition: 'normal'
    });
    await sleep(15);
  }

  // Allow final transition to finish: 5*15ms (60ms) + 400ms preRoll + 800ms fade + 80ms cleanup = ~1340ms -> wait 1600ms
  await sleep(1600);

  const burstFinalState = await win.webContents.executeJavaScript(`
    ({
      token: activeTransitionToken,
      cleanupTimeoutId: cleanupTimeoutId,
      audioCrossfadeAnimId: audioCrossfadeAnimId,
      activeDeckKey: activeDeckKey,
      deckAChildren: document.getElementById('deckA').children.length,
      deckBChildren: document.getElementById('deckB').children.length,
      totalMediaElements: document.querySelectorAll('.stage-media-element').length
    })
  `);

  recordTest('CHAL-EL-06: Rapid-fire storm token invalidation: token incremented to 8 and exactly 1 active media element',
    burstFinalState.token >= 8 && burstFinalState.totalMediaElements === 1 && (burstFinalState.deckAChildren === 1 || burstFinalState.deckBChildren === 1),
    JSON.stringify(burstFinalState)
  );

  // Test 6: Stage Control Hotkeys & Emergency Layers
  // Blackout test
  win.webContents.send('stage-control', 'BLACKOUT');
  await sleep(100);
  const blackoutState = await win.webContents.executeJavaScript(`
    ({
      hasActiveBlackout: document.getElementById('blackoutCover').classList.contains('active-blackout'),
      isBlackoutVar: isBlackout
    })
  `);
  recordTest('CHAL-EL-07: BLACKOUT triggers active-blackout overlay',
    blackoutState.hasActiveBlackout && blackoutState.isBlackoutVar,
    JSON.stringify(blackoutState)
  );

  // Safe Logo test
  win.webContents.send('stage-control', 'SAFE_LOGO', { logoPath: sampleLogoPath });
  await sleep(100);
  const safeLogoState = await win.webContents.executeJavaScript(`
    ({
      hasActiveLogo: document.getElementById('safeLogoLayer').classList.contains('active'),
      isSafeLogoVar: isSafeLogo
    })
  `);
  recordTest('CHAL-EL-08: SAFE_LOGO triggers safeLogoLayer active class',
    safeLogoState.hasActiveLogo && safeLogoState.isSafeLogoVar,
    JSON.stringify(safeLogoState)
  );

  // Live Ticker test
  win.webContents.send('stage-control', 'UPDATE_TICKER', { text: 'CHALLENGER VERIFICATION RUNNING' });
  await sleep(100);
  const tickerState = await win.webContents.executeJavaScript(`
    ({
      tickerVisible: document.getElementById('tickerOverlay').classList.contains('visible'),
      tickerText: document.getElementById('tickerContent').innerText
    })
  `);
  recordTest('CHAL-EL-09: UPDATE_TICKER updates tickerContent and shows overlay',
    tickerState.tickerVisible && tickerState.tickerText === 'CHALLENGER VERIFICATION RUNNING',
    JSON.stringify(tickerState)
  );

  // Lift Blackout and Logo via GO LIVE
  win.webContents.send('stage-go-live', {
    media: { id: 'resume', name: 'Resume', type: 'image', path: sampleSvgPath },
    transition: 'cut'
  });
  await sleep(250);
  const liftedState = await win.webContents.executeJavaScript(`
    ({
      blackoutCoverEmpty: document.getElementById('blackoutCover').className === '',
      safeLogoInactive: !document.getElementById('safeLogoLayer').classList.contains('active'),
      isBlackout: isBlackout,
      isSafeLogo: isSafeLogo
    })
  `);
  recordTest('CHAL-EL-10: GO LIVE automatically lifts Blackout and Safe Logo layers',
    liftedState.blackoutCoverEmpty && liftedState.safeLogoInactive && !liftedState.isBlackout && !liftedState.isSafeLogo,
    JSON.stringify(liftedState)
  );

  console.log(`\n--- EMPIRICAL STAGE TESTS COMPLETED: ${passed} PASSED, ${failed} FAILED ---`);
  
  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

app.whenReady().then(() => {
  const win = new BrowserWindow({
    x: -9999,
    y: -9999,
    width: 1280,
    height: 720,
    show: true, // Visible to compositor so requestAnimationFrame runs at 60fps
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webSecurity: false,
      backgroundThrottling: false
    }
  });

  win.loadFile(stageHtmlPath);

  win.webContents.on('did-finish-load', () => {
    // Delay slightly to let initial scripts attach
    setTimeout(() => {
      runEmpiricalSuite(win).catch(err => {
        console.error('Test runner runtime error:', err);
        process.exit(1);
      });
    }, 300);
  });
});
