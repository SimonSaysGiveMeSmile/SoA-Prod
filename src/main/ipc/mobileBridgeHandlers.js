/**
 * Mobile Bridge IPC handlers
 *
 * Renderer side:
 *   - mobile:start                      → { running, lanUrl, publicUrl, token, port, clients }
 *   - mobile:stop                       → status
 *   - mobile:status                     → status
 *   - mobile:push-snapshot   (event)    → renderer pushes a UI snapshot
 *   - mobile:push-term-data  (event)    → renderer pushes raw terminal output
 *   - mobile:push-notice     (event)    → renderer pushes a transient notice
 *
 * Main → Renderer:
 *   - mobile:input                      → user input from a paired mobile device
 *   - mobile:clients-changed            → connected client count changed
 *   - mobile:status-changed             → server status changed (start/stop/tunnel)
 */

const { ipcMain } = require('electron');
const signale = require('signale');
const { MobileBridgeServer } = require('../mobileBridge/server');

// `qrcode` is loaded in the main process (Node) — never in the renderer,
// where top-level requires of it crash the renderer hard. Loaded lazily so a
// missing optional dep degrades gracefully rather than killing the bridge.
let QRCode = null;
function loadQRCode() {
    if (QRCode !== null) return QRCode;
    try { QRCode = require('qrcode'); }
    catch (_) { QRCode = false; }
    return QRCode;
}

let server = null;
let mainWindow = null;

function ensureServer() {
    if (server) return server;
    server = new MobileBridgeServer({
        logger: (level, msg) => {
            try { signale[level] ? signale[level](`[mobile] ${msg}`) : signale.info(`[mobile] ${msg}`); }
            catch (_) { /* ignore */ }
        },
    });
    server.onInput = (input) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            try { mainWindow.webContents.send('mobile:input', input); } catch (_) {}
        }
    };
    server.onClientChange = (count) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            try {
                mainWindow.webContents.send('mobile:clients-changed', { clients: count });
                mainWindow.webContents.send('mobile:status-changed', server.status());
            } catch (_) {}
        }
    };
    return server;
}

function setupMobileBridgeIPC(window) {
    mainWindow = window;

    // Remove handlers (idempotent if hot-reloaded)
    ipcMain.removeHandler('mobile:start');
    ipcMain.removeHandler('mobile:stop');
    ipcMain.removeHandler('mobile:status');
    ipcMain.removeHandler('mobile:qr');
    ipcMain.removeAllListeners('mobile:push-snapshot');
    ipcMain.removeAllListeners('mobile:push-term-data');
    ipcMain.removeAllListeners('mobile:push-notice');

    ipcMain.handle('mobile:qr', async (_e, payload = {}) => {
        const qr = loadQRCode();
        if (!qr) return { ok: false, error: 'qrcode package not available' };
        const text = String(payload.text || '');
        if (!text) return { ok: false, error: 'no text' };
        try {
            const dataUrl = await qr.toDataURL(text, Object.assign({
                width: 196,
                margin: 1,
                color: { dark: '#aaffaa', light: '#00000000' },
                errorCorrectionLevel: 'M',
            }, payload.opts || {}));
            return { ok: true, dataUrl };
        } catch (err) {
            return { ok: false, error: err.message || String(err) };
        }
    });

    ipcMain.handle('mobile:start', async (_e, opts = {}) => {
        const s = ensureServer();
        try {
            const status = await s.start({ withTunnel: opts.withTunnel !== false });
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('mobile:status-changed', status);
            }
            return { ok: true, ...status };
        } catch (err) {
            return { ok: false, error: err.message || String(err) };
        }
    });

    ipcMain.handle('mobile:stop', async () => {
        if (!server) return { ok: true, running: false };
        const status = await server.stop();
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('mobile:status-changed', status);
        }
        return { ok: true, ...status };
    });

    ipcMain.handle('mobile:status', async () => {
        if (!server) return { ok: true, running: false, clients: 0 };
        return { ok: true, ...server.status() };
    });

    ipcMain.on('mobile:push-snapshot', (_e, snapshot) => {
        if (server) server.pushSnapshot(snapshot);
    });

    ipcMain.on('mobile:push-term-data', (_e, payload) => {
        if (!server || !payload) return;
        server.pushTerminalData(payload.index, payload.data);
    });

    ipcMain.on('mobile:push-notice', (_e, payload) => {
        if (!server || !payload) return;
        server.pushNotice(payload.level || 'info', payload.text || '');
    });
}

async function teardownMobileBridge() {
    if (server) {
        try { await server.stop(); } catch (_) { /* ignore */ }
        server = null;
    }
}

module.exports = { setupMobileBridgeIPC, teardownMobileBridge };
