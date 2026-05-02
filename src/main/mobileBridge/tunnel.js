/**
 * Mobile Bridge — Public Tunnel
 *
 * Tries localtunnel first, then falls back to ngrok if available.
 * The tunnel is best-effort: failures here never prevent the local server from
 * starting. Callers receive { url, close() } or null.
 */

let localtunnel = null;
try {
    localtunnel = require('localtunnel');
} catch (_) {
    localtunnel = null;
}

const { execFile, spawn } = require('child_process');
const http = require('http');

async function openTunnel(port) {
    const lt = await _tryLocaltunnel(port);
    if (lt) return lt;
    const ng = await _tryNgrok(port);
    if (ng) return ng;
    return null;
}

async function _tryLocaltunnel(port) {
    if (!localtunnel) return null;
    try {
        const t = await Promise.race([
            localtunnel({ port }),
            new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 10000)),
        ]);
        return {
            url: t.url,
            close: () => { try { t.close(); } catch (_) {} },
        };
    } catch (_) {
        return null;
    }
}

async function _tryNgrok(port) {
    const ngrokPath = await _findNgrok();
    if (!ngrokPath) return null;
    try {
        const proc = spawn(ngrokPath, ['http', String(port), '--log=stdout'], {
            stdio: ['ignore', 'pipe', 'pipe'],
            detached: false,
        });

        const url = await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('ngrok timeout')), 15000);
            let buf = '';
            proc.stdout.on('data', chunk => {
                buf += chunk.toString();
                const match = buf.match(/url=(https?:\/\/[^\s]+)/);
                if (match) { clearTimeout(timeout); resolve(match[1]); }
            });
            proc.on('error', e => { clearTimeout(timeout); reject(e); });
            proc.on('exit', code => { clearTimeout(timeout); reject(new Error('ngrok exit ' + code)); });
        });

        return {
            url,
            close: () => { try { proc.kill(); } catch (_) {} },
        };
    } catch (_) {
        return null;
    }
}

function _findNgrok() {
    return new Promise(resolve => {
        execFile('which', ['ngrok'], (err, stdout) => {
            if (err || !stdout.trim()) return resolve(null);
            resolve(stdout.trim());
        });
    });
}

module.exports = { openTunnel, available: !!localtunnel };
