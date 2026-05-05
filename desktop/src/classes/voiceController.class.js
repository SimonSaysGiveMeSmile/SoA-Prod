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
    this.useOnDevice = false; // macOS SFSpeechRecognizer via helper process
    this.useDirectWhisper = false; // Direct Whisper mode (record + send to API)
    this._fallbackRecognition = null;
    this._fallbackRestartTimer = null;
    this._SpeechRecognition = null;
    this._directRecording = false; // Currently recording in direct Whisper mode
    this._recordingStartTime = null; // Track recording duration

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
      } else if (availability.hasOnDevice) {
        // On-device speech recognition via local Whisper (push-to-talk)
        const hasPermission = await this.audioCapture.requestPermission();
        if (!hasPermission) {
          this.onError('Microphone permission denied');
          this._setState(VoiceState.ERROR);
          return false;
        }
        this.useOnDevice = true;
        this.useDirectWhisper = true; // Reuse push-to-talk recording flow
        this.useFallback = false;
        // Initialize on-device transcription backend
        await window.ipc.invoke('voice:on-device-start');
        console.log('[VoiceController] Using on-device speech recognition (local Whisper, push-to-talk)');
      } else if (availability.hasOpenAIKey) {
        // Direct Whisper mode: record audio, send to Whisper API
        // No wake word, mic button acts as push-to-talk
        const hasPermission = await this.audioCapture.requestPermission();
        if (!hasPermission) {
          this.onError('Microphone permission denied');
          this._setState(VoiceState.ERROR);
          return false;
        }
        this.useDirectWhisper = true;
        this.useFallback = false;
        console.log('[VoiceController] Using direct Whisper API mode (push-to-talk)');
      } else {
        // Last resort: Web Speech API (will likely fail with network error in Electron)
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
  async enable() {
    if (!this.isInitialized) {
      console.warn('[VoiceController] Not initialized, cannot enable');
      return false;
    }
    // Acquire mic stream on demand
    if (!this.audioCapture.mediaStream) {
      const acquired = await this.audioCapture.acquireStream();
      if (!acquired) {
        this.onError('Failed to acquire microphone');
        return false;
      }
    }
    this.isEnabled = true;
    let result;
    if (this.useDirectWhisper) {
      result = this._startDirectRecording();
    } else if (this.useFallback) {
      result = await this._startFallbackListening();
    } else {
      result = await this.startListening();
    }
    if (!result) {
      this.isEnabled = false;
      this.audioCapture.releaseStream();
    }
    return result;
  }

  /**
   * Disable voice listening (toggle off)
   */
  async disable() {
    this.isEnabled = false;
    if (this.useDirectWhisper) {
      await this._stopDirectRecording();
    } else if (this.useFallback) {
      this._stopFallbackListening();
    } else {
      this.stopListening();
    }
    // Release mic stream so the audio channel is freed
    this.audioCapture.releaseStream();
    this._setState(VoiceState.IDLE);
  }

  /**
   * Toggle voice on/off
   * @returns {boolean} New enabled state
   */
  async toggle() {
    if (this.isEnabled) {
      await this.disable();
    } else {
      await this.enable();
    }
    return this.isEnabled;
  }

  /**
   * Start listening for wake word
   */
  async startListening() {
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

    // Ensure media stream is available
    if (!this.audioCapture.mediaStream) {
      const acquired = await this.audioCapture.acquireStream();
      if (!acquired) {
        console.error('[VoiceController] Cannot start listening: mic acquisition failed');
        return false;
      }
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
  async stopListening() {
    this._clearTimers();
    this._stopAudioLevelPolling();
    this.audioCapture.stopFrameCapture();

    if (this.state === VoiceState.RECORDING) {
      this.audioCapture.stopRecording();
    }

    if (this.isEnabled && this.isInitialized) {
      // Ensure media stream is available before restarting frame capture
      if (!this.audioCapture.mediaStream) {
        await this.audioCapture.acquireStream();
      }
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

    if (this.useDirectWhisper) {
      this._directRecording = false;
      this.audioCapture.stopRecording();
      this.isEnabled = false;
      this.audioCapture.releaseStream();
      this._setState(VoiceState.IDLE);
      return;
    }

    if (this.useFallback) {
      this._stopFallbackListening();
      this.isEnabled = false;
      this.audioCapture.releaseStream();
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
    this._recordingStartTime = Date.now();
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
      const freqLevels = this.audioCapture.getFrequencyLevels(32);
      this.onAudioLevel(level, freqLevels);
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
      this.audioCapture.releaseStream();
      this._setState(VoiceState.IDLE);
    }
  }

  /**
   * Start Web Speech API fallback listening
   * @private
   */
  async _startFallbackListening() {
    if (this._fallbackRecognition) return true;

    // Note: persistent mic stream removed — MicMonitor widget now keeps
    // the macOS indicator solid, so we don't need a duplicate stream here
    // that could interfere with SpeechRecognition audio capture.

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
            if (window.micMonitor) window.micMonitor.setSpeechStatus('RESULT: ' + text.substring(0, 30));
            this.onTranscription(text, true);
          }
        } else {
          const interim = event.results[i][0].transcript;
          if (window.micMonitor) window.micMonitor.setSpeechStatus('INTERIM: ' + interim.substring(0, 30));
          this.onInterimTranscription(interim);
        }
      }
    };

    recognition.onaudiostart = () => {
      console.log('[VoiceController] Fallback audio started — mic is capturing');
      if (window.micMonitor) window.micMonitor.setSpeechStatus('AUDIO CAPTURE');
    };

    recognition.onspeechstart = () => {
      console.log('[VoiceController] Speech detected');
      if (window.micMonitor) window.micMonitor.setSpeechStatus('SPEECH DETECTED');
    };

    recognition.onerror = (e) => {
      console.warn('[VoiceController] Fallback error:', e.error);
      if (window.micMonitor) window.micMonitor.setSpeechStatus('ERR: ' + e.error);
      if (e.error === 'no-speech' || e.error === 'aborted') return;
      this.onError(e.error);
      // Fatal errors that mean we should stop trying
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed' || e.error === 'network') {
        console.error('[VoiceController] Fatal speech error:', e.error,
          e.error === 'network' ? '— Web Speech API cannot reach Google servers (expected in Electron)' : '');
        if (window.micMonitor) window.micMonitor.setSpeechStatus('UNAVAILABLE (no cloud service)');
        // Clear restart timer to prevent onend from restarting
        if (this._fallbackRestartTimer) {
          clearTimeout(this._fallbackRestartTimer);
          this._fallbackRestartTimer = null;
        }
        this.isEnabled = false;
        this.useFallback = false;
        this._fallbackRecognition = null;
        this._setState(VoiceState.ERROR);
      }
    };

    recognition.onend = () => {
      // Only restart if still enabled; use a delay to prevent rapid restart loop
      if (this.isEnabled && this.useFallback && this._fallbackRecognition) {
        if (window.micMonitor) window.micMonitor.setSpeechStatus('RESTARTING...');
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
      if (window.micMonitor) window.micMonitor.setSpeechStatus('LISTENING');
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

  // --- On-device speech (macOS SFSpeechRecognizer) ---

  _setupOnDeviceListeners() {
    window.ipc.on('voice:on-device-interim', (text) => {
      if (window.micMonitor) window.micMonitor.setSpeechStatus('INTERIM: ' + text.substring(0, 30));
      this.onInterimTranscription(text);
    });

    window.ipc.on('voice:on-device-final', (text) => {
      console.log('[VoiceController] On-device transcription:', text);
      if (window.micMonitor) window.micMonitor.setSpeechStatus('RESULT: ' + text.substring(0, 30));
      this.onTranscription(text, true);
    });

    window.ipc.on('voice:on-device-error', (msg) => {
      console.warn('[VoiceController] On-device error:', msg);
      if (window.micMonitor) window.micMonitor.setSpeechStatus('ERR: ' + msg.substring(0, 30));
      this.onError(msg);
    });
  }

  async _startOnDeviceRecognition() {
    this._setState(VoiceState.RECORDING);
    if (window.micMonitor) window.micMonitor.setSpeechStatus('ON-DEVICE LISTENING');
    console.log('[VoiceController] Invoking voice:on-device-start...');
    const result = await window.ipc.invoke('voice:on-device-start');
    console.log('[VoiceController] on-device-start result:', JSON.stringify(result));
    if (!result.success) {
      console.warn('[VoiceController] On-device start failed:', result.error, '— falling back');
      this.useOnDevice = false;
      // Try direct Whisper if OpenAI key is available
      const avail = await window.ipc.invoke('voice:check-availability');
      if (avail.hasOpenAIKey) {
        const hasMic = await this.audioCapture.acquireStream();
        if (hasMic) {
          this.useDirectWhisper = true;
          this._setState(VoiceState.IDLE);
          console.log('[VoiceController] Fell back to direct Whisper mode');
          return false;
        }
      }
      this._setState(VoiceState.ERROR);
      return false;
    }
    return true;
  }

  async _stopOnDeviceRecognition() {
    await window.ipc.invoke('voice:on-device-stop');
    this._setState(VoiceState.IDLE);
    if (window.micMonitor) window.micMonitor.setSpeechStatus('STOPPED');
  }

  // --- Direct Whisper mode (push-to-talk) ---

  /**
   * Start recording for direct Whisper transcription
   * @private
   */
  _startDirectRecording() {
    if (this._directRecording) return true;

    const started = this.audioCapture.startRecording();
    if (!started) {
      console.error('[VoiceController] Failed to start recording — no media stream');
      if (window.micMonitor) window.micMonitor.setSpeechStatus('MIC ERROR');
      this.onError('Failed to start recording');
      return false;
    }
    this._directRecording = true;
    this._recordingStartTime = Date.now();
    this._setState(VoiceState.RECORDING);
    if (window.micMonitor) window.micMonitor.setSpeechStatus('RECORDING (push-to-talk)');

    // Setup analyser for waveform visualization
    this.audioCapture.setupAnalyser();
    this._startAudioLevelPolling();

    // Start max duration timer
    this._startMaxDurationTimer();

    console.log('[VoiceController] Direct Whisper recording started');
    return true;
  }

  /**
   * Stop recording and send audio to Whisper for transcription
   * @private
   */
  async _stopDirectRecording() {
    if (!this._directRecording) return;
    this._directRecording = false;
    this._clearTimers();
    this._stopAudioLevelPolling();

    this._setState(VoiceState.PROCESSING);
    if (window.micMonitor) window.micMonitor.setSpeechStatus('PROCESSING...');

    try {
      const audioBlob = await this.audioCapture.stopRecording();
      if (audioBlob.size < 2000) {
        console.warn('[VoiceController] Audio too short (' + audioBlob.size + ' bytes), skipping');
        if (window.micMonitor) window.micMonitor.setSpeechStatus('TOO SHORT');
        this._setState(VoiceState.IDLE);
        return;
      }

      console.log('[VoiceController] Sending', audioBlob.size, 'bytes to Whisper');
      const arrayBuffer = await audioBlob.arrayBuffer();
      const audioData = Array.from(new Uint8Array(arrayBuffer));

      const result = await window.ipc.invoke('voice:transcribe', audioData);

      if (result.success && result.text) {
        console.log('[VoiceController] Whisper transcription:', result.text);
        if (window.micMonitor) window.micMonitor.setSpeechStatus('RESULT: ' + result.text.substring(0, 30));
        this.onTranscription(result.text, true);
      } else if (result.success && !result.text) {
        console.warn('[VoiceController] Whisper returned empty transcription (silence?)');
        if (window.micMonitor) window.micMonitor.setSpeechStatus('NO SPEECH');
      } else {
        console.warn('[VoiceController] Whisper failed:', result.error);
        if (window.micMonitor) window.micMonitor.setSpeechStatus('ERR: ' + (result.error || 'unknown'));
        this.onError(result.error || 'Transcription failed');
      }
    } catch (error) {
      console.error('[VoiceController] Direct Whisper error:', error.message);
      if (window.micMonitor) window.micMonitor.setSpeechStatus('ERR: ' + error.message);
      this.onError(error.message);
    }

    this._setState(VoiceState.IDLE);
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

  getRecordingDurationMs() {
    if (!this._recordingStartTime) return 0;
    return Date.now() - this._recordingStartTime;
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
