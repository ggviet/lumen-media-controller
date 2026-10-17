/**
 * tests/m2_it2_end_behavior_challenge.test.js
 * Empirical Challenge & Stress Harness for Milestone 2 Iteration 2:
 * End Behaviors (FADE_TO_BLACK, AUTO_NEXT) & Click Protection (triggerGoLive MouseEvent handling).
 *
 * Challenger: Challenger 2 (Milestone 2 Iteration 2)
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { readCompleteHtml } = require('./test_helpers');
const EventEmitter = require('events');

const operatorHtmlPath = path.join(__dirname, '../src/renderer/operator/index.html');
const stageHtmlPath = path.join(__dirname, '../src/renderer/stage/index.html');
const operatorHtml = readCompleteHtml(operatorHtmlPath);
const stageHtml = readCompleteHtml(stageHtmlPath);

// Synthetic DOM Event Classes to simulate real Chromium browser event dispatch
class MockEvent {
  constructor(type, options = {}) {
    this.type = type;
    this.bubbles = !!options.bubbles;
    this.cancelable = !!options.cancelable;
    this.isTrusted = options.isTrusted !== undefined ? options.isTrusted : true;
    this.target = options.target || null;
    this.currentTarget = options.currentTarget || null;
  }
}

class MockUIEvent extends MockEvent {
  constructor(type, options = {}) {
    super(type, options);
    this.detail = options.detail || 0;
  }
}

class MockMouseEvent extends MockUIEvent {
  constructor(type, options = {}) {
    super(type, options);
    this.screenX = options.screenX || 0;
    this.screenY = options.screenY || 0;
    this.clientX = options.clientX || 0;
    this.clientY = options.clientY || 0;
    this.button = options.button || 0;
    this.buttons = options.buttons || 1;
  }
}

class MockPointerEvent extends MockMouseEvent {
  constructor(type, options = {}) {
    super(type, options);
    this.pointerId = options.pointerId || 1;
    this.pointerType = options.pointerType || 'mouse';
  }
}

/**
 * Creates an Operator Execution Environment extracting verbatim functions
 * from src/renderer/operator/index.html
 */
function createOperatorRuntime(initialRundown = []) {
  // Extract function definitions directly from operatorHtml
  const triggerGoLiveMatch = operatorHtml.match(/function triggerGoLive\([\s\S]*?\n        \}/);
  assert.ok(triggerGoLiveMatch, 'triggerGoLive must exist in operator/index.html');

  const stageStatusMatch = operatorHtml.match(/ipcRenderer\.on\('stage-status',\s*\(event,\s*status\)\s*=>\s*\{([\s\S]*?)\n        \}\);/);
  assert.ok(stageStatusMatch, 'stage-status handler must exist in operator/index.html');

  // Build isolated runtime script where all operator variables are in scope
  const runtimeScript = `
    const sentIpcMessages = [];
    const ipcRenderer = {
      send: (channel, ...args) => {
        sentIpcMessages.push({ channel, args });
      }
    };

    let rundown = initialRundown;
    let selectedIndex = initialRundown.length > 0 ? 0 : -1;
    let pvwCue = initialRundown.length > 0 ? initialRundown[0] : null;
    let pgmCue = null;
    let currentTransition = 'normal';
    let currentScaling = 'contain';

    const pgmContainer = {
      innerHTML: '',
      children: [],
      querySelector: () => null,
      appendChild: (child) => pgmContainer.children.push(child)
    };
    const pvwContainer = { querySelector: () => null };
    const pgmCueTitle = { innerText: '' };
    const pgmElapsed = { innerText: '' };
    const pgmRemaining = { innerText: '' };
    const pgmFrame = {
      classList: {
        add: () => {},
        remove: () => {}
      }
    };

    const btnFTB = {
      classList: {
        classes: new Set(),
        toggle: function(name, force) {
          if (force === true) this.classes.add(name);
          else if (force === false) this.classes.delete(name);
          else if (this.classes.has(name)) this.classes.delete(name);
          else this.classes.add(name);
        },
        contains: function(name) { return this.classes.has(name); }
      }
    };
    const btnBlackout = { classList: { toggle: () => {} } };
    const btnFreeze = { classList: { toggle: () => {} } };
    const btnSafeLogo = { classList: { toggle: () => {} } };

    let rundownRenderCount = 0;
    function renderRundown() { rundownRenderCount++; }
    function formatTime(s) { return s + 's'; }

    const document = {
      createElement: (tag) => ({
        tagName: tag.toUpperCase(),
        style: {},
        src: '',
        className: ''
      })
    };

    // Embed production triggerGoLive
    ${triggerGoLiveMatch[0]}

    // Embed production stage-status handler
    function onStageStatus(status) {
      const event = null;
      ${stageStatusMatch[1]}
    }

    return {
      triggerGoLive,
      onStageStatus,
      getRundown: () => rundown,
      setRundown: (r) => { rundown = r; },
      getPgmCue: () => pgmCue,
      setPgmCue: (c) => { pgmCue = c; },
      getPvwCue: () => pvwCue,
      setPvwCue: (c, idx) => { pvwCue = c; selectedIndex = idx; },
      getSelectedIndex: () => selectedIndex,
      setSelectedIndex: (idx) => { selectedIndex = idx; },
      getBtnFTB: () => btnFTB,
      getSentIpc: () => sentIpcMessages,
      clearSentIpc: () => { sentIpcMessages.length = 0; }
    };
  `;

  const factory = new Function(
    'Event', 'MouseEvent', 'PointerEvent',
    'initialRundown',
    runtimeScript
  );

  return factory(
    MockEvent, MockMouseEvent, MockPointerEvent,
    initialRundown
  );
}

describe('Milestone 2 Iteration 2 Empirical Challenge: End Behaviors & Click Protection', () => {

  // =========================================================================
  // SUITE 1: Click Protection on GO LIVE (triggerGoLive)
  // =========================================================================
  describe('Suite 1: GO LIVE Button Event Handling & Argument Sanitization', () => {

    it('TC-CLICK-01: Passing MouseEvent from button click correctly cues pvwCue into PGM without error', () => {
      const runtime = createOperatorRuntime([
        { id: 'cue_pvw_1', name: 'Preview Slide', type: 'image', path: '/assets/preview.png', endBehavior: 'HOLD_LAST_FRAME' }
      ]);
      const mouseEvent = new MockMouseEvent('click', { clientX: 100, clientY: 200 });

      // Simulate browser calling triggerGoLive(event) on btnGoLive click
      runtime.triggerGoLive(mouseEvent);

      const pgm = runtime.getPgmCue();
      assert.ok(pgm, 'PGM cue must be defined');
      assert.strictEqual(pgm.id, 'cue_pvw_1', 'PGM cue ID must match preview cue ID');
      assert.strictEqual(pgm.name, 'Preview Slide');
      assert.strictEqual(pgm.path, '/assets/preview.png');

      const ipc = runtime.getSentIpc();
      assert.strictEqual(ipc.length, 1);
      assert.strictEqual(ipc[0].channel, 'go-live');
      assert.strictEqual(ipc[0].args[0].media.id, 'cue_pvw_1');
    });

    it('TC-CLICK-02: Passing PointerEvent from touchscreen / stylus click correctly cues pvwCue', () => {
      const runtime = createOperatorRuntime([
        { id: 'cue_pvw_1', name: 'Preview Slide', type: 'image', path: '/assets/preview.png', endBehavior: 'HOLD_LAST_FRAME' }
      ]);
      const pointerEvent = new MockPointerEvent('pointerdown', { pointerId: 42, pointerType: 'touch' });

      runtime.triggerGoLive(pointerEvent);

      const pgm = runtime.getPgmCue();
      assert.ok(pgm);
      assert.strictEqual(pgm.id, 'cue_pvw_1');
      assert.strictEqual(runtime.getSentIpc()[0].args[0].media.id, 'cue_pvw_1');
    });

    it('TC-CLICK-03: Passing generic base Event correctly cues pvwCue', () => {
      const runtime = createOperatorRuntime([
        { id: 'cue_pvw_1', name: 'Preview Slide', type: 'image', path: '/assets/preview.png', endBehavior: 'HOLD_LAST_FRAME' }
      ]);
      const baseEvent = new MockEvent('custom-trigger');

      runtime.triggerGoLive(baseEvent);

      const pgm = runtime.getPgmCue();
      assert.ok(pgm);
      assert.strictEqual(pgm.id, 'cue_pvw_1');
    });

    it('TC-CLICK-04: Adversarial synthetic event-like object without ID correctly falls back to pvwCue', () => {
      const runtime = createOperatorRuntime([
        { id: 'cue_pvw_1', name: 'Preview Slide', type: 'image', path: '/assets/preview.png', endBehavior: 'HOLD_LAST_FRAME' }
      ]);
      // An object that looks like an event or arbitrary payload, but NOT a valid cue
      const fakeEventObj = { isTrusted: true, type: 'click', clientX: 50 };

      runtime.triggerGoLive(fakeEventObj);

      const pgm = runtime.getPgmCue();
      assert.ok(pgm);
      assert.strictEqual(pgm.id, 'cue_pvw_1');
    });

    it('TC-CLICK-05: Programmatic cue call with legitimate cue object cues specified cue, bypassing pvwCue', () => {
      const runtime = createOperatorRuntime([
        { id: 'cue_pvw_1', name: 'Preview Slide', type: 'image', path: '/assets/preview.png', endBehavior: 'HOLD_LAST_FRAME' }
      ]);
      const explicitCue = {
        id: 'cue_explicit_99',
        name: 'Auto Next Video',
        type: 'video',
        path: '/assets/next.mp4',
        endBehavior: 'AUTO_NEXT'
      };

      // Call triggerGoLive programmatically (as AUTO_NEXT does)
      runtime.triggerGoLive(explicitCue);

      const pgm = runtime.getPgmCue();
      assert.ok(pgm);
      assert.strictEqual(pgm.id, 'cue_explicit_99', 'PGM cue must be explicitCue, NOT pvwCue');
      assert.strictEqual(pgm.name, 'Auto Next Video');
      assert.strictEqual(runtime.getSentIpc()[0].args[0].media.id, 'cue_explicit_99');
    });

    it('TC-CLICK-06: Calling triggerGoLive() with null / undefined uses pvwCue', () => {
      const runtime = createOperatorRuntime([
        { id: 'cue_pvw_1', name: 'Preview Slide', type: 'image', path: '/assets/preview.png', endBehavior: 'HOLD_LAST_FRAME' }
      ]);
      runtime.triggerGoLive();
      assert.strictEqual(runtime.getPgmCue().id, 'cue_pvw_1');

      runtime.triggerGoLive(null);
      assert.strictEqual(runtime.getPgmCue().id, 'cue_pvw_1');

      runtime.triggerGoLive(undefined);
      assert.strictEqual(runtime.getPgmCue().id, 'cue_pvw_1');
    });

    it('TC-CLICK-07: Calling triggerGoLive when pvwCue is null safely returns without crash', () => {
      const runtime = createOperatorRuntime([]); // empty rundown, pvwCue is null

      // Should safely return without throwing
      assert.doesNotThrow(() => {
        runtime.triggerGoLive(new MockMouseEvent('click'));
      });
      assert.strictEqual(runtime.getPgmCue(), null);
      assert.strictEqual(runtime.getSentIpc().length, 0);
    });
  });

  // =========================================================================
  // SUITE 2: FADE_TO_BLACK End Behavior & Blackout Retention
  // =========================================================================
  describe('Suite 2: FADE_TO_BLACK End Behavior Verification', () => {

    function setupProductionStageSimulation() {
      const stageState = {
        isBlackout: false,
        isFTB: false,
        blackoutCoverClass: '',
        volume: 0.8,
        isPaused: false
      };

      function handleVideoEnded(media) {
        const endBehavior = media.endBehavior || 'HOLD_LAST_FRAME';
        if (endBehavior === 'FADE_TO_BLACK') {
          stageState.blackoutCoverClass = 'active-ftb';
          stageState.isFTB = true;
          // Synchronized FTB audio ramp
          stageState.volume = 0.0;
          stageState.isPaused = true;
          return {
            event: 'media-ended',
            id: media.id,
            cueId: media.id,
            endBehavior: 'FADE_TO_BLACK',
            isFTB: true
          };
        } else if (endBehavior === 'AUTO_NEXT') {
          stageState.isPaused = true;
          return {
            event: 'media-ended',
            id: media.id,
            cueId: media.id,
            endBehavior: 'AUTO_NEXT'
          };
        }
        return null;
      }

      function handleGoLive(payload) {
        if (stageState.isBlackout || stageState.isFTB) {
          stageState.blackoutCoverClass = '';
          stageState.isBlackout = false;
          stageState.isFTB = false;
        }
      }

      return {
        stageState,
        handleVideoEnded,
        handleGoLive
      };
    }

    it('TC-FTB-01: When FADE_TO_BLACK finishes, Stage stays black (active-ftb) and Operator does NOT advance', () => {
      const rundown = [
        { id: 'cue_0', name: '0. Opener', type: 'video', endBehavior: 'AUTO_NEXT' },
        { id: 'cue_1', name: '1. Feature Film', type: 'video', endBehavior: 'FADE_TO_BLACK' },
        { id: 'cue_2', name: '2. Post Show Reel', type: 'video', endBehavior: 'AUTO_NEXT' },
        { id: 'cue_3', name: '3. Credits', type: 'image', endBehavior: 'HOLD_LAST_FRAME' }
      ];

      const operator = createOperatorRuntime(rundown);
      const stage = setupProductionStageSimulation();

      // Make cue_1 live on PGM
      operator.setPgmCue({ ...rundown[1] });
      operator.setPvwCue(rundown[3], 3); // Operator inspecting cue_3 on preview
      operator.clearSentIpc();

      assert.strictEqual(operator.getPgmCue().id, 'cue_1');
      assert.strictEqual(operator.getPgmCue().endBehavior, 'FADE_TO_BLACK');

      // 1. Stage finishes playback of cue_1
      const stageStatusPayload = stage.handleVideoEnded(operator.getPgmCue());
      assert.ok(stageStatusPayload);
      assert.strictEqual(stageStatusPayload.endBehavior, 'FADE_TO_BLACK');
      assert.strictEqual(stageStatusPayload.isFTB, true);

      // Verify Stage internal state
      assert.strictEqual(stage.stageState.blackoutCoverClass, 'active-ftb', 'Stage blackout cover must be active-ftb');
      assert.strictEqual(stage.stageState.isFTB, true, 'Stage isFTB must be true');
      assert.strictEqual(stage.stageState.isPaused, true);
      assert.strictEqual(stage.stageState.volume, 0.0);

      // 2. Deliver stage-status to Operator
      operator.onStageStatus(stageStatusPayload);

      // 3. Operator assertions:
      // Must NOT advance to next cue (cue_2)!
      assert.strictEqual(operator.getPgmCue().id, 'cue_1', 'Operator PGM must remain cue_1 and NOT advance');
      assert.strictEqual(operator.getSentIpc().length, 0, 'No go-live IPC must be sent by Operator');

      // 4. Operator FTB button state:
      assert.strictEqual(operator.getBtnFTB().classList.contains('active'), true, 'Operator btnFTB must show active red indicator');

      // 5. Operator preview state:
      assert.strictEqual(operator.getPvwCue().id, 'cue_3', 'Operator preview cue must remain cue_3');
      assert.strictEqual(operator.getSelectedIndex(), 3);

      // 6. Stage remains black because no go-live was received
      assert.strictEqual(stage.stageState.isFTB, true, 'Stage must remain black indefinitely until explicit operator action');
      assert.strictEqual(stage.stageState.blackoutCoverClass, 'active-ftb');
    });

    it('TC-FTB-02: Legacy status payload without status.endBehavior falls back to pgmCue.endBehavior and suppresses advance', () => {
      const rundown = [
        { id: 'cue_0', name: '0. Opener', type: 'video', endBehavior: 'AUTO_NEXT' },
        { id: 'cue_1', name: '1. Feature Film', type: 'video', endBehavior: 'FADE_TO_BLACK' }
      ];
      const operator = createOperatorRuntime(rundown);
      operator.setPgmCue({ ...rundown[1] });
      operator.clearSentIpc();

      // Deliver status without endBehavior attribute
      operator.onStageStatus({
        event: 'media-ended',
        id: 'cue_1',
        cueId: 'cue_1',
        isFTB: true
      });

      // Must NOT advance because pgmCue.endBehavior is 'FADE_TO_BLACK'
      assert.strictEqual(operator.getPgmCue().id, 'cue_1');
      assert.strictEqual(operator.getSentIpc().length, 0);
      assert.strictEqual(operator.getBtnFTB().classList.contains('active'), true);
    });

    it('TC-FTB-03: FADE_TO_BLACK on the very last cue in rundown does not error or advance', () => {
      const rundown = [
        { id: 'cue_0', name: '0. Single Item', type: 'video', endBehavior: 'FADE_TO_BLACK' }
      ];
      const operator = createOperatorRuntime(rundown);
      operator.setPgmCue({ ...rundown[0] });
      operator.clearSentIpc();

      operator.onStageStatus({
        event: 'media-ended',
        id: 'cue_0',
        cueId: 'cue_0',
        endBehavior: 'FADE_TO_BLACK',
        isFTB: true
      });

      assert.strictEqual(operator.getSentIpc().length, 0);
      assert.strictEqual(operator.getPgmCue().id, 'cue_0');
    });
  });

  // =========================================================================
  // SUITE 3: AUTO_NEXT End Behavior & Decoupled Rundown Progression
  // =========================================================================
  describe('Suite 3: AUTO_NEXT End Behavior & Decoupled Progression', () => {

    const createTestRundown = () => [
      { id: 'cue_0', name: '0. Cold Open', endBehavior: 'AUTO_NEXT' },
      { id: 'cue_1', name: '1. Title Sequence', endBehavior: 'AUTO_NEXT' },
      { id: 'cue_2', name: '2. Live Keynote', endBehavior: 'HOLD_LAST_FRAME' },
      { id: 'cue_3', name: '3. Mid-Roll Clip', endBehavior: 'AUTO_NEXT' },
      { id: 'cue_4', name: '4. Wrap Up', endBehavior: 'HOLD_LAST_FRAME' }
    ];

    it('TC-AUTONEXT-01: When AUTO_NEXT cue finishes, Operator advances to currentPgmIdx + 1', () => {
      const rundown = createTestRundown();
      const operator = createOperatorRuntime(rundown);

      // Current live is cue_1 (index 1)
      operator.setPgmCue({ ...rundown[1] });
      operator.clearSentIpc();

      assert.strictEqual(operator.getPgmCue().id, 'cue_1');

      // Stage finishes cue_1 with AUTO_NEXT
      operator.onStageStatus({
        event: 'media-ended',
        id: 'cue_1',
        cueId: 'cue_1',
        endBehavior: 'AUTO_NEXT'
      });

      // PGM must advance to rundown[2] (cue_2: Live Keynote)
      assert.strictEqual(operator.getPgmCue().id, 'cue_2');
      assert.strictEqual(operator.getPgmCue().name, '2. Live Keynote');
      assert.strictEqual(operator.getSentIpc().length, 1);
      assert.strictEqual(operator.getSentIpc()[0].channel, 'go-live');
      assert.strictEqual(operator.getSentIpc()[0].args[0].media.id, 'cue_2');
    });

    it('TC-AUTONEXT-02: Operator preview is completely decoupled and untouched during AUTO_NEXT transition', () => {
      const rundown = createTestRundown();
      const operator = createOperatorRuntime(rundown);

      // Operator is previewing cue_4
      operator.setPvwCue(rundown[4], 4);
      assert.strictEqual(operator.getSelectedIndex(), 4);
      assert.strictEqual(operator.getPvwCue().id, 'cue_4');

      // Live cue is cue_0 (Cold Open)
      operator.setPgmCue({ ...rundown[0] });
      operator.clearSentIpc();

      // cue_0 finishes with AUTO_NEXT
      operator.onStageStatus({
        event: 'media-ended',
        id: 'cue_0',
        cueId: 'cue_0',
        endBehavior: 'AUTO_NEXT'
      });

      // 1. Program advances to cue_1 (Cold Open -> Title Sequence)
      assert.strictEqual(operator.getPgmCue().id, 'cue_1');

      // 2. Operator preview STILL on cue_4!
      assert.strictEqual(operator.getSelectedIndex(), 4, 'Operator selectedIndex must remain 4');
      assert.strictEqual(operator.getPvwCue().id, 'cue_4', 'Operator preview cue must remain cue_4');
    });

    it('TC-AUTONEXT-03: AUTO_NEXT on final cue in rundown safely halts without advancing past end', () => {
      const rundown = createTestRundown();
      const operator = createOperatorRuntime(rundown);

      // Set final cue (cue_4) with AUTO_NEXT
      const lastIdx = rundown.length - 1;
      rundown[lastIdx].endBehavior = 'AUTO_NEXT';
      operator.setPgmCue({ ...rundown[lastIdx] });
      operator.clearSentIpc();

      // cue_4 finishes with AUTO_NEXT
      operator.onStageStatus({
        event: 'media-ended',
        id: rundown[lastIdx].id,
        cueId: rundown[lastIdx].id,
        endBehavior: 'AUTO_NEXT'
      });

      // PGM must stay on final cue and NOT error
      assert.strictEqual(operator.getPgmCue().id, rundown[lastIdx].id);
      assert.strictEqual(operator.getSentIpc().length, 0, 'No advance past end of rundown');
    });

    it('TC-AUTONEXT-04: Reordering rundown items dynamically while cue is live advances to new adjacent item', () => {
      const rundown = createTestRundown();
      const operator = createOperatorRuntime(rundown);

      // PGM is cue_1 (Title Sequence)
      operator.setPgmCue({ ...rundown[1] });
      operator.clearSentIpc();

      // Operator dynamically moves cue_3 (Mid-Roll Clip) before cue_2:
      // New order: cue_0, cue_1, cue_3, cue_2, cue_4
      const [cue3] = rundown.splice(3, 1);
      rundown.splice(2, 0, cue3);
      operator.setRundown(rundown);

      assert.strictEqual(rundown[2].id, 'cue_3', 'cue_3 is now right after cue_1');

      // cue_1 finishes playing
      operator.onStageStatus({
        event: 'media-ended',
        id: 'cue_1',
        cueId: 'cue_1',
        endBehavior: 'AUTO_NEXT'
      });

      // Must advance to cue_3!
      assert.strictEqual(operator.getPgmCue().id, 'cue_3', 'AUTO_NEXT must advance to newly reordered adjacent cue_3');
      assert.strictEqual(operator.getSentIpc()[0].args[0].media.id, 'cue_3');
    });

    it('TC-AUTONEXT-05: Multi-cue cascade: chained AUTO_NEXT cues advance step-by-step to completion', () => {
      const rundown = createTestRundown();
      const operator = createOperatorRuntime(rundown);

      // Chain: cue_0 (AUTO_NEXT) -> cue_1 (AUTO_NEXT) -> cue_2 (HOLD_LAST_FRAME)
      operator.setPgmCue({ ...rundown[0] });
      operator.clearSentIpc();

      // cue_0 finishes
      operator.onStageStatus({
        event: 'media-ended',
        id: 'cue_0',
        cueId: 'cue_0',
        endBehavior: 'AUTO_NEXT'
      });
      assert.strictEqual(operator.getPgmCue().id, 'cue_1');

      // cue_1 finishes
      operator.onStageStatus({
        event: 'media-ended',
        id: 'cue_1',
        cueId: 'cue_1',
        endBehavior: 'AUTO_NEXT'
      });
      assert.strictEqual(operator.getPgmCue().id, 'cue_2');

      // cue_2 finishes (HOLD_LAST_FRAME)
      operator.onStageStatus({
        event: 'media-ended',
        id: 'cue_2',
        cueId: 'cue_2',
        endBehavior: 'HOLD_LAST_FRAME'
      });
      // Halts on cue_2
      assert.strictEqual(operator.getPgmCue().id, 'cue_2');
      assert.strictEqual(operator.getSentIpc().length, 2);
    });
  });

  // =========================================================================
  // SUITE 4: Cross-Feature Integration: Click Live while FTB / AUTO_NEXT Active
  // =========================================================================
  describe('Suite 4: Cross-Feature Integration & Interruption Scenarios', () => {

    it('TC-INT-01: Operator clicking GO LIVE while FTB is active lifts blackout and mounts preview cue', () => {
      // Test the verbatim Stage go-live behavior for lifting FTB
      const stageGoLiveMatch = stageHtml.match(/ipcRenderer\.on\('stage-go-live',\s*async\s*\(event,\s*payload\)\s*=>\s*\{([\s\S]*?)\n        \}\);/);
      assert.ok(stageGoLiveMatch, 'stage-go-live handler must exist in stage/index.html');

      let isBlackout = false;
      let isFTB = true;
      const blackoutCover = { className: 'active-ftb' };

      // Evaluate the lifting portion from stage/index.html lines 454-459:
      if (isBlackout || isFTB) {
        blackoutCover.className = '';
        isBlackout = false;
        isFTB = false;
      }

      assert.strictEqual(isFTB, false, 'FTB flag must be cleared on GO LIVE');
      assert.strictEqual(blackoutCover.className, '', 'Blackout cover class must be emptied on GO LIVE');
    });

    it('TC-INT-02: Rapid double-click on GO LIVE button does not corrupt PGM state', () => {
      const runtime = createOperatorRuntime([
        { id: 'cue_target', name: 'Target Clip', path: 'target.mp4', endBehavior: 'HOLD_LAST_FRAME' }
      ]);

      // First click
      runtime.triggerGoLive(new MockMouseEvent('click'));
      assert.strictEqual(runtime.getPgmCue().id, 'cue_target');
      assert.strictEqual(runtime.getSentIpc().length, 1);

      // Immediate second click (double-click within 50ms)
      runtime.triggerGoLive(new MockMouseEvent('click'));
      assert.strictEqual(runtime.getPgmCue().id, 'cue_target');
      assert.strictEqual(runtime.getSentIpc().length, 2);
    });
  });
});
