/**
 * Voice IPC Handlers
 * Bridge between renderer audio capture and main process voice processing
 */

const { ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

// Load environment variables from project root .env file
require('dotenv').config({ path: path.join(__dirname, '../../..', '.env') });

const { WakeWordDetector } = require('../voice/wakeWordDetector');
const { WhisperClient } = require('../voice/whisperClient');
const { OnDeviceSpeech } = require('../voice/onDeviceSpeech');

let wakeWordDetector = null;
let whisperClient = null;
let onDeviceSpeech = null;
let mainWindow = null;

/**
 * Get the path to the wake word model file
 * Handles both development and packaged app scenarios
 */
function getModelPath() {
  // In development: project_root/resources/wake-word/son-of-anton.ppn
  // In packaged app: app.asar/../resources/wake-word/son-of-anton.ppn
  const devPath = path.join(__dirname, '../../..', 'resources/wake-word/son-of-anton.ppn');
  if (fs.existsSync(devPath)) {
    return devPath;
  }

  // Fallback for packaged app (resources unpacked)
  const { app } = require('electron');
  const resourcesPath = process.resourcesPath || path.dirname(app.getAppPath());
  const packagedPath = path.join(resourcesPath, 'resources/wake-word/son-of-anton.ppn');
  return packagedPath;
}

/**
 * Setup voice IPC handlers
 * @param {BrowserWindow} window - Main Electron window
 */
function setupVoiceIPC(window) {
  // Clean up voice services (but not handlers - we do that inline below)
  if (wakeWordDetector) {
    try {
      wakeWordDetector.release();
    } catch (e) {
      console.warn('[VoiceIPC] Error releasing wake word detector:', e.message);
    }
    wakeWordDetector = null;
  }
  whisperClient = null;

  // Remove listeners (these can have multiple listeners, so removeAll is correct)
  ipcMain.removeAllListeners('voice:audio-frame');
  ipcMain.removeAllListeners('voice:release');

  mainWindow = window;

  function safeSendRenderer(channel, ...args) {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const wc = mainWindow.webContents;
    if (!wc || wc.isDestroyed() || wc.isCrashed()) return;
    try {
      wc.send(channel, ...args);
    } catch (_) {
      /* frame disposed during renderer crash/reload */
    }
  }

  // Remove then register each handler atomically to prevent race conditions
  ipcMain.removeHandler('voice:check-availability');
  ipcMain.handle('voice:check-availability', () => {
    const accessKey = process.env.PICOVOICE_ACCESS_KEY;
    const openaiKey = process.env.OPENAI_API_KEY;
    const modelPath = getModelPath();
    const modelExists = fs.existsSync(modelPath);
    const hasOnDevice = OnDeviceSpeech.isAvailable();

    console.log('[VoiceIPC] Checking availability:');
    console.log('[VoiceIPC]   - PICOVOICE_ACCESS_KEY:', accessKey ? 'set' : 'not set');
    console.log('[VoiceIPC]   - OPENAI_API_KEY:', openaiKey ? 'set' : 'not set');
    console.log('[VoiceIPC]   - Model path:', modelPath);
    console.log('[VoiceIPC]   - Model exists:', modelExists);
    console.log('[VoiceIPC]   - On-device speech:', hasOnDevice);

    return {
      available: !!(accessKey && openaiKey && modelExists),
      hasAccessKey: !!accessKey,
      hasOpenAIKey: !!openaiKey,
      hasModel: modelExists,
      hasOnDevice,
      modelPath: modelExists ? modelPath : null,
    };
  });

  // Initialize voice services
  ipcMain.removeHandler('voice:initialize');
  ipcMain.handle('voice:initialize', async () => {
    try {
      const accessKey = process.env.PICOVOICE_ACCESS_KEY;
      const openaiKey = process.env.OPENAI_API_KEY;

      if (!accessKey) {
        throw new Error('PICOVOICE_ACCESS_KEY not configured in .env file');
      }
      // if (!openaiKey) {
      //   throw new Error('OPENAI_API_KEY not configured in .env file');
      // }

      // Determine model path
      const modelPath = getModelPath();
      if (!fs.existsSync(modelPath)) {
        throw new Error(`Wake word model not found at: ${modelPath}`);
      }

      wakeWordDetector = new WakeWordDetector(accessKey, modelPath);
      whisperClient = new WhisperClient(openaiKey);

      const audioReqs = wakeWordDetector.initialize();
      console.log('[VoiceIPC] Voice services initialized');

      return {
        success: true,
        ...audioReqs,
      };
    } catch (error) {
      console.error('[VoiceIPC] Initialization failed:', error.message);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  // Process audio frame for wake word detection
  ipcMain.on('voice:audio-frame', (event, frameData) => {
    if (!wakeWordDetector) return;

    // Convert from regular array to Int16Array if needed
    const frame = frameData instanceof Int16Array
      ? frameData
      : new Int16Array(frameData);

    const detected = wakeWordDetector.processFrame(frame);
    if (detected) {
      event.sender.send('voice:wake-word-detected');
    }
  });

  // Transcribe audio with Whisper (API or local)
  ipcMain.removeHandler('voice:transcribe');
  ipcMain.handle('voice:transcribe', async (event, audioData) => {
    try {
      const audioBuffer = Buffer.isBuffer(audioData)
        ? audioData
        : Buffer.from(audioData);

      // Try OpenAI Whisper API first
      const openaiKey = process.env.OPENAI_API_KEY;
      if (openaiKey) {
        if (!whisperClient) whisperClient = new WhisperClient(openaiKey);
        const text = await whisperClient.transcribe(audioBuffer);
        return { success: true, text };
      }

      // Fall back to local whisper via OnDeviceSpeech
      if (!onDeviceSpeech && OnDeviceSpeech.isAvailable()) {
        onDeviceSpeech = new OnDeviceSpeech();
        await onDeviceSpeech.start();
      }
      if (onDeviceSpeech && onDeviceSpeech.isReady) {
        const text = await onDeviceSpeech.transcribeBuffer(audioBuffer);
        return { success: true, text };
      }

      return { success: false, error: 'No transcription service available' };
    } catch (error) {
      console.error('[VoiceIPC] Transcription failed:', error.message);
      return { success: false, error: error.message };
    }
  });

  // --- On-device speech (macOS SFSpeechRecognizer) ---

  // Helper to log to both main process console and renderer DevTools
  function voiceLog(...args) {
    console.log(...args);
    safeSendRenderer('voice:debug-log', args.map(String).join(' '));
  }

  ipcMain.removeHandler('voice:on-device-start');
  ipcMain.handle('voice:on-device-start', async () => {
    voiceLog('[VoiceIPC] on-device-start called');
    try {
      if (!onDeviceSpeech) {
        voiceLog('[VoiceIPC] Creating OnDeviceSpeech instance...');
        onDeviceSpeech = new OnDeviceSpeech();
        await onDeviceSpeech.start();
        voiceLog('[VoiceIPC] OnDeviceSpeech ready');
      }
      return { success: true };
    } catch (error) {
      voiceLog('[VoiceIPC] On-device start failed:', error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.removeHandler('voice:on-device-stop');
  ipcMain.handle('voice:on-device-stop', async () => {
    if (onDeviceSpeech) {
      onDeviceSpeech.stopRecognition();
    }
    return { success: true };
  });

  // Release voice services
  ipcMain.on('voice:release', () => {
    if (wakeWordDetector) {
      wakeWordDetector.release();
      wakeWordDetector = null;
    }
    if (onDeviceSpeech) {
      onDeviceSpeech.release();
      onDeviceSpeech = null;
    }
    whisperClient = null;
    console.log('[VoiceIPC] Voice services released');
  });
}

/**
 * Cleanup voice IPC handlers (called on app quit)
 */
function cleanupVoiceIPC() {
  // Remove handlers first to prevent any new calls
  ipcMain.removeHandler('voice:check-availability');
  ipcMain.removeHandler('voice:initialize');
  ipcMain.removeHandler('voice:transcribe');
  ipcMain.removeHandler('voice:on-device-start');
  ipcMain.removeHandler('voice:on-device-stop');
  ipcMain.removeAllListeners('voice:audio-frame');
  ipcMain.removeAllListeners('voice:release');

  // Then clean up voice services
  if (wakeWordDetector) {
    try {
      wakeWordDetector.release();
    } catch (e) {
      console.warn('[VoiceIPC] Error releasing wake word detector:', e.message);
    }
    wakeWordDetector = null;
  }
  if (onDeviceSpeech) {
    onDeviceSpeech.release();
    onDeviceSpeech = null;
  }
  whisperClient = null;
  mainWindow = null;
}

module.exports = { setupVoiceIPC, cleanupVoiceIPC };
