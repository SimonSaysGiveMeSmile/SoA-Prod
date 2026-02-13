/**
 * On-Device Speech Recognition via macOS SFSpeechRecognizer
 * Spawns a compiled Swift helper and communicates via JSON over stdio.
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

class OnDeviceSpeech {
  constructor() {
    this._proc = null;
    this._ready = false;
    this._onInterim = null;
    this._onFinal = null;
    this._onError = null;
    this._onStopped = null;
    this._buffer = '';
  }

  /**
   * Check if the compiled helper binary exists
   */
  static isAvailable() {
    const bin = OnDeviceSpeech._binaryPath();
    return fs.existsSync(bin);
  }

  static _binaryPath() {
    return path.join(__dirname, 'speech_helper');
  }

  /**
   * Spawn the helper process
   * @returns {Promise<boolean>} true when ready
   */
  start() {
    return new Promise((resolve, reject) => {
      const bin = OnDeviceSpeech._binaryPath();
      if (!fs.existsSync(bin)) {
        reject(new Error('speech_helper binary not found'));
        return;
      }

      this._proc = spawn(bin, [], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      this._proc.stderr.on('data', (d) => {
        console.warn('[OnDeviceSpeech] stderr:', d.toString().trim());
      });

      this._proc.on('error', (err) => {
        console.error('[OnDeviceSpeech] Process error:', err.message);
        if (this._onError) this._onError(err.message);
      });

      this._proc.on('exit', (code) => {
        console.log('[OnDeviceSpeech] Process exited:', code);
        this._proc = null;
        this._ready = false;
      });

      this._proc.stdout.on('data', (chunk) => {
        this._buffer += chunk.toString();
        let nl;
        while ((nl = this._buffer.indexOf('\n')) !== -1) {
          const line = this._buffer.slice(0, nl).trim();
          this._buffer = this._buffer.slice(nl + 1);
          if (!line) continue;
          try {
            const msg = JSON.parse(line);
            this._handleMessage(msg, resolve);
          } catch (e) {
            console.warn('[OnDeviceSpeech] Bad JSON:', line);
          }
        }
      });

      // Timeout if helper doesn't become ready
      setTimeout(() => {
        if (!this._ready) {
          reject(new Error('speech_helper timed out'));
          this.release();
        }
      }, 5000);
    });
  }

  _handleMessage(msg, resolveReady) {
    switch (msg.type) {
      case 'ready':
        this._ready = true;
        console.log('[OnDeviceSpeech] Ready, onDevice:', msg.onDevice);
        if (resolveReady) resolveReady(true);
        break;
      case 'interim':
        if (this._onInterim) this._onInterim(msg.text);
        break;
      case 'final':
        if (this._onFinal) this._onFinal(msg.text);
        break;
      case 'error':
        console.warn('[OnDeviceSpeech] Error:', msg.message);
        if (this._onError) this._onError(msg.message);
        break;
      case 'stopped':
        if (this._onStopped) this._onStopped();
        break;
    }
  }

  _send(obj) {
    if (this._proc && this._proc.stdin.writable) {
      this._proc.stdin.write(JSON.stringify(obj) + '\n');
    }
  }

  /** Begin recognition */
  startRecognition() { this._send({ command: 'start' }); }

  /** End recognition */
  stopRecognition() { this._send({ command: 'stop' }); }

  /** Kill the helper process */
  release() {
    if (this._proc) {
      this._send({ command: 'quit' });
      setTimeout(() => {
        if (this._proc) {
          this._proc.kill();
          this._proc = null;
        }
      }, 500);
    }
    this._ready = false;
  }

  /** @param {Function} fn - (text: string) => void */
  set onInterim(fn) { this._onInterim = fn; }
  set onFinal(fn) { this._onFinal = fn; }
  set onError(fn) { this._onError = fn; }
  set onStopped(fn) { this._onStopped = fn; }

  get isReady() { return this._ready; }
}

module.exports = { OnDeviceSpeech };