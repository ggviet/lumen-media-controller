/**
 * tests/harness/panic_hardware_engine.js
 * Panic Controls, Live Overlays & Tactile Hardware Shortcuts Engine for testing R4 requirements.
 */
class PanicAndHardwareEngine {
  constructor() {
    this.isBlackout = false;
    this.isFrozen = false;
    this.isSafeLogo = false;
    this.isFTB = false;
    this.isLive = false;
    this.activeLogoPath = null;
    this.masterVolume = 1.0;
    this.isMuted = false;

    // Overlays state
    this.ticker = {
      visible: false,
      text: '',
      animationDurationSec: 24,
      reflowTriggered: false
    };
    this.watermark = {
      visible: false,
      src: '',
      opacity: 0.8,
      position: 'top-right',
      scalePercent: 100
    };

    // Stage vs Operator UI elements
    this.stageHasFreezeBanner = false; // Clean stage policy: MUST be false!
    this.operatorFreezeTallyActive = false;
    this.operatorBlackoutTallyActive = false;

    this.dispatchTimes = [];
  }

  // Focus-independent input filter
  filterKeyInput(event) {
    const { code, key, targetTagName } = event;
    const isTextInput = ['INPUT', 'TEXTAREA', 'SELECT'].includes(targetTagName ? targetTagName.toUpperCase() : '');

    // Emergency panic keys bypass any text input focus
    const isPanicKey = ['Escape', 'NumpadSubtract', 'NumpadMultiply', 'Numpad4', 'NumpadAdd'].includes(code) ||
                       ['Escape', '-', '*', '+'].includes(key);

    if (isTextInput && !isPanicKey) {
      return { handled: false, action: 'TEXT_INPUT_ALLOWED' };
    }

    const start = performance.now();
    let action = null;

    switch (code) {
      case 'Space':
      case 'NumpadEnter':
        action = 'GO_LIVE';
        break;
      case 'KeyB':
      case 'Escape':
      case 'NumpadSubtract':
        action = 'BLACKOUT';
        break;
      case 'KeyF':
      case 'NumpadMultiply':
        action = 'FREEZE';
        break;
      case 'KeyL':
      case 'Numpad4':
        action = 'SAFE_LOGO';
        break;
      case 'KeyT':
      case 'NumpadAdd':
        action = 'FTB';
        break;
      case 'KeyM':
      case 'NumpadDivide':
        action = 'MUTE';
        break;
      default:
        // Key fallback
        if (key === 'Escape' || key === '-') action = 'BLACKOUT';
        else if (key === '*') action = 'FREEZE';
        else if (key === '+') action = 'FTB';
        break;
    }

    if (!action) {
      return { handled: false, action: null };
    }

    const result = this.executePanicAction(action);
    const latencyMs = performance.now() - start;
    this.dispatchTimes.push({ action, latencyMs, timestamp: Date.now() });

    return {
      handled: true,
      action,
      latencyMs,
      bypassedInputFocus: isTextInput,
      state: result
    };
  }

  executePanicAction(action, payload = null) {
    switch (action) {
      case 'BLACKOUT':
        this.isBlackout = !this.isBlackout;
        this.operatorBlackoutTallyActive = this.isBlackout;
        if (this.isBlackout) {
          // Hard mute and pause on blackout
          this.isMuted = true;
        }
        return { isBlackout: this.isBlackout, isMuted: this.isMuted };

      case 'FREEZE':
        this.isFrozen = !this.isFrozen;
        // Clean Stage Guarantee: Stage window NEVER shows freeze banner!
        this.stageHasFreezeBanner = false;
        // Operator UI displays prominent tally
        this.operatorFreezeTallyActive = this.isFrozen;
        return { isFrozen: this.isFrozen, stageHasFreezeBanner: false, operatorTally: this.operatorFreezeTallyActive };

      case 'SAFE_LOGO':
        this.isSafeLogo = !this.isSafeLogo;
        if (payload && payload.logoPath) {
          this.activeLogoPath = payload.logoPath;
        }
        return { isSafeLogo: this.isSafeLogo, logoPath: this.activeLogoPath };

      case 'FTB':
        this.isFTB = !this.isFTB;
        return { isFTB: this.isFTB };

      case 'GO_LIVE':
        this.isLive = true;
        if (this.isBlackout) this.isBlackout = false;
        if (this.isFTB) this.isFTB = false;
        if (this.isSafeLogo) this.isSafeLogo = false;
        return { isLive: true, isBlackout: false, isFTB: false, isSafeLogo: false };

      case 'MUTE':
        this.isMuted = !this.isMuted;
        return { isMuted: this.isMuted };

      default:
        throw new Error(`Unknown panic action: ${action}`);
    }
  }

  // Parse Web MIDI message
  parseMIDIMessage(data) {
    if (!data || data.length < 3) {
      return { handled: false, error: 'Invalid MIDI packet' };
    }
    const [status, noteOrCC, velocity] = data;
    const command = status >> 4;

    // Note On (command 9) with velocity > 0
    if (command === 9 && velocity > 0) {
      switch (noteOrCC) {
        case 36: return { handled: true, type: 'note', action: 'GO_LIVE', note: 36, velocity, state: this.executePanicAction('GO_LIVE') };
        case 37: return { handled: true, type: 'note', action: 'BLACKOUT', note: 37, velocity, state: this.executePanicAction('BLACKOUT') };
        case 38: return { handled: true, type: 'note', action: 'FREEZE', note: 38, velocity, state: this.executePanicAction('FREEZE') };
        case 39: return { handled: true, type: 'note', action: 'SAFE_LOGO', note: 39, velocity, state: this.executePanicAction('SAFE_LOGO') };
        case 40: return { handled: true, type: 'note', action: 'FTB', note: 40, velocity, state: this.executePanicAction('FTB') };
        case 41: return { handled: true, type: 'note', action: 'MUTE', note: 41, velocity, state: this.executePanicAction('MUTE') };
        default: return { handled: false, type: 'note', note: noteOrCC, velocity, error: 'Unmapped MIDI note' };
      }
    }

    // Note On with velocity 0 is treated as Note Off (do nothing)
    if (command === 9 && velocity === 0) {
      return { handled: true, type: 'note_off', note: noteOrCC, velocity: 0 };
    }

    // Note Off (command 8)
    if (command === 8) {
      return { handled: true, type: 'note_off', note: noteOrCC, velocity };
    }

    // Control Change (command 11)
    if (command === 11) {
      if (noteOrCC === 7) { // CC 7: Master Volume Fader
        const normalized = Math.max(0, Math.min(1.0, velocity / 127));
        this.masterVolume = Number(normalized.toFixed(3));
        return {
          handled: true,
          type: 'cc',
          action: 'SET_VOLUME',
          cc: 7,
          velocity,
          normalizedVolume: this.masterVolume
        };
      }
      return { handled: false, type: 'cc', cc: noteOrCC, velocity, error: 'Unmapped MIDI CC' };
    }

    return { handled: false, error: 'Unsupported MIDI command', command };
  }

  // Update live text ticker with animation reset reflow
  updateTicker(text) {
    if (!text || typeof text !== 'string') {
      this.ticker.visible = false;
      this.ticker.text = '';
      return this.ticker;
    }
    const charCount = text.length;
    // Dynamic readable speed: minimum 14 seconds
    const duration = Math.max(14, charCount * 0.35);
    this.ticker = {
      visible: true,
      text: text,
      animationDurationSec: Number(duration.toFixed(2)),
      reflowTriggered: true // Indicates CSS reflow triggered to prevent animation snap
    };
    return this.ticker;
  }

  // Watermark overlay configuration
  updateWatermark(options = {}) {
    this.watermark = {
      ...this.watermark,
      ...options
    };
    // Clamp opacity [0.0, 1.0]
    if (typeof this.watermark.opacity === 'number') {
      this.watermark.opacity = Math.max(0.0, Math.min(1.0, this.watermark.opacity));
    }
    // Clamp scale [10, 200]
    if (typeof this.watermark.scalePercent === 'number') {
      this.watermark.scalePercent = Math.max(10, Math.min(200, this.watermark.scalePercent));
    }
    return this.watermark;
  }
}

module.exports = { PanicAndHardwareEngine };
