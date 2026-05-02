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

      // Scale timeout with audio size. whisper-tiny on CPU is ~10x realtime,
      // but Python startup + ffmpeg decode add fixed overhead. Worst case ~120kbps
      // webm/opus → ~15KB/s, so allow ~0.3ms per byte (~5x realtime processing
      // budget) plus 60s base. 60s of audio (~900KB) → ~330s budget.
      const timeoutMs = Math.max(60_000, Math.ceil(audioBuffer.length * 0.3));

      console.log('[OnDeviceSpeech] Transcribing', audioBuffer.length, 'bytes (timeout', timeoutMs + 'ms)...');

      const startedAt = Date.now();
      execFile(whisper, [
        tmpFile,
        '--model', 'tiny',
        '--language', 'en',
        '--output_format', 'txt',
        '--output_dir', outDir,
        '--fp16', 'False',
      ], { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
        const elapsedMs = Date.now() - startedAt;

        const baseName = path.basename(tmpFile, path.extname(tmpFile));
        const txtFile = path.join(outDir, baseName + '.txt');
        let text = '';
        try { text = fs.readFileSync(txtFile, 'utf8').trim(); } catch (e) {}

        // If the .txt is missing/empty (e.g. process was SIGTERM'd before
        // whisper finished writing), salvage whatever segments whisper already
        // streamed to stdout: lines look like "[00:00.000 --> 00:05.000]  text".
        if (!text && stdout) {
          const segs = [];
          const re = /^\[\d+:\d+\.\d+\s*-->\s*\d+:\d+\.\d+\]\s*(.*)$/gm;
          let m;
          while ((m = re.exec(stdout)) !== null) {
            const t = m[1].trim();
            if (t) segs.push(t);
          }
          if (segs.length) text = segs.join(' ').trim();
        }

        try { fs.unlinkSync(tmpFile); } catch (e) {}
        try { fs.rmSync(outDir, { recursive: true, force: true }); } catch (e) {}

        if (text) {
          console.log('[OnDeviceSpeech] Transcription:', text);
          resolve(text);
          return;
        }

        // Empty result — figure out *why* so the user/dev gets a real signal
        // instead of a silent "(empty)".
        const isTimeout = !!(err && (err.killed || err.signal === 'SIGTERM' || err.signal === 'SIGKILL' || err.code === 'ETIMEDOUT'));
        const realErrors = (stderr || '').split('\n').filter(line =>
          line.trim() && !line.includes('FP16 is not supported') && !line.includes('UserWarning')
        ).join('\n').trim();

        const tail = (s, n) => {
          const t = (s || '').trim();
          return t.length > n ? '…' + t.slice(-n) : t;
        };

        if (isTimeout) {
          const msg = `whisper timed out after ${elapsedMs}ms (limit ${timeoutMs}ms, audio ${audioBuffer.length} bytes) — try shorter recordings or a faster model`;
          console.warn('[OnDeviceSpeech]', msg);
          if (stderr && stderr.trim()) console.warn('[OnDeviceSpeech] stderr tail:', tail(stderr, 400));
          reject(new Error(msg));
          return;
        }

        if (err) {
          const msg = realErrors || err.message || `whisper exited code=${err.code} signal=${err.signal}`;
          console.warn('[OnDeviceSpeech] whisper failed in', elapsedMs + 'ms:', msg);
          if (stderr && stderr.trim()) console.warn('[OnDeviceSpeech] stderr tail:', tail(stderr, 400));
          reject(new Error(msg));
          return;
        }

        // No err, no text — whisper ran cleanly but produced nothing. Most
        // likely silence/unintelligible audio, but log diagnostic context so
        // we can tell that apart from a misconfiguration.
        console.log(
          '[OnDeviceSpeech] Transcription: (empty) — whisper ran in',
          elapsedMs + 'ms with no output (likely silence/unintelligible audio).',
          `bytes=${audioBuffer.length}`
        );
        if (realErrors) console.log('[OnDeviceSpeech] stderr tail:', tail(stderr, 400));
        resolve('');
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
