/**
 * Audio Capture Service
 * Handles microphone access and audio frame extraction for wake word detection
 */

class AudioCapture {
  constructor() {
    this.audioContext = null;
    this.mediaStream = null;
    this.processor = null;
    this.mediaRecorder = null;
    this.audioChunks = [];
    this.isCapturing = false;
    this.onAudioFrame = null;
    this.analyser = null;
    this.dataArray = null;
    this._analyserSource = null;
  }

  /**
   * Check microphone permission without holding the stream open.
   * Acquires a stream briefly to trigger the browser permission prompt,
   * then immediately releases it so the mic is not occupied.
   * @returns {Promise<boolean>} True if permission granted
   */
  async requestPermission() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: 16000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      // Release immediately — we only needed to check permission
      stream.getTracks().forEach(track => track.stop());
      this._permissionGranted = true;
      console.log('[AudioCapture] Microphone permission granted');
      return true;
    } catch (error) {
      console.error('[AudioCapture] Microphone permission denied:', error.message);
      this._permissionGranted = false;
      return false;
    }
  }

  /**
   * Acquire the microphone stream. Call this before startFrameCapture/startRecording.
   * @returns {Promise<boolean>} True if stream acquired
   */
  async acquireStream() {
    if (this.mediaStream) return true;
    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: 16000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      this._permissionGranted = true;
      console.log('[AudioCapture] Stream acquired');
      return true;
    } catch (error) {
      console.error('[AudioCapture] Failed to acquire stream:', error.message);
      return false;
    }
  }

  /**
   * Release the microphone stream without tearing down the whole instance.
   */
  releaseStream() {
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(track => track.stop());
      this.mediaStream = null;
      console.log('[AudioCapture] Stream released');
    }
  }

  /**
   * Check if microphone permission was granted
   */
  hasPermission() {
    return this._permissionGranted === true || this.mediaStream !== null;
  }

  /**
   * Start capturing audio frames for wake word detection
   * @param {Function} onFrame - Callback receiving Int16Array frames
   */
  startFrameCapture(onFrame) {
    if (!this.mediaStream) {
      console.error('[AudioCapture] No media stream available');
      return false;
    }

    this.onAudioFrame = onFrame;
    this.audioContext = new AudioContext({ sampleRate: 16000 });
    const source = this.audioContext.createMediaStreamSource(this.mediaStream);

    // Process in 512-sample frames for Porcupine
    this.processor = this.audioContext.createScriptProcessor(512, 1, 1);
    this.processor.onaudioprocess = (event) => {
      if (!this.onAudioFrame) return;

      const inputData = event.inputBuffer.getChannelData(0);
      const frame = this._float32ToInt16(inputData);
      this.onAudioFrame(frame);
    };

    source.connect(this.processor);
    this.processor.connect(this.audioContext.destination);
    this.isCapturing = true;

    console.log('[AudioCapture] Frame capture started');
    return true;
  }

  /**
   * Convert Float32 audio samples to Int16 for Porcupine
   * @private
   */
  _float32ToInt16(float32Array) {
    const int16Array = new Int16Array(float32Array.length);
    for (let i = 0; i < float32Array.length; i++) {
      const s = Math.max(-1, Math.min(1, float32Array[i]));
      int16Array[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    return int16Array;
  }

  /**
   * Get current audio level (0-1) for visualization
   * @returns {number} RMS audio level
   */
  getAudioLevel() {
    if (!this.analyser || !this.dataArray) return 0;
    this.analyser.getByteTimeDomainData(this.dataArray);
    let sum = 0;
    for (let i = 0; i < this.dataArray.length; i++) {
      const normalized = (this.dataArray[i] - 128) / 128;
      sum += normalized * normalized;
    }
    return Math.sqrt(sum / this.dataArray.length);
  }

  /**
   * Get frequency data spread across N bins for visualization
   * @param {number} binCount - Number of output bins
   * @returns {Float32Array} Normalized levels (0-1) per bin
   */
  getFrequencyLevels(binCount) {
    if (!this.analyser || !this.dataArray) return new Float32Array(binCount);
    this.analyser.getByteTimeDomainData(this.dataArray);
    const levels = new Float32Array(binCount);
    const samplesPerBar = Math.floor(this.dataArray.length / binCount);
    for (let i = 0; i < binCount; i++) {
      let peak = 0;
      for (let j = 0; j < samplesPerBar; j++) {
        const v = Math.abs(this.dataArray[i * samplesPerBar + j] - 128) / 128;
        if (v > peak) peak = v;
      }
      levels[i] = peak;
    }
    return levels;
  }

  /**
   * Setup analyser for audio visualization
   */
  setupAnalyser() {
    if (!this.mediaStream) return;

    if (!this.audioContext) {
      this.audioContext = new AudioContext({ sampleRate: 16000 });
    }

    this.analyser = this.audioContext.createAnalyser();
    this.analyser.fftSize = 2048;
    this.dataArray = new Uint8Array(this.analyser.fftSize);

    const source = this.audioContext.createMediaStreamSource(this.mediaStream);
    source.connect(this.analyser);
    this._analyserSource = source; // prevent GC
  }

  /**
   * Start recording audio for Whisper transcription
   */
  startRecording() {
    if (!this.mediaStream) {
      console.error('[AudioCapture] No media stream for recording');
      return false;
    }

    this.audioChunks = [];
    this.mediaRecorder = new MediaRecorder(this.mediaStream, {
      mimeType: 'audio/webm;codecs=opus',
    });

    this.mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        this.audioChunks.push(event.data);
      }
    };

    this.mediaRecorder.start(100); // Collect in 100ms chunks
    console.log('[AudioCapture] Recording started');
    return true;
  }

  /**
   * Stop recording and get audio blob
   * @returns {Promise<Blob>} Audio blob in WebM format
   */
  stopRecording() {
    return new Promise((resolve) => {
      if (!this.mediaRecorder || this.mediaRecorder.state === 'inactive') {
        resolve(new Blob([]));
        return;
      }

      this.mediaRecorder.onstop = () => {
        const blob = new Blob(this.audioChunks, { type: 'audio/webm' });
        console.log('[AudioCapture] Recording stopped:', blob.size, 'bytes');
        resolve(blob);
      };

      this.mediaRecorder.stop();
    });
  }

  /**
   * Stop frame capture
   */
  stopFrameCapture() {
    if (this.processor) {
      this.processor.disconnect();
      this.processor = null;
    }
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
    this.onAudioFrame = null;
    this.isCapturing = false;
    console.log('[AudioCapture] Frame capture stopped');
  }

  /**
   * Release all resources
   */
  release() {
    this.stopFrameCapture();
    this.releaseStream();
    console.log('[AudioCapture] Released');
  }
}

module.exports = { AudioCapture };
