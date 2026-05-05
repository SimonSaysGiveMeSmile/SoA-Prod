/**
 * Interim Transcription Service
 * Uses Web Speech API for real-time interim transcription display
 *
 * Context decisions implemented:
 * - Interim results: Show partial transcription in real-time as user speaks
 * - Runs in parallel with Whisper API (Whisper for final, Web Speech for interim)
 *
 * Why Web Speech API:
 * - Local processing = low latency (~200ms)
 * - Provides interim results as user speaks
 * - No API cost for interim display
 * - Whisper API still provides final accurate transcription
 */

class InterimTranscription {
  constructor(options = {}) {
    this.recognition = null;
    this.isSupported = false;
    this.isRunning = false;

    // Callbacks
    this.onInterim = options.onInterim || (() => {});
    this.onError = options.onError || (() => {});

    // Check browser support
    this._checkSupport();
  }

  /**
   * Check if Web Speech API is supported
   * @private
   */
  _checkSupport() {
    // webkitSpeechRecognition is available in Chromium-based browsers (Electron uses Chromium)
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

    if (SpeechRecognition) {
      this.isSupported = true;
      this.recognition = new SpeechRecognition();
      this._configure();
      console.log('[InterimTranscription] Web Speech API supported');
    } else {
      this.isSupported = false;
      console.warn('[InterimTranscription] Web Speech API not supported');
    }
  }

  /**
   * Configure speech recognition
   * @private
   */
  _configure() {
    if (!this.recognition) return;

    // Configuration for interim results
    this.recognition.continuous = true;        // Keep listening until stopped
    this.recognition.interimResults = true;    // Get interim (partial) results
    this.recognition.lang = 'en-US';           // English language
    this.recognition.maxAlternatives = 1;      // Just need one result

    // Handle results
    this.recognition.onresult = (event) => {
      let interimTranscript = '';

      // Collect interim results
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (!result.isFinal) {
          interimTranscript += result[0].transcript;
        }
      }

      // Send interim text to callback
      if (interimTranscript) {
        this.onInterim(interimTranscript);
      }
    };

    // Handle errors silently (Web Speech is supplementary)
    this.recognition.onerror = (event) => {
      // Common errors that don't need user notification:
      // - 'aborted': We stopped it
      // - 'no-speech': User was silent
      // - 'network': Offline mode
      if (event.error !== 'aborted' && event.error !== 'no-speech') {
        console.warn('[InterimTranscription] Error:', event.error);
        this.onError(event.error);
      }
    };

    // Auto-restart if it stops unexpectedly while we want it running
    this.recognition.onend = () => {
      if (this.isRunning) {
        // Restart recognition
        try {
          this.recognition.start();
        } catch (e) {
          // Already running or other error, ignore
        }
      }
    };
  }

  /**
   * Start interim transcription
   * Call this when recording starts (after wake word)
   */
  start() {
    if (!this.isSupported || !this.recognition) {
      console.warn('[InterimTranscription] Cannot start - not supported');
      return false;
    }

    if (this.isRunning) {
      console.warn('[InterimTranscription] Already running');
      return true;
    }

    try {
      this.isRunning = true;
      this.recognition.start();
      console.log('[InterimTranscription] Started');
      return true;
    } catch (error) {
      console.error('[InterimTranscription] Start failed:', error.message);
      this.isRunning = false;
      return false;
    }
  }

  /**
   * Stop interim transcription
   * Call this when recording stops
   */
  stop() {
    if (!this.recognition) return;

    this.isRunning = false;

    try {
      this.recognition.stop();
      console.log('[InterimTranscription] Stopped');
    } catch (error) {
      // Ignore stop errors (might not be running)
    }
  }

  /**
   * Check if running
   */
  getIsRunning() {
    return this.isRunning;
  }

  /**
   * Check if supported
   */
  getIsSupported() {
    return this.isSupported;
  }

  /**
   * Release resources
   */
  release() {
    this.stop();
    this.recognition = null;
    this.isSupported = false;
    console.log('[InterimTranscription] Released');
  }
}

module.exports = { InterimTranscription };
