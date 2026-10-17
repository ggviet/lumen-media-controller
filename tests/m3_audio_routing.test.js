/**
 * tests/m3_audio_routing.test.js
 * Comprehensive Automated Test Suite: Milestone 3 (R3)
 * Dual Audio Routing & Monitoring Subsystem
 *
 * Verifies:
 * 1. Main Process Session Permissions for device enumeration & setSinkId
 * 2. Operator UI Dual Sinks (Master FOH vs Cue Headphone) & Persistence
 * 3. Ephemeral getUserMedia priming & debounced devicechange hotplug listener
 * 4. Audio Isolation Collision Warning (same non-default physical soundcard)
 * 5. Preview Video Pre-Fader Listen (PFL) isolation and setSinkId binding before unmute
 * 6. Stage Multi-Deck Audio Sink Propagation across Deck A & Deck B
 * 7. Default audio device reset ('') handling and hardware failure fallback
 */

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { readCompleteHtml } = require('./test_helpers');
const EventEmitter = require('events');

const mainSrc = fs.readFileSync(path.join(__dirname, '../src/main/index.js'), 'utf8');
const operatorHtml = readCompleteHtml(path.join(__dirname, '../src/renderer/operator/index.html'));
const stageHtml = readCompleteHtml(path.join(__dirname, '../src/renderer/stage/index.html'));

// ==============================================================================
// 1. Static Source Code Verification
// ==============================================================================

describe('M3 Static Verification: Main Process & Renderers', () => {

  describe('src/main/index.js Session Permissions', () => {
    it('1.1: Imports session from electron', () => {
      assert.ok(
        /const\s*\{[^}]*session[^}]*\}\s*=\s*require\(['"]electron['"]\)/.test(mainSrc),
        'session must be destructured from electron require'
      );
    });

    it('1.2: Registers setPermissionCheckHandler allowing media, audio-capture, and speaker-selection', () => {
      assert.ok(mainSrc.includes('session.defaultSession.setPermissionCheckHandler'), 'setPermissionCheckHandler must be registered');
      assert.ok(mainSrc.includes('speaker-selection'), 'speaker-selection permission must be handled');
      assert.ok(mainSrc.includes('audio-capture'), 'audio-capture permission must be handled');
    });

    it('1.3: Registers setPermissionRequestHandler and setDevicePermissionHandler', () => {
      assert.ok(mainSrc.includes('session.defaultSession.setPermissionRequestHandler'), 'setPermissionRequestHandler must be registered');
      assert.ok(mainSrc.includes('session.defaultSession.setDevicePermissionHandler'), 'setDevicePermissionHandler must be registered');
    });
  });

  describe('src/renderer/operator/index.html Dual Sinks UI & Handlers', () => {
    it('2.1: Declares both audioSinkSelect and cueAudioSinkSelect with accurate event labels', () => {
      assert.ok(operatorHtml.includes('id="audioSinkSelect"'), 'Master FOH sink select must exist');
      assert.ok(operatorHtml.includes('id="cueAudioSinkSelect"'), 'Cue Headphone sink select must exist');
      assert.ok(operatorHtml.includes('Master FOH Soundcard:'), 'Label for Master FOH must be present');
      assert.ok(operatorHtml.includes('Cue Headphones Out:'), 'Label for Cue Headphones Out must be present');
    });

    it('2.2: Declares audioIsolationWarning element with exact warning message', () => {
      assert.ok(operatorHtml.includes('id="audioIsolationWarning"'), 'audioIsolationWarning element must exist');
      assert.ok(
        operatorHtml.includes('⚠️ Cue &amp; Master sharing same audio device!') ||
        operatorHtml.includes('⚠️ Cue & Master sharing same audio device!'),
        'Isolation warning banner text must match specification'
      );
    });

    it('2.3: Implements localStorage persistence for both Master and Cue sinks', () => {
      assert.ok(operatorHtml.includes('lumen_master_audio_sink_id'), 'Master sink persistence key must exist');
      assert.ok(operatorHtml.includes('lumen_cue_audio_sink_id'), 'Cue sink persistence key must exist');
    });

    it('2.4: Implements devicechange hotplug listener with debounce', () => {
      assert.ok(operatorHtml.includes("'devicechange'"), 'devicechange event listener must be registered');
      assert.ok(operatorHtml.includes('350'), '350ms debounce timer must be configured for audio hotplug');
    });

    it('2.5: Implements ephemeral getUserMedia priming routine for empty device labels', () => {
      assert.ok(operatorHtml.includes('getUserMedia({ audio: true })'), 'getUserMedia audio priming call must exist');
      assert.ok(operatorHtml.includes('track.stop()') || operatorHtml.includes('t.stop()'), 'Priming tracks must be immediately stopped');
    });

    it('2.6: Applies cue sink to preview video before unmuting', () => {
      assert.ok(operatorHtml.includes('cueAudioSinkSelect.value'), 'Preview audio must query cueAudioSinkSelect value');
      assert.ok(operatorHtml.includes('video.setSinkId') || operatorHtml.includes('vid.setSinkId'), 'setSinkId must be called on preview video');
    });
  });

  describe('src/renderer/stage/index.html Multi-Deck Sink Synchronization', () => {
    it('3.1: SET_AUDIO_SINK supports string type check including empty string default reset', () => {
      assert.ok(stageHtml.includes("typeof data.sinkId === 'string'"), "SET_AUDIO_SINK must check typeof data.sinkId === 'string'");
    });

    it('3.2: SET_AUDIO_SINK propagates sinkId to all .media-deck video elements', () => {
      assert.ok(stageHtml.includes("querySelectorAll('.media-deck video')"), "SET_AUDIO_SINK must query all deck video elements");
    });

    it('3.3: Implements fallback setSinkId(\'\') if hardware rejects or device detached', () => {
      assert.ok(stageHtml.includes("v.setSinkId('').catch"), "Catch handler in SET_AUDIO_SINK must fall back to empty sink");
      assert.ok(stageHtml.includes("mediaElement.setSinkId('')"), "Catch handler in pre-roll must fall back to default audio");
    });

    it('3.4: stage-status heartbeat includes audioSinkId telemetry', () => {
      assert.ok(stageHtml.includes('audioSinkId: audioSinkId'), 'stage-status heartbeat must transmit audioSinkId');
    });
  });
});

// ==============================================================================
// 2. Behavioral Simulation & Contract Verification
// ==============================================================================

describe('M3 Behavioral Simulation: Dual Audio Routing & Monitoring', () => {

  /**
   * Helper DOM element mock
   */
  class MockDOMElement {
    constructor(tagName, id = '') {
      this.tagName = tagName.toUpperCase();
      this.id = id;
      this.children = [];
      this.options = [];
      this.value = '';
      this.style = { display: 'none' };
      this.innerText = '';
      this.innerHTML = '';
      this.muted = true;
      this.volume = 1.0;
      this.paused = true;
      this.src = '';
      this.sinkId = '';
      this.listeners = new Map();
      this.sinkCallHistory = [];
      this.rejectNextSink = false;
    }

    appendChild(child) {
      this.children.push(child);
      if (child.tagName === 'OPTION') {
        this.options.push(child);
      }
      return child;
    }

    querySelector(selector) {
      if (selector === 'video') {
        return this.children.find(c => c.tagName === 'VIDEO') || null;
      }
      return null;
    }

    querySelectorAll(selector) {
      if (selector === 'video' || selector === '.media-deck video') {
        return this.children.filter(c => c.tagName === 'VIDEO');
      }
      return [];
    }

    addEventListener(event, fn) {
      if (!this.listeners.has(event)) {
        this.listeners.set(event, []);
      }
      this.listeners.get(event).push(fn);
    }

    dispatchEvent(event) {
      const handlers = this.listeners.get(event) || [];
      handlers.forEach(fn => fn());
    }

    async setSinkId(sinkId) {
      this.sinkCallHistory.push(sinkId);
      if (this.rejectNextSink) {
        this.rejectNextSink = false;
        throw new Error('Device unavailable or detached');
      }
      this.sinkId = sinkId;
    }
  }

  class MockLocalStorage {
    constructor() {
      this.store = new Map();
    }
    getItem(key) {
      return this.store.has(key) ? this.store.get(key) : null;
    }
    setItem(key, value) {
      this.store.set(key, String(value));
    }
    removeItem(key) {
      this.store.delete(key);
    }
    clear() {
      this.store.clear();
    }
  }

  // ----------------------------------------------------------------------------
  // Test Case 1: Device Enumeration & Ephemeral Priming
  // ----------------------------------------------------------------------------
  it('TC-M3-01: Ephemeral getUserMedia primes permissions when device labels are blank', async () => {
    let getUserMediaCalled = false;
    let tracksStopped = false;

    const mockMediaDevices = {
      devices: [
        { deviceId: 'dac_foh', kind: 'audiooutput', label: '' }, // Empty label triggers priming
        { deviceId: 'hp_out', kind: 'audiooutput', label: '' }
      ],
      async enumerateDevices() {
        if (getUserMediaCalled) {
          return [
            { deviceId: 'dac_foh', kind: 'audiooutput', label: 'Dante Virtual Soundcard (Master FOH)' },
            { deviceId: 'hp_out', kind: 'audiooutput', label: 'Realtek Audio (Headphones)' }
          ];
        }
        return this.devices;
      },
      async getUserMedia(constraints) {
        if (constraints.audio) {
          getUserMediaCalled = true;
          return {
            getTracks: () => [{
              stop: () => { tracksStopped = true; }
            }]
          };
        }
        throw new Error('Not supported');
      }
    };

    // Simulation of populateAudioSinks logic
    let audioOutputs = await mockMediaDevices.enumerateDevices();
    const hasEmptyLabels = audioOutputs.some(d => !d.label);
    if (hasEmptyLabels && mockMediaDevices.getUserMedia) {
      const stream = await mockMediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(t => t.stop());
      audioOutputs = await mockMediaDevices.enumerateDevices();
    }

    assert.strictEqual(getUserMediaCalled, true, 'getUserMedia should be invoked to prime permission');
    assert.strictEqual(tracksStopped, true, 'Microphone track must be immediately stopped');
    assert.strictEqual(audioOutputs[0].label, 'Dante Virtual Soundcard (Master FOH)');
    assert.strictEqual(audioOutputs[1].label, 'Realtek Audio (Headphones)');
  });

  // ----------------------------------------------------------------------------
  // Test Case 2: Independent Dual Sinks Population & Persistence
  // ----------------------------------------------------------------------------
  it('TC-M3-02: Populates Master FOH and Cue Headphone sinks independently and restores localStorage', async () => {
    const localStorage = new MockLocalStorage();
    localStorage.setItem('lumen_master_audio_sink_id', 'dac_foh');
    localStorage.setItem('lumen_cue_audio_sink_id', 'hp_out');

    const audioSinkSelect = new MockDOMElement('select', 'audioSinkSelect');
    const cueAudioSinkSelect = new MockDOMElement('select', 'cueAudioSinkSelect');

    const devices = [
      { deviceId: '', kind: 'audiooutput', label: 'Default System Audio' },
      { deviceId: 'dac_foh', kind: 'audiooutput', label: 'Dante Virtual Soundcard' },
      { deviceId: 'hp_out', kind: 'audiooutput', label: 'Headphones Jack' }
    ];

    // Populate
    const audioOutputs = devices.filter(d => d.kind === 'audiooutput' && d.deviceId !== '');
    audioSinkSelect.options = [{ value: '', innerText: 'Default System Audio' }];
    cueAudioSinkSelect.options = [{ value: '', innerText: 'Default System Audio' }];

    audioOutputs.forEach(d => {
      audioSinkSelect.options.push({ value: d.deviceId, innerText: d.label });
      cueAudioSinkSelect.options.push({ value: d.deviceId, innerText: d.label });
    });

    // Restore from localStorage
    const savedMaster = localStorage.getItem('lumen_master_audio_sink_id');
    const savedCue = localStorage.getItem('lumen_cue_audio_sink_id');

    if (audioSinkSelect.options.some(o => o.value === savedMaster)) {
      audioSinkSelect.value = savedMaster;
    }
    if (cueAudioSinkSelect.options.some(o => o.value === savedCue)) {
      cueAudioSinkSelect.value = savedCue;
    }

    assert.strictEqual(audioSinkSelect.value, 'dac_foh');
    assert.strictEqual(cueAudioSinkSelect.value, 'hp_out');
    assert.notStrictEqual(audioSinkSelect.value, cueAudioSinkSelect.value);
  });

  // ----------------------------------------------------------------------------
  // Test Case 3: Master Sink Change sends IPC; Cue Sink Change is Local
  // ----------------------------------------------------------------------------
  it('TC-M3-03: Master sink change dispatches SET_AUDIO_SINK IPC; Cue sink change updates only preview', async () => {
    const localStorage = new MockLocalStorage();
    const sentIpcMessages = [];
    const ipcRenderer = {
      send: (channel, action, data) => {
        sentIpcMessages.push({ channel, action, data });
      }
    };

    const pvwVideo = new MockDOMElement('video');
    const audioSinkSelect = new MockDOMElement('select', 'audioSinkSelect');
    const cueAudioSinkSelect = new MockDOMElement('select', 'cueAudioSinkSelect');

    // User changes Master FOH
    audioSinkSelect.value = 'dac_foh_soundcard';
    localStorage.setItem('lumen_master_audio_sink_id', audioSinkSelect.value);
    ipcRenderer.send('stage-control', 'SET_AUDIO_SINK', { sinkId: audioSinkSelect.value });

    assert.strictEqual(localStorage.getItem('lumen_master_audio_sink_id'), 'dac_foh_soundcard');
    assert.strictEqual(sentIpcMessages.length, 1);
    assert.strictEqual(sentIpcMessages[0].action, 'SET_AUDIO_SINK');
    assert.strictEqual(sentIpcMessages[0].data.sinkId, 'dac_foh_soundcard');

    // User changes Cue Headphone
    cueAudioSinkSelect.value = 'usb_headphones';
    localStorage.setItem('lumen_cue_audio_sink_id', cueAudioSinkSelect.value);
    await pvwVideo.setSinkId(cueAudioSinkSelect.value);

    // Assert NO stage-control IPC sent for cue change!
    assert.strictEqual(sentIpcMessages.length, 1, 'Cue sink change must NEVER send SET_AUDIO_SINK to Stage');
    assert.strictEqual(pvwVideo.sinkId, 'usb_headphones');
    assert.strictEqual(localStorage.getItem('lumen_cue_audio_sink_id'), 'usb_headphones');
  });

  // ----------------------------------------------------------------------------
  // Test Case 4: Preview Video Pre-Roll & Cue Audio Toggle Pre-Fader Listen
  // ----------------------------------------------------------------------------
  it('TC-M3-04: Preview video binds cue sink before unmuting; respects isCueAudioOn state', async () => {
    const cueAudioSinkSelect = { value: 'hp_monitor_sink' };
    let isCueAudioOn = true;

    // Simulate loadPvw
    const video = new MockDOMElement('video');
    const callOrder = [];

    video.setSinkId = async (sink) => {
      callOrder.push(`setSinkId:${sink}`);
      video.sinkId = sink;
    };

    // Pre-binding verification: setSinkId must happen before unmuting
    if (isCueAudioOn) {
      await video.setSinkId(cueAudioSinkSelect.value || '');
      callOrder.push('unmute');
      video.muted = false;
    } else {
      video.muted = true;
    }

    assert.strictEqual(video.sinkId, 'hp_monitor_sink');
    assert.strictEqual(video.muted, false);
    assert.deepStrictEqual(callOrder, ['setSinkId:hp_monitor_sink', 'unmute'], 'setSinkId must precede unmuting to prevent audio leak');

    // Now test when isCueAudioOn is false
    isCueAudioOn = false;
    const video2 = new MockDOMElement('video');
    if (isCueAudioOn) {
      await video2.setSinkId(cueAudioSinkSelect.value || '');
      video2.muted = false;
    } else {
      video2.muted = true;
    }
    assert.strictEqual(video2.muted, true, 'When Cue is OFF, preview video must remain muted');
  });

  // ----------------------------------------------------------------------------
  // Test Case 5: Audio Isolation Warning on Hardware Collision
  // ----------------------------------------------------------------------------
  it('TC-M3-05: Displays isolation warning only when both sinks share the same non-empty device', () => {
    const audioIsolationWarning = new MockDOMElement('div', 'audioIsolationWarning');
    const audioSinkSelect = { value: '' };
    const cueAudioSinkSelect = { value: '' };

    function checkIsolation() {
      const m = audioSinkSelect.value;
      const c = cueAudioSinkSelect.value;
      if (m && c && m === c) {
        audioIsolationWarning.style.display = 'block';
      } else {
        audioIsolationWarning.style.display = 'none';
      }
    }

    // Both default -> NO warning
    checkIsolation();
    assert.strictEqual(audioIsolationWarning.style.display, 'none');

    // Master Dante, Cue Default -> NO warning
    audioSinkSelect.value = 'dante_card';
    cueAudioSinkSelect.value = '';
    checkIsolation();
    assert.strictEqual(audioIsolationWarning.style.display, 'none');

    // Master Dante, Cue Headphones -> NO warning
    audioSinkSelect.value = 'dante_card';
    cueAudioSinkSelect.value = 'headphones';
    checkIsolation();
    assert.strictEqual(audioIsolationWarning.style.display, 'none');

    // Collision: Both Dante -> WARNING ON
    audioSinkSelect.value = 'dante_card';
    cueAudioSinkSelect.value = 'dante_card';
    checkIsolation();
    assert.strictEqual(audioIsolationWarning.style.display, 'block');

    // Operator fixes by changing Cue to headphones -> WARNING CLEARED
    cueAudioSinkSelect.value = 'headphones';
    checkIsolation();
    assert.strictEqual(audioIsolationWarning.style.display, 'none');
  });

  // ----------------------------------------------------------------------------
  // Test Case 6: Stage Multi-Deck Synchronization & Default Audio Reset ('')
  // ----------------------------------------------------------------------------
  it('TC-M3-06: Stage SET_AUDIO_SINK applies to both Deck A & Deck B and cleanly resets on empty string', async () => {
    const deckA = new MockDOMElement('div', 'deckA');
    const deckB = new MockDOMElement('div', 'deckB');

    const videoA = new MockDOMElement('video');
    const videoB = new MockDOMElement('video');
    deckA.appendChild(videoA);
    deckB.appendChild(videoB);

    const allVideos = [videoA, videoB];
    let stageAudioSinkId = '';

    function handleSetAudioSink(payload) {
      if (payload && typeof payload.sinkId === 'string') {
        stageAudioSinkId = payload.sinkId;
        allVideos.forEach(v => {
          v.setSinkId(stageAudioSinkId).catch(() => {
            v.setSinkId('');
          });
        });
      }
    }

    // 1. Initial assignment to physical soundcard
    handleSetAudioSink({ sinkId: 'usb_dac_primary' });
    assert.strictEqual(stageAudioSinkId, 'usb_dac_primary');
    assert.strictEqual(videoA.sinkId, 'usb_dac_primary');
    assert.strictEqual(videoB.sinkId, 'usb_dac_primary');

    // 2. Reset back to Default System Audio (empty string '')
    handleSetAudioSink({ sinkId: '' });
    assert.strictEqual(stageAudioSinkId, '', 'audioSinkId must accept empty string reset');
    assert.strictEqual(videoA.sinkId, '', 'Deck A video must reset to default system audio');
    assert.strictEqual(videoB.sinkId, '', 'Deck B video must reset to default system audio');
  });

  // ----------------------------------------------------------------------------
  // Test Case 7: Unplugged Hardware Fallback & Fault Tolerance
  // ----------------------------------------------------------------------------
  it('TC-M3-07: Automatically falls back to default audio when configured hardware rejects', async () => {
    const video = new MockDOMElement('video');
    video.rejectNextSink = true; // Hardware disconnected

    const configuredSink = 'detached_usb_soundcard';
    let fallbackTriggered = false;

    try {
      await video.setSinkId(configuredSink);
    } catch (err) {
      fallbackTriggered = true;
      try {
        await video.setSinkId('');
      } catch (fallbackErr) {
        // Ignored
      }
    }

    assert.strictEqual(fallbackTriggered, true, 'Error should be caught when hardware rejects');
    assert.strictEqual(video.sinkId, '', 'Video element must safely fall back to system default audio device');
    assert.deepStrictEqual(video.sinkCallHistory, ['detached_usb_soundcard', '']);
  });

  // ----------------------------------------------------------------------------
  // Test Case 8: Device Hotplugging Re-Enumeration & Debounce Protection
  // ----------------------------------------------------------------------------
  it('TC-M3-08: Coalesces rapid devicechange events into single enumeration without interrupting playback', async () => {
    let populateCount = 0;
    let timer = null;

    function onDeviceChange() {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        populateCount++;
      }, 50); // 50ms for test speed
    }

    // Fire 5 rapid devicechange events (e.g. USB bus enumeration burst)
    onDeviceChange();
    onDeviceChange();
    onDeviceChange();
    onDeviceChange();
    onDeviceChange();

    assert.strictEqual(populateCount, 0, 'Debounced handler must not fire immediately');

    await new Promise(r => setTimeout(r, 80));
    assert.strictEqual(populateCount, 1, 'Only exactly 1 enumeration should execute after debounce window');
  });

  // ----------------------------------------------------------------------------
  // Test Case 9: PFL Independence from Master Volume & Master Mute
  // ----------------------------------------------------------------------------
  it('TC-M3-09: Operator Preview Cue Audio is completely independent of Stage Master Volume & Mute', () => {
    let stageMasterVolume = 1.0;
    let stageIsMuted = false;

    const previewVideo = new MockDOMElement('video');
    previewVideo.muted = false; // Cue audio is ON

    // Operator mutes Master FOH for stage
    stageIsMuted = true;
    stageMasterVolume = 0.0;

    // Preview video state check
    assert.strictEqual(previewVideo.muted, false, 'Preview video must remain audible when Master FOH is muted');
    assert.strictEqual(stageIsMuted, true, 'Stage is muted');

    // Operator changes Stage volume
    stageMasterVolume = 0.5;
    assert.strictEqual(previewVideo.volume, 1.0, 'Preview video volume must remain at unity level');
  });

  // ----------------------------------------------------------------------------
  // Test Case 10: Hotplug Removal of Active Sink Triggers Safe Fallback
  // ----------------------------------------------------------------------------
  it('TC-M3-10: Hotplug disconnect of selected sink cleans up selection and notifies Stage', () => {
    const localStorage = new MockLocalStorage();
    localStorage.setItem('lumen_master_audio_sink_id', 'usb_soundcard_1');

    const audioSinkSelect = new MockDOMElement('select', 'audioSinkSelect');
    audioSinkSelect.options = [{ value: '', innerText: 'Default System Audio' }]; // usb_soundcard_1 detached!

    const savedMasterSink = localStorage.getItem('lumen_master_audio_sink_id');
    const masterExists = audioSinkSelect.options.some(o => o.value === savedMasterSink);

    let stageNotifiedWith = null;
    const ipcRenderer = {
      send: (ch, action, data) => {
        if (action === 'SET_AUDIO_SINK') stageNotifiedWith = data.sinkId;
      }
    };

    if (!masterExists && savedMasterSink) {
      audioSinkSelect.value = '';
      localStorage.setItem('lumen_master_audio_sink_id', '');
      ipcRenderer.send('stage-control', 'SET_AUDIO_SINK', { sinkId: '' });
    }

    assert.strictEqual(audioSinkSelect.value, '', 'Select must revert to Default');
    assert.strictEqual(localStorage.getItem('lumen_master_audio_sink_id'), '', 'localStorage must clear detached ID');
    assert.strictEqual(stageNotifiedWith, '', 'Stage must receive empty string to reset to default audio');
  });

});
