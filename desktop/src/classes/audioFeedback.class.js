/**
 * Audio Feedback Service
 * Handles voice responses and audio cues for voice interaction
 *
 * Context decisions implemented:
 * - "Yes sir" voice response on wake word detection (not generic chime)
 * - Distinct success sound on transcription success
 * - Distinct failure sound on transcription failure
 */

const path = require('path');
const { Howl, Howler } = require('howler');

class AudioFeedback {
  constructor() {
    this.yesSir = null;
    this.success = null;
    this.failure = null;
    this.isLoaded = false;
  }

  /**
   * Initialize audio feedback with preloaded sounds
   * @returns {boolean} True if initialization successful
   */
  initialize() {
    try {
      const soundsDir = path.join(__dirname, '..', '..', 'resources', 'sounds');

      // "Yes sir" voice response for wake word detection
      this.yesSir = new Howl({
        src: [path.join(soundsDir, 'yes-sir.mp3')],
        volume: 0.7,
        preload: true,
        onload: () => console.log('[AudioFeedback] Yes sir loaded'),
        onloaderror: (id, err) => console.warn('[AudioFeedback] Yes sir load error:', err),
      });

      // Success sound for transcription completion
      this.success = new Howl({
        src: [path.join(soundsDir, 'success.mp3')],
        volume: 0.5,
        preload: true,
        onload: () => console.log('[AudioFeedback] Success sound loaded'),
        onloaderror: (id, err) => console.warn('[AudioFeedback] Success load error:', err),
      });

      // Failure sound for transcription errors
      this.failure = new Howl({
        src: [path.join(soundsDir, 'failure.mp3')],
        volume: 0.5,
        preload: true,
        onload: () => console.log('[AudioFeedback] Failure sound loaded'),
        onloaderror: (id, err) => console.warn('[AudioFeedback] Failure load error:', err),
      });

      // Respect global audio settings
      if (window.settings && window.settings.audio === false) {
        Howler.volume(0);
      } else if (window.settings && typeof window.settings.audioVolume === 'number') {
        Howler.volume(window.settings.audioVolume);
      }

      this.isLoaded = true;
      console.log('[AudioFeedback] Initialized');
      return true;
    } catch (error) {
      console.error('[AudioFeedback] Initialization failed:', error.message);
      return false;
    }
  }

  playYesSir() {
    if (this.yesSir) {
      this.yesSir.play();
      console.log('[AudioFeedback] Playing: Yes sir');
    }
  }

  playSuccess() {
    if (this.success) {
      this.success.play();
      console.log('[AudioFeedback] Playing: Success');
    }
  }

  playFailure() {
    if (this.failure) {
      this.failure.play();
      console.log('[AudioFeedback] Playing: Failure');
    }
  }

  setVolume(volume) {
    Howler.volume(Math.max(0, Math.min(1, volume)));
  }

  release() {
    if (this.yesSir) this.yesSir.unload();
    if (this.success) this.success.unload();
    if (this.failure) this.failure.unload();
    this.yesSir = null;
    this.success = null;
    this.failure = null;
    this.isLoaded = false;
    console.log('[AudioFeedback] Released');
  }
}

module.exports = { AudioFeedback };
