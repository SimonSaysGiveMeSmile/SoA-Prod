/**
 * Voice Controller
 * Orchestrates wake word detection, recording, and transcription
 *
 * Context decisions implemented:
 * - 60 second maximum recording duration
 * - Space key cancels listening mode
 * - Wake word ignored during recording (re-triggering disabled)
 */

const { AudioCapture } = require('./audioCapture.class');

// Voice states
const VoiceState = {
  DISABLED: 'disabled',   // Voice not available or not initialized
  IDLE: 'idle',           // Ready but not listening
  LISTENING: 'listening', // Listening for wake word
  RECORDING: 'recording', // Recording audio after wake word
  PROCESSING: 'processing', // Whisper API processing
  ERROR: 'error',         // Error state
};

class VoiceController {
  constructor(options = {}) {
    // Max duration: 60 seconds (from CONTEXT.md)
    this.maxRecordingMs = options.maxRecordingMs || 60000;
    this.silenceTimeoutMs = options.silenceTimeoutMs || 2000;

    // Callbacks
    this.onStateChange = options.onStateChange || (() => {});
    this.onTranscription = options.onTranscription || (() => {});
    this.onError = options.onError || (() => {});
    this.onWakeDetected = options.onWakeDetected || (() => {});
    this.onAudioLevel = options.onAudioLevel || (() => {}); // For waveform viz
    this.onInterimTranscription = options.onInterimTranscription || (() => {}); // For interim results

    this.audioCapture = new AudioCapture();

    this.state = VoiceState.DISABLED;
    this.silenceTimer = null;
    this.maxDurationTimer = null;
    this.audioLevelInterval = null;
    this.isInitialized = false;
    this.isEnabled = false; // Voice toggle state
    this.useFallback = false;
    this._fallbackRecognition = null;
    this._fallbackRestartTimer = null;
    this._SpeechRecognition = null;

    // Bind space key handler
    this._boundKeyHandler = this._handleKeyDown.bind(this);
  }

  /**
   * Initialize voice controller
   * @returns {Promise<boolean>} True if initialization successful
   */
  async initialize() {
    try {
      // Check voice availability via IPC
      const availability = await window.ipc.invoke('voice:check-availability');
      if (availability.available) {
        // Full Picovoice + Whisper path
        const hasPermission = await this.audioCapture.requestPermission();
        if (!hasPermission) {
          this.onError('Microphone permission denied');
          this._setState(VoiceState.ERROR);
          return false;
        }

        const result = await window.ipc.invoke('voice:initialize');
        if (!result.success) {
          this.onError(result.error || 'Voice initialization failed');
          this._setState(VoiceState.ERROR);
          return false;
        }

        window.ipc.on('voice:wake-word-detected', () => {
          this._onWakeWordDetected();
        });

        this.useFallback = false;
      } else {
        // Fallback: Web Speech API
        const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SR) {
          console.warn('[VoiceController] No speech recognition available');
          this._setState(VoiceState.DISABLED);
          return false;
        }
        this.useFallback = true;
        this._SpeechRecognition = SR;
        console.log('[VoiceController] Using Web Speech API fallback');
      }

      document.addEventListener('keydown', this._boundKeyHandler);
      this.isInitialized = true;
      this._setState(VoiceState.IDLE);
      console.log('[VoiceController] Initialized');
      return true;
    } catch (error) {
      console.error('[VoiceController] Initialization failed:', error.message);
      this.onError(error.message);
      this._setState(VoiceState.ERROR);
      return false;
    }
  }

  /**
   * Handle keydown events - Space cancels recording
   * @private
   */
  _handleKeyDown(event) {
    if (this.useFallback) return;
    // Space key cancels listening/recording mode
    if (event.code === 'Space' && (this.state === VoiceState.LISTENING || this.state === VoiceState.RECORDING)) {
      event.preventDefault();
      console.log('[VoiceController] Space key pressed - cancelling');
      this.cancelRecording();
    }
  }

  /**
   * Enable voice listening (toggle on)
   */
  enable() {
    if (!this.isInitialized) {
      console.warn('[VoiceController] Not initialized, cannot enable');
      return false;
    }
    this.isEnabled = true;
    if (this.useFallback) {
      return this._startFallbackListening();
    }
    return this.startListening();
  }

  /**
   * Disable voice listening (toggle off)
   */
  disable() {
    this.isEnabled = false;
    if (this.useFallback) {
      this._stopFallbackListening();
    } else {
      this.stopListening();
    }
    this._setState(VoiceState.IDLE);
  }

  /**
   * Toggle voice on/off
   * @returns {boolean} New enabled state
   */
  toggle() {
    if (this.isEnabled) {
      this.disable();
    } else {
      this.enable();
    }
    return this.isEnabled;
  }

  /**
   * Start listening for wake word
   */
  startListening() {
    if (!this.isInitialized) {
      console.warn('[VoiceController] Not initialized');
      return false;
    }

    if (!this.isEnabled) {
      console.warn('[VoiceController] Voice is disabled');
      return false;
    }

    if (this.state === VoiceState.RECORDING || this.state === VoiceState.PROCESSING) {
      console.warn('[VoiceController] Cannot start listening from state:', this.state);
      return false;
    }

    // Start sending audio frames to main process for wake word detection
    this.audioCapture.startFrameCapture((frame) => {
      // Convert Int16Array to regular array for IPC
      window.ipc.send('voice:audio-frame', Array.from(frame));
    });

    this._setState(VoiceState.LISTENING);
    console.log('[VoiceController] Listening for wake word...');
    return true;
  }

  /**
   * Stop listening (but don't disable)
   */
  stopListening() {
    this._clearTimers();
    this._stopAudioLevelPolling();
    this.audioCapture.stopFrameCapture();

    if (this.state === VoiceState.RECORDING) {
      this.audioCapture.stopRecording();
    }

    if (this.isEnabled && this.isInitialized) {
      this._setState(VoiceState.LISTENING);
      // Restart listening for wake word
      this.audioCapture.startFrameCapture((frame) => {
        window.ipc.send('voice:audio-frame', Array.from(frame));
      });
    } else {
      this._setState(VoiceState.IDLE);
    }

    console.log('[VoiceController] Stopped listening');
  }

  /**
   * Cancel current recording without transcribing
   */
  cancelRecording() {
    console.log('[VoiceController] Recording cancelled');
    this._clearTimers();
    this._stopAudioLevelPolling();

    if (this.useFallback) {
      this._stopFallbackListening();
      this.isEnabled = false;
      this._setState(VoiceState.IDLE);
      return;
    }

    if (this.state === VoiceState.RECORDING) {
      this.audioCapture.stopRecording(); // Discard audio
    }

    // Return to listening if enabled
    this._returnToListening();
  }

  /**
   * Handle wake word detection
   * @private
   */
  _onWakeWordDetected() {
    // Ignore wake word during recording (per CONTEXT.md)
    if (this.state !== VoiceState.LISTENING) {
      return;
    }

    console.log('[VoiceController] Wake word detected!');

    // Notify listeners (for audio feedback)
    this.onWakeDetected();

    // Start recording for transcription
    this._setState(VoiceState.RECORDING);
    this.audioCapture.startRecording();

    // Setup analyser for waveform visualization
    this.audioCapture.setupAnalyser();
    this._startAudioLevelPolling();

    // Start silence timeout (user can still speak)
    this._startSilenceTimer();

    // Start max duration timer (60 seconds per CONTEXT.md)
    this._startMaxDurationTimer();
  }

  /**
   * Start polling audio levels for waveform visualization
   * @private
   */
  _startAudioLevelPolling() {
    this._stopAudioLevelPolling();
    this.audioLevelInterval = setInterval(() => {
      const level = this.audioCapture.getAudioLevel();
      this.onAudioLevel(level);
    }, 50); // 20fps
  }

  /**
   * Stop audio level polling
   * @private
   */
  _stopAudioLevelPolling() {
    if (this.audioLevelInterval) {
      clearInterval(this.audioLevelInterval);
      this.audioLevelInterval = null;
    }
  }

  /**
   * Start silence timeout
   * @private
   */
  _startSilenceTimer() {
    this._clearSilenceTimer();
    this.silenceTimer = setTimeout(() => {
      this._onSilenceTimeout();
    }, this.silenceTimeoutMs);
  }

  /**
   * Clear silence timeout
   * @private
   */
  _clearSilenceTimer() {
    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    }
  }

  /**
   * Start max duration timer (60 seconds)
   * @private
   */
  _startMaxDurationTimer() {
    this._clearMaxDurationTimer();
    this.maxDurationTimer = setTimeout(() => {
      console.log('[VoiceController] Max duration reached (60s)');
      this._onSilenceTimeout(); // Same behavior as silence timeout
    }, this.maxRecordingMs);
  }

  /**
   * Clear max duration timer
   * @private
   */
  _clearMaxDurationTimer() {
    if (this.maxDurationTimer) {
      clearTimeout(this.maxDurationTimer);
      this.maxDurationTimer = null;
    }
  }

  /**
   * Clear all timers
   * @private
   */
  _clearTimers() {
    this._clearSilenceTimer();
    this._clearMaxDurationTimer();
  }

  /**
   * Handle silence/max duration timeout - stop recording and transcribe
   * @private
   */
  async _onSilenceTimeout() {
    if (this.state !== VoiceState.RECORDING) {
      return;
    }

    console.log('[VoiceController] Timeout, processing...');
    this._clearTimers();
    this._stopAudioLevelPolling();
    this._setState(VoiceState.PROCESSING);

    try {
      // Stop recording and get audio
      const audioBlob = await this.audioCapture.stopRecording();

      if (audioBlob.size === 0) {
        console.warn('[VoiceController] No audio captured');
        this.onError('No audio captured');
        this._returnToListening();
        return;
      }

      // Convert blob to array buffer for IPC
      const arrayBuffer = await audioBlob.arrayBuffer();
      const audioData = Array.from(new Uint8Array(arrayBuffer));

      // Send to Whisper for transcription
      const result = await window.ipc.invoke('voice:transcribe', audioData);

      if (result.success && result.text) {
        console.log('[VoiceController] Transcription:', result.text);
        this.onTranscription(result.text, true); // true = success
      } else {
        console.warn('[VoiceController] Transcription failed:', result.error);
        this.onTranscription(null, false); // false = failure
        this.onError(result.error || 'Transcription failed');
      }
    } catch (error) {
      console.error('[VoiceController] Processing error:', error.message);
      this.onTranscription(null, false);
      this.onError(error.message);
    }

    this._returnToListening();
  }

  /**
   * Return to listening state if enabled
   * @private
   */
  _returnToListening() {
    if (this.isEnabled) {
      this._setState(VoiceState.LISTENING);
      if (!this.useFallback) {
        this.audioCapture.startFrameCapture((frame) => {
          window.ipc.send('voice:audio-frame', Array.from(frame));
        });
      }
    } else {
      this._setState(VoiceState.IDLE);
    }
  }

  /**
   * Start Web Speech API fallback listening
   * @private
   */
  _startFallbackListening() {
    if (this._fallbackRecognition) return true;

    const recognition = new this._SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';
    recognition.maxAlternatives = 1;

    recognition.onresult = (event) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
          const text = event.results[i][0].transcript.trim();
          if (text) {
            console.log('[VoiceController] Fallback transcription:', text);
            this.onTranscription(text, true);
          }
        } else {
          this.onInterimTranscription(event.results[i][0].transcript);
        }
      }
    };

    recognition.onaudiostart = () => {
      console.log('[VoiceController] Fallback audio started');
    };

    recognition.onerror = (e) => {
      if (e.error === 'no-speech' || e.error === 'aborted') return;
      console.warn('[VoiceController] Fallback error:', e.error);
      this.onError(e.error);
      // Fatal errors that mean we should stop trying
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        this.isEnabled = false;
        this._fallbackRecognition = null;
        this._setState(VoiceState.ERROR);
      }
    };

    recognition.onend = () => {
      // Only restart if still enabled; use a delay to prevent rapid restart loop
      if (this.isEnabled && this.useFallback && this._fallbackRecognition) {
        this._fallbackRestartTimer = setTimeout(() => {
          if (this.isEnabled && this.useFallback && this._fallbackRecognition) {
            try {
              recognition.start();
              console.log('[VoiceController] Fallback restarted');
            } catch (e) {
              console.warn('[VoiceController] Fallback restart failed:', e.message);
            }
          }
        }, 300);
      }
    };

    try {
      recognition.start();
      this._fallbackRecognition = recognition;
      this._setState(VoiceState.LISTENING);
      console.log('[VoiceController] Fallback listening started');
      return true;
    } catch (e) {
      console.error('[VoiceController] Fallback start failed:', e.message);
      return false;
    }
  }

  /**
   * Stop Web Speech API fallback listening
   * @private
   */
  _stopFallbackListening() {
    if (this._fallbackRestartTimer) {
      clearTimeout(this._fallbackRestartTimer);
      this._fallbackRestartTimer = null;
    }
    if (this._fallbackRecognition) {
      this._fallbackRecognition.onend = null;
      this._fallbackRecognition.stop();
      this._fallbackRecognition = null;
    }
  }

  /**
   * Update state and notify listeners
   * @private
   */
  _setState(newState) {
    const oldState = this.state;
    this.state = newState;
    if (oldState !== newState) {
      console.log('[VoiceController] State:', oldState, '->', newState);
      this.onStateChange(newState, oldState);
    }
  }

  /**
   * Get current state
   */
  getState() {
    return this.state;
  }

  /**
   * Check if voice is enabled
   */
  getEnabled() {
    return this.isEnabled;
  }

  /**
   * Release all resources
   */
  release() {
    this._clearTimers();
    this._stopAudioLevelPolling();
    this._stopFallbackListening();
    document.removeEventListener('keydown', this._boundKeyHandler);
    this.audioCapture.release();
    window.ipc.send('voice:release');
    this._setState(VoiceState.DISABLED);
    this.isInitialized = false;
    this.isEnabled = false;
    console.log('[VoiceController] Released');
  }
}

module.exports = { VoiceController, VoiceState };
