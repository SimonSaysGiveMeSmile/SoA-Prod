/**
 * On-Device Speech Recognition via local Whisper CLI
 * Uses openai-whisper installed via Homebrew for fully offline transcription.
 */

const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

class OnDeviceSpeech {
  constructor() {
    this._ready = false;
    this._onInterim = null;
    this._onFinal = null;
    this._onError = null;
    this._onStopped = null;
  }

  static isAvailable() {
    if (process.platform !== 'darwin') return false;
    // Check for local whisper CLI
    const whisperPath = OnDeviceSpeech._whisperPath();
    return whisperPath !== null;
  }

  static _whisperPath() {
    const candidates = [
      '/opt/homebrew/bin/whisper',
      '/usr/local/bin/whisper',
      path.join(os.homedir(), '.local', 'bin', 'whisper'),
    ];
    for (const p of candidates) {
      if (fs.existsSync(p)) return p;
    }
    return null;
  }

  async start() {
    const wp = OnDeviceSpeech._whisperPath();
    if (!wp) {
      throw new Error('Local whisper not found. Install with: brew install openai-whisper');
    }
    this._ready = true;
    console.log('[OnDeviceSpeech] Ready (local whisper at', wp + ')');
    return true;
  }

  /**
   * Transcribe audio buffer using local whisper CLI
   * @param {Buffer} audioBuffer - Audio data (webm/opus)
   * @returns {Promise<string>} Transcribed text
   */
  transcribeBuffer(audioBuffer) {
    return new Promise((resolve, reject) => {
      const whisper = OnDeviceSpeech._whisperPath();
      if (!whisper) {
        reject(new Error('whisper not found'));
        return;
      }

      const tmpFile = path.join(os.tmpdir(), `soa_audio_${Date.now()}.webm`);
      fs.writeFileSync(tmpFile, audioBuffer);

      const outDir = path.join(os.tmpdir(), `soa_whisper_${Date.now()}`);
      fs.mkdirSync(outDir, { recursive: true });

      console.log('[OnDeviceSpeech] Transcribing', audioBuffer.length, 'bytes...');

      execFile(whisper, [
        tmpFile,
        '--model', 'tiny',
        '--language', 'en',
        '--output_format', 'txt',
        '--output_dir', outDir,
      ], { timeout: 30000 }, (err, stdout, stderr) => {
        // Read result
        const baseName = path.basename(tmpFile, path.extname(tmpFile));
        const txtFile = path.join(outDir, baseName + '.txt');
        let text = '';
        try { text = fs.readFileSync(txtFile, 'utf8').trim(); } catch (e) {}

        // Cleanup
        try { fs.unlinkSync(tmpFile); } catch (e) {}
        try { fs.unlinkSync(txtFile); } catch (e) {}
        try { fs.rmdirSync(outDir); } catch (e) {}

        // If we got text output, treat as success even if stderr has warnings (e.g. FP16)
        if (text) {
          console.log('[OnDeviceSpeech] Transcription:', text);
          resolve(text);
          return;
        }

        if (err) {
          reject(new Error(stderr || err.message));
          return;
        }

        console.log('[OnDeviceSpeech] Transcription: (empty)');
        resolve(text);
      });
    });
  }

  startRecognition() {
    console.log('[OnDeviceSpeech] startRecognition (push-to-talk mode)');
  }

  stopRecognition() {
    if (this._onStopped) this._onStopped();
  }

  release() {
    this._ready = false;
  }

  set onInterim(fn) { this._onInterim = fn; }
  set onFinal(fn) { this._onFinal = fn; }
  set onError(fn) { this._onError = fn; }
  set onStopped(fn) { this._onStopped = fn; }

  get isReady() { return this._ready; }
}

module.exports = { OnDeviceSpeech };
