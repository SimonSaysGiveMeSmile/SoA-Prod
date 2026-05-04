/**
 * Mobile Bridge — Public Tunnel
 *
 * Tries ngrok first, then falls back to localtunnel if available.
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
    const ng = await _tryNgrok(port);
    if (ng) return ng;
    const lt = await _tryLocaltunnel(port);
    if (lt) return lt;
    return null;
}

async function _tryLocaltunnel(port) {
    if (!localtunnel) return null;
    try {
        const t = await Promise.race([
            localtunnel({ port }),
            new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 10000)),
        ]);

        let dead = false;
        let onDeath = null;
        const die = () => {
            if (dead) return;
            dead = true;
            try { t.close(); } catch (_) {}
            if (onDeath) onDeath();
        };

        t.on('error', die);
        t.on('close', die);

        return {
            url: t.url,
            close: () => { dead = true; try { t.close(); } catch (_) {} },
            set onDeath(fn) { onDeath = fn; },
        };
    } catch (_) {
        return null;
    }
}

async function _tryNgrok(port) {
    const existing = await _checkExistingNgrok(port);
    if (existing) return existing;

    const ngrokPath = await _findNgrok();
    if (!ngrokPath) return null;
    try {
        const proc = spawn(ngrokPath, ['http', String(port), '--log=stdout', '--log-format=logfmt'], {
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

async function _checkExistingNgrok(port) {
    try {
        const res = await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('timeout')), 3000);
            const req = http.get('http://127.0.0.1:4040/api/tunnels', r => {
                let body = '';
                r.on('data', d => body += d);
                r.on('end', () => { clearTimeout(timeout); resolve(body); });
            });
            req.on('error', e => { clearTimeout(timeout); reject(e); });
        });
        const data = JSON.parse(res);
        if (data && data.tunnels) {
            for (const t of data.tunnels) {
                const addr = t.config && t.config.addr;
                if (addr && addr.includes(':' + port) && t.public_url && t.public_url.startsWith('https://')) {
                    return { url: t.public_url, close: () => {} };
                }
            }
        }
    } catch (_) {}
    return null;
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
