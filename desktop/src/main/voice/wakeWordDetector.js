/**
 * Wake Word Detector using Picovoice Porcupine
 * Runs in Electron main process
 */

const { Porcupine } = require('@picovoice/porcupine-node');

class WakeWordDetector {
  constructor(accessKey, modelPath) {
    this.accessKey = accessKey;
    this.modelPath = modelPath;
    this.porcupine = null;
    this.isInitialized = false;
  }

  /**
   * Initialize Porcupine with the wake word model
   * @returns {Object} Frame length and sample rate requirements
   */
  initialize() {
    if (this.isInitialized) {
      return this.getAudioRequirements();
    }

    try {
      this.porcupine = new Porcupine(
        this.accessKey,
        [this.modelPath],
        [0.5] // sensitivity: 0-1, higher = more sensitive but more false positives
      );
      this.isInitialized = true;
      console.log('[Porcupine] Initialized successfully');
      console.log('[Porcupine] Frame length:', this.porcupine.frameLength);
      console.log('[Porcupine] Sample rate:', this.porcupine.sampleRate);
      return this.getAudioRequirements();
    } catch (error) {
      console.error('[Porcupine] Initialization failed:', error.message);
      throw error;
    }
  }

  /**
   * Get audio requirements for frame processing
   */
  getAudioRequirements() {
    return {
      frameLength: this.porcupine?.frameLength ?? 512,
      sampleRate: this.porcupine?.sampleRate ?? 16000,
    };
  }

  /**
   * Process a single audio frame
   * @param {Int16Array} frame - Audio frame (512 samples, 16kHz, signed 16-bit)
   * @returns {boolean} True if wake word detected
   */
  processFrame(frame) {
    if (!this.isInitialized || !this.porcupine) {
      return false;
    }

    try {
      const keywordIndex = this.porcupine.process(frame);
      if (keywordIndex >= 0) {
        console.log('[Porcupine] Wake word detected!');
        return true;
      }
      return false;
    } catch (error) {
      console.warn('[Porcupine] Frame processing error:', error.message);
      return false;
    }
  }

  /**
   * Release Porcupine resources
   */
  release() {
    if (this.porcupine) {
      this.porcupine.release();
      this.porcupine = null;
      this.isInitialized = false;
      console.log('[Porcupine] Released');
    }
  }
}

module.exports = { WakeWordDetector };
