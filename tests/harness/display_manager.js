/**
 * tests/harness/display_manager.js
 * Multi-Display & Screen Lifecycle Engine for testing R2 requirements.
 */
class DisplayManagerEngine {
  constructor() {
    this.displays = [];
    this.primaryDisplayId = 1;
    this.selectedStageDisplayId = null;
    this.stageWindowConfig = null;
    this.powerSaveId = null;
    this.powerSaveActive = false;
    this.metricsDebounceMs = 400;
    this.pendingDebounceTimer = null;
  }

  setDisplays(displays, primaryId = 1) {
    this.displays = [...displays];
    this.primaryDisplayId = primaryId;
  }

  getPrimaryDisplay() {
    return this.displays.find(d => d.id === this.primaryDisplayId) || this.displays[0];
  }

  getAvailableDisplays() {
    const primary = this.getPrimaryDisplay();
    return this.displays.map((disp, idx) => {
      const isPrimary = disp.id === primary.id;
      return {
        id: disp.id,
        label: disp.label || `Display ${idx + 1}: ${disp.bounds.width}x${disp.bounds.height} ${isPrimary ? '(Primary)' : '(External)'}`,
        width: disp.bounds.width,
        height: disp.bounds.height,
        bounds: { ...disp.bounds },
        isPrimary: isPrimary,
        isExternal: !isPrimary,
        scaleFactor: disp.scaleFactor || 1.0
      };
    });
  }

  detectTargetStageDisplay(preferredId = null) {
    const primary = this.getPrimaryDisplay();
    if (preferredId) {
      const match = this.displays.find(d => String(d.id) === String(preferredId));
      if (match) {
        return { display: match, isExternal: match.id !== primary.id };
      }
    }
    // Prefer external display
    const external = this.displays.find(d => d.id !== primary.id);
    if (external) {
      return { display: external, isExternal: true };
    }
    // Single display fallback
    return { display: primary, isExternal: false };
  }

  reanchorStageWindow(preferredId = null) {
    const { display: target, isExternal } = this.detectTargetStageDisplay(preferredId);
    this.selectedStageDisplayId = isExternal ? target.id : null;
    const primary = this.getPrimaryDisplay();

    if (isExternal) {
      // Borderless kiosk on external target display
      this.stageWindowConfig = {
        x: target.bounds.x,
        y: target.bounds.y,
        width: target.bounds.width,
        height: target.bounds.height,
        frame: false,
        resizable: false,
        alwaysOnTop: true,
        alwaysOnTopLevel: 'screen-saver',
        kiosk: true,
        isDockedPreview: false,
        displayId: target.id
      };
    } else {
      // SAFE SINGLE-DISPLAY FALLBACK:
      // CRITICAL: NEVER cover or blind the Operator UI!
      // Dock or shrink Stage window to floating preview window
      const previewW = Math.min(960, Math.floor(primary.bounds.width * 0.5));
      const previewH = Math.min(540, Math.floor(primary.bounds.height * 0.5));
      this.stageWindowConfig = {
        x: target.bounds.x + target.bounds.width - previewW - 20,
        y: target.bounds.y + target.bounds.height - previewH - 40,
        width: previewW,
        height: previewH,
        frame: true,
        resizable: true,
        alwaysOnTop: false,
        kiosk: false,
        isDockedPreview: true,
        displayId: target.id
      };
    }

    return this.stageWindowConfig;
  }

  handleDisplayRemoved(removedId) {
    this.displays = this.displays.filter(d => d.id !== removedId);
    if (this.selectedStageDisplayId === removedId) {
      this.selectedStageDisplayId = null;
    }
    return this.reanchorStageWindow(this.selectedStageDisplayId);
  }

  handleDisplayAdded(newDisplay) {
    this.displays.push(newDisplay);
    return this.reanchorStageWindow(this.selectedStageDisplayId);
  }

  handleDisplayMetricsChanged(updatedDisplay, callback) {
    const idx = this.displays.findIndex(d => d.id === updatedDisplay.id);
    if (idx !== -1) {
      this.displays[idx] = { ...this.displays[idx], ...updatedDisplay };
    }
    if (this.pendingDebounceTimer) {
      clearTimeout(this.pendingDebounceTimer);
    }
    return new Promise(resolve => {
      this.pendingDebounceTimer = setTimeout(() => {
        const config = this.reanchorStageWindow(this.selectedStageDisplayId);
        if (callback) callback(config);
        resolve(config);
      }, this.metricsDebounceMs);
    });
  }

  startPowerSaveBlocker(type = 'prevent-display-sleep') {
    if (type === 'prevent-display-sleep') {
      this.powerSaveId = 1001;
      this.powerSaveActive = true;
      return this.powerSaveId;
    }
    return null;
  }

  stopPowerSaveBlocker(id) {
    if (this.powerSaveId === id) {
      this.powerSaveActive = false;
      this.powerSaveId = null;
      return true;
    }
    return false;
  }

  isPowerSaveActive() {
    return this.powerSaveActive;
  }
}

module.exports = { DisplayManagerEngine };
