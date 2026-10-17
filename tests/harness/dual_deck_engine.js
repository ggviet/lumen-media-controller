/**
 * tests/harness/dual_deck_engine.js
 * Dual-Deck Audio/Video Playback & Cue Management Engine for testing R3 requirements.
 */
class DualDeckEngine {
  constructor() {
    this.decks = {
      A: { id: 'A', media: null, opacity: 1, zIndex: 20, isPlaying: false, readyState: 0, volume: 1.0, isMuted: false },
      B: { id: 'B', media: null, opacity: 0, zIndex: 10, isPlaying: false, readyState: 0, volume: 0.0, isMuted: false }
    };
    this.activeDeckKey = 'A';
    this.currentTransition = 'normal'; // cut, fast, normal, slow
    this.currentScaling = 'contain';    // contain, cover, fill
    this.masterVolume = 1.0;
    this.isMuted = false;
    this.audioSinkId = '';
    this.rundown = [];
    this.selectedIndex = -1; // PVW index
    this.pgmCue = null;       // PGM cue
    this.lastTransitionDurationMs = 0;
    this.crossfadeInProgress = false;
    this.transitionHistory = [];
    this.supportedExtensions = ['mp4', 'mov', 'webm', 'mkv', 'png', 'jpg', 'jpeg', 'svg', 'webp'];
  }

  getTransitionDurationMs(mode = this.currentTransition) {
    switch (mode) {
      case 'cut': return 0;
      case 'fast': return 400;
      case 'slow': return 1600;
      case 'normal':
      default: return 800;
    }
  }

  validateFileExtension(filePath) {
    if (!filePath || typeof filePath !== 'string') return false;
    const ext = filePath.split('.').pop().toLowerCase();
    return this.supportedExtensions.includes(ext);
  }

  classifyMediaType(filePath) {
    const ext = filePath.split('.').pop().toLowerCase();
    const videoExts = ['mp4', 'mov', 'webm', 'mkv'];
    return videoExts.includes(ext) ? 'video' : 'image';
  }

  ingestFile(filePath, endBehavior = 'HOLD_LAST_FRAME') {
    if (!this.validateFileExtension(filePath)) {
      throw new Error(`Unsupported media format: ${filePath}`);
    }
    const name = filePath.split(/[\/\\]/).pop();
    const cue = {
      id: 'cue_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
      name: name,
      path: filePath,
      type: this.classifyMediaType(filePath),
      endBehavior: endBehavior
    };
    this.rundown.push(cue);
    if (this.selectedIndex === -1 && this.rundown.length === 1) {
      this.selectedIndex = 0;
    }
    return cue;
  }

  reorderCues(fromIndex, toIndex) {
    if (fromIndex < 0 || fromIndex >= this.rundown.length) return false;
    if (toIndex < 0 || toIndex >= this.rundown.length) return false;
    const [moved] = this.rundown.splice(fromIndex, 1);
    this.rundown.splice(toIndex, 0, moved);
    return true;
  }

  moveCueUp(index) {
    if (index > 0) {
      return this.reorderCues(index, index - 1);
    }
    return false;
  }

  moveCueDown(index) {
    if (index < this.rundown.length - 1) {
      return this.reorderCues(index, index + 1);
    }
    return false;
  }

  async preRollMedia(media) {
    // Simulates pre-roll: readyState >= 2 ('loadeddata') for video, decode() for image
    if (!media || !media.path) {
      throw new Error('Invalid media item for pre-roll');
    }
    const readyState = media.type === 'video' ? 4 : 2; // HAVE_ENOUGH_DATA or image decoded
    return {
      success: true,
      mediaId: media.id,
      readyState: readyState,
      firstFrameDecoded: true
    };
  }

  async triggerGoLive(media, transition = this.currentTransition, scaling = this.currentScaling) {
    if (!media) {
      throw new Error('Cannot GO LIVE without media');
    }
    this.crossfadeInProgress = true;
    const fadeDurationMs = this.getTransitionDurationMs(transition);
    this.lastTransitionDurationMs = fadeDurationMs;

    const nextDeckKey = this.activeDeckKey === 'A' ? 'B' : 'A';
    const incomingDeck = this.decks[nextDeckKey];
    const outgoingDeck = this.decks[this.activeDeckKey];

    // Pre-roll check: incoming deck must be loaded and decoded BEFORE crossfade starts
    const preRoll = await this.preRollMedia(media);
    incomingDeck.media = { ...media };
    incomingDeck.readyState = preRoll.readyState;
    incomingDeck.isPlaying = true;
    incomingDeck.volume = transition === 'cut' ? this.masterVolume : 0.0;
    incomingDeck.isMuted = this.isMuted;

    // Simulate crossfade execution
    const startTime = Date.now();
    if (fadeDurationMs === 0) {
      // Cut
      incomingDeck.opacity = 1.0;
      incomingDeck.zIndex = 20;
      incomingDeck.volume = this.masterVolume;
      outgoingDeck.opacity = 0.0;
      outgoingDeck.zIndex = 10;
      outgoingDeck.isPlaying = false;
      outgoingDeck.media = null;
    } else {
      // Smooth fade
      incomingDeck.opacity = 1.0;
      incomingDeck.zIndex = 20;
      incomingDeck.volume = this.masterVolume;
      outgoingDeck.opacity = 0.0;
      outgoingDeck.zIndex = 10;
      outgoingDeck.volume = 0.0;
      outgoingDeck.isPlaying = false;
    }

    this.activeDeckKey = nextDeckKey;
    this.pgmCue = { ...media };
    this.crossfadeInProgress = false;

    this.transitionHistory.push({
      timestamp: startTime,
      mediaId: media.id,
      fromDeck: outgoingDeck.id,
      toDeck: incomingDeck.id,
      transition,
      durationMs: fadeDurationMs,
      scaling
    });

    return {
      activeDeck: this.activeDeckKey,
      pgmCue: this.pgmCue,
      transitionDurationMs: fadeDurationMs
    };
  }

  handleMediaEnded(cueId, endBehavior) {
    const cue = this.rundown.find(c => c.id === cueId) || this.pgmCue;
    const behavior = endBehavior || (cue ? cue.endBehavior : 'HOLD_LAST_FRAME');

    switch (behavior) {
      case 'HOLD_LAST_FRAME':
        // Freeze final frame on active deck
        if (this.decks[this.activeDeckKey]) {
          this.decks[this.activeDeckKey].isPlaying = false; // paused at duration
        }
        return { action: 'HOLD_LAST_FRAME', cueId };

      case 'LOOP':
        if (this.decks[this.activeDeckKey]) {
          this.decks[this.activeDeckKey].isPlaying = true;
        }
        return { action: 'LOOP', cueId };

      case 'AUTO_NEXT': {
        // CRITICAL BUG FIX VALIDATION:
        // Must advance based on pgmCue.id, NOT selectedIndex!
        const currentPgmIdx = this.rundown.findIndex(c => c.id === (this.pgmCue ? this.pgmCue.id : null));
        if (currentPgmIdx !== -1 && currentPgmIdx < this.rundown.length - 1) {
          const nextCue = this.rundown[currentPgmIdx + 1];
          return { action: 'AUTO_NEXT', nextCue, fromCueId: cueId };
        }
        return { action: 'AUTO_NEXT_REACHED_END', cueId };
      }

      case 'FADE_TO_BLACK':
        return { action: 'FADE_TO_BLACK', cueId };

      default:
        return { action: 'UNKNOWN', cueId };
    }
  }
}

module.exports = { DualDeckEngine };
