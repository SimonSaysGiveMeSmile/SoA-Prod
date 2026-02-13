/**
 * Whisper API Client for speech-to-text
 * Uses direct HTTP instead of OpenAI SDK to avoid Node version issues.
 * Runs in Electron main process.
 */

const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');

class WhisperClient {
  constructor(apiKey) {
    this.apiKey = apiKey;
  }

  /**
   * Transcribe audio buffer to text
   * @param {Buffer} audioBuffer - Audio data (WebM/Opus format)
   * @returns {Promise<string>} Transcription text
   */
  async transcribe(audioBuffer) {
    if (!this.apiKey) {
      throw new Error('OpenAI API key not configured');
    }
    if (!audioBuffer || audioBuffer.length === 0) {
      console.warn('[Whisper] Empty audio buffer received');
      return '';
    }

    console.log('[Whisper] Transcribing audio:', audioBuffer.length, 'bytes');

    // Build multipart form data manually
    const boundary = '----WhisperBoundary' + Date.now();
    const parts = [];

    // model field
    parts.push(
      `--${boundary}\r\n` +
      'Content-Disposition: form-data; name="model"\r\n\r\n' +
      'whisper-1\r\n'
    );

    // language field
    parts.push(
      `--${boundary}\r\n` +
      'Content-Disposition: form-data; name="language"\r\n\r\n' +
      'en\r\n'
    );

    // file field header
    const fileHeader = Buffer.from(
      `--${boundary}\r\n` +
      'Content-Disposition: form-data; name="file"; filename="audio.webm"\r\n' +
      'Content-Type: audio/webm\r\n\r\n'
    );

    const footer = Buffer.from(`\r\n--${boundary}--\r\n`);
    const preamble = Buffer.from(parts.join(''));
    const body = Buffer.concat([preamble, fileHeader, audioBuffer, footer]);

    return new Promise((resolve, reject) => {
      const req = https.request({
        hostname: 'api.openai.com',
        path: '/v1/audio/transcriptions',
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': body.length,
        },
      }, (res) => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (res.statusCode !== 200) {
              reject(new Error(json.error?.message || `HTTP ${res.statusCode}`));
              return;
            }
            console.log('[Whisper] Transcription:', json.text);
            resolve(json.text || '');
          } catch (e) {
            reject(new Error('Failed to parse Whisper response'));
          }
        });
      });

      req.on('error', reject);
      req.write(body);
      req.end();
    });
  }
}

module.exports = { WhisperClient };