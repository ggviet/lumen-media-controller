/**
 * tests/harness/audio_subsystem.js
 * Independent Dual Audio Routing & Monitoring Subsystem for testing R3 requirements.
 */
class AudioSubsystemEngine {
  constructor() {
    this.masterVolume = 1.0;
    this.isMuted = false;
    this.stageAudioSinkId = ''; // Master FOH deviceId
    this.cueAudioSinkId = '';   // Cue Headphone deviceId
    this.isCueAudioOn = false;  // Preview headphone monitor toggle
    this.devices = [
      { deviceId: '', label: 'Default System Audio', kind: 'audiooutput' },
      { deviceId: 'dev_foh_soundcard', label: 'Dante Virtual Soundcard (Master FOH)', kind: 'audiooutput' },
      { deviceId: 'dev_headphone_jack', label: 'Realtek High Definition Audio (Headphones)', kind: 'audiooutput' }
    ];
  }

  getAudioOutputs() {
    return this.devices.filter(d => d.kind === 'audiooutput');
  }

  setStageAudioSink(sinkId) {
    const exists = this.devices.some(d => d.deviceId === sinkId);
    if (!exists && sinkId !== '') {
      throw new Error(`Invalid audio sink device ID: ${sinkId}`);
    }
    this.stageAudioSinkId = sinkId;
    return this.stageAudioSinkId;
  }

  setCueAudioSink(sinkId) {
    const exists = this.devices.some(d => d.deviceId === sinkId);
    if (!exists && sinkId !== '') {
      throw new Error(`Invalid audio sink device ID: ${sinkId}`);
    }
    this.cueAudioSinkId = sinkId;
    return this.cueAudioSinkId;
  }

  setMasterVolume(vol) {
    // Clamping to [0.0, 1.0]
    const clamped = Math.max(0.0, Math.min(1.0, Number(vol) || 0.0));
    this.masterVolume = clamped;
    return this.masterVolume;
  }

  toggleMute(forcedState = null) {
    this.isMuted = forcedState !== null ? Boolean(forcedState) : !this.isMuted;
    return this.isMuted;
  }

  toggleCueAudio(forcedState = null) {
    this.isCueAudioOn = forcedState !== null ? Boolean(forcedState) : !this.isCueAudioOn;
    return this.isCueAudioOn;
  }

  // Calculate audio crossfade ramp
  calculateCrossfadeCurve(durationMs, steps = 10, type = 'linear') {
    const result = [];
    const stepTime = durationMs / steps;
    for (let i = 0; i <= steps; i++) {
      const progress = i / steps;
      let inVol, outVol;
      if (type === 'equal-power') {
        // Equal power (constant energy) curve
        inVol = Math.sin(progress * (Math.PI / 2)) * this.masterVolume;
        outVol = Math.cos(progress * (Math.PI / 2)) * this.masterVolume;
      } else {
        // Linear curve
        inVol = progress * this.masterVolume;
        outVol = (1 - progress) * this.masterVolume;
      }
      result.push({
        elapsedMs: Math.round(i * stepTime),
        progress,
        incomingVolume: Number(inVol.toFixed(3)),
        outgoingVolume: Number(outVol.toFixed(3))
      });
    }
    return result;
  }

  // Calculate 1.0s FTB audio ramp
  calculateFtbAudioRamp(durationMs = 1000, steps = 10) {
    const result = [];
    const stepTime = durationMs / steps;
    const initialVol = this.isMuted ? 0 : this.masterVolume;
    for (let i = 0; i <= steps; i++) {
      const elapsed = (i * stepTime) / durationMs;
      const progress = Math.min(1.0, elapsed);
      const currentVol = Math.max(0, initialVol * (1 - progress));
      result.push({
        elapsedMs: Math.round(i * stepTime),
        volume: Number(currentVol.toFixed(3)),
        isComplete: progress >= 1.0
      });
    }
    return result;
  }

  // Calculate peak and RMS decibel level from audio PCM samples
  calculatePeakAndRms(samples) {
    if (!samples || samples.length === 0) {
      return { peakDb: -60, rmsDb: -60, peakLinear: 0, rmsLinear: 0 };
    }
    let max = 0;
    let sumSq = 0;
    for (let i = 0; i < samples.length; i++) {
      const abs = Math.abs(samples[i]);
      if (abs > max) max = abs;
      sumSq += abs * abs;
    }
    const rms = Math.sqrt(sumSq / samples.length);
    const peakDb = max > 0.0001 ? Math.max(-60, 20 * Math.log10(max)) : -60;
    const rmsDb = rms > 0.0001 ? Math.max(-60, 20 * Math.log10(rms)) : -60;
    return {
      peakDb: Number(peakDb.toFixed(1)),
      rmsDb: Number(rmsDb.toFixed(1)),
      peakLinear: Number(max.toFixed(3)),
      rmsLinear: Number(rms.toFixed(3))
    };
  }
}

module.exports = { AudioSubsystemEngine };
