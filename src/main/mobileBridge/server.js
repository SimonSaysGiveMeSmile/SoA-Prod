/**
 * Mobile Bridge HTTP + WebSocket Server (main process)
 *
 * Runs alongside the Electron desktop app. Its job is to expose the current
 * desktop session to a mobile companion app over the local network (and,
 * optionally, the public internet via a tunnel).
 *
 *   - HTTP serves the static mobile webapp from `../son-of-anton-mobile/dist`
 *     (sibling repo). If that folder doesn't exist we fall back to a tiny
 *     built-in landing page so the user always sees *something* useful.
 *   - WS at `/ws?t=<token>` is the realtime channel. Messages follow
 *     ./protocol.js. Heartbeats every 5s detect dead clients.
 *
 * The server is started lazily by IPC handlers when the user opens the mobile
 * QR widget; it never auto-starts so we don't burn ports for users who don't
 * use the feature.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const net = require('net');
const WebSocket = require('ws');

const { SessionStore } = require('./sessionStore');
const { openTunnel } = require('./tunnel');
const { MSG, frame, parse } = require('./protocol');

const HEARTBEAT_INTERVAL_MS = 5000;
const HEARTBEAT_TIMEOUT_MS  = 15000;
const DEFAULT_PORT          = 7330;
const PORT_SCAN_MAX         = 30;

// Resolve the path to the bundled mobile webapp. We look in three places, in
// order, to support dev (sibling repo), prebuild (./mobile-webapp) and packaged
// (resources). All are optional — if none exist we serve the fallback page.
function resolveMobileWebappRoot() {
    const candidates = [
        path.resolve(__dirname, '../../../../son-of-anton-mobile/dist'),
        path.resolve(__dirname, '../../../../son-of-anton-mobile'),       // unbuilt sibling
        path.resolve(__dirname, '../../mobile-webapp'),                    // prebuild step
    ];
    for (const p of candidates) {
        try {
            if (fs.existsSync(path.join(p, 'index.html'))) return p;
        } catch (_) { /* ignore */ }
    }
    return null;
}

function getLanIp() {
    const ifaces = os.networkInterfaces();
    // Prefer en0 / wlan0 style interfaces over docker / vpn ones
    const preferred = [];
    const others = [];
    for (const [name, list] of Object.entries(ifaces || {})) {
        if (!list) continue;
        for (const iface of list) {
            if (iface.family !== 'IPv4' || iface.internal) continue;
            if (/^(en|eth|wlan|wlp|wifi|wlx)/i.test(name)) preferred.push(iface.address);
            else others.push(iface.address);
        }
    }
    return preferred[0] || others[0] || '127.0.0.1';
}

async function findFreePort(start = DEFAULT_PORT, max = PORT_SCAN_MAX) {
    for (let i = 0; i < max; i++) {
        const candidate = start + i;
        const ok = await new Promise(resolve => {
            const s = net.createServer();
            s.unref();
            s.once('error', () => resolve(false));
            s.once('listening', () => s.close(() => resolve(true)));
            s.listen(candidate, '0.0.0.0');
        });
        if (ok) return candidate;
    }
    throw new Error('No free port found for mobile bridge');
}

const FALLBACK_HTML = `<!doctype html>
<html><head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>Son of Anton — Mobile</title>
  <style>
    html,body{margin:0;background:#000;color:#aaffaa;font-family:ui-monospace,Menlo,Consolas,monospace;}
    .wrap{max-width:520px;margin:0 auto;padding:24px;}
    h1{font-weight:400;letter-spacing:.18em;}
    .hint{opacity:.7;font-size:14px;line-height:1.5;}
    code{background:#0f1f0f;padding:2px 6px;border-radius:4px;}
  </style>
</head><body><div class="wrap">
  <h1>SON OF ANTON · MOBILE</h1>
  <p class="hint">The desktop bridge is running, but the bundled mobile webapp
  was not found on this machine. Build the companion repo
  (<code>son-of-anton-mobile</code>) and reload, or open it directly in
  development at <code>http://localhost:5173</code>.</p>
</div></body></html>`;

const STATIC_MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js':   'application/javascript; charset=utf-8',
    '.mjs':  'application/javascript; charset=utf-8',
    '.css':  'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg':  'image/svg+xml',
    '.png':  'image/png',
    '.jpg':  'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.ico':  'image/x-icon',
    '.woff': 'font/woff',
    '.woff2':'font/woff2',
    '.webmanifest': 'application/manifest+json',
};

class MobileBridgeServer {
    constructor({ logger } = {}) {
        this.log = logger || ((..._a) => {});
        this.store = new SessionStore();
        this.httpServer = null;
        this.wss = null;
        this.heartbeat = null;
        this.tunnel = null;
        this.port = null;
        this.lanIp = null;
        this.webappRoot = null;
        this.onInput = null;          // set by IPC layer
        this.onClientChange = null;   // set by IPC layer
    }

    isRunning() { return !!this.httpServer; }

    status() {
        if (this.isRunning()) this.lanIp = getLanIp();
        return {
            running: this.isRunning(),
            port: this.port,
            lanUrl: this.lanIp && this.port ? `http://${this.lanIp}:${this.port}/?t=${this.store.token}` : null,
            publicUrl: this.tunnel ? `${this.tunnel.url}/?t=${this.store.token}` : null,
            token: this.store.token,
            clients: this.store.clientCount(),
            startedAt: this.store.startedAt,
        };
    }

    async start({ withTunnel = true } = {}) {
        if (this.isRunning()) return this.status();

        this.webappRoot = resolveMobileWebappRoot();
        this.lanIp = getLanIp();
        this.port = await findFreePort();
        this.store.rotateToken();
        this.store.startedAt = Date.now();

        this.httpServer = http.createServer((req, res) => this._onRequest(req, res));
        this.wss = new WebSocket.Server({ noServer: true });
        this.httpServer.on('upgrade', (req, socket, head) => this._onUpgrade(req, socket, head));

        await new Promise((resolve, reject) => {
            this.httpServer.once('error', reject);
            this.httpServer.listen(this.port, '0.0.0.0', resolve);
        });

        this._startHeartbeat();

        if (withTunnel) {
            // Best-effort, non-blocking: the LAN URL is always available immediately.
            openTunnel(this.port).then(t => {
                if (!this.isRunning()) {
                    if (t) t.close();
                    return;
                }
                this.tunnel = t;
                this.log('info', t ? `Mobile bridge public URL: ${t.url}` : 'Public tunnel unavailable, LAN only');
            }).catch(() => { /* ignored */ });
        }

        this.log('success', `Mobile bridge listening on http://${this.lanIp}:${this.port}`);
        return this.status();
    }

    async stop() {
        if (!this.isRunning()) return this.status();
        this._stopHeartbeat();
        if (this.tunnel) { try { this.tunnel.close(); } catch (_) {} this.tunnel = null; }
        if (this.wss)  { try { this.wss.close(); }   catch (_) {} this.wss = null; }
        if (this.httpServer) {
            await new Promise(res => this.httpServer.close(() => res()));
            this.httpServer = null;
        }
        this.store.reset();
        this.port = null;
        this.log('info', 'Mobile bridge stopped');
        return this.status();
    }

    /** Renderer pushes a snapshot. Stored + broadcast to all clients. */
    pushSnapshot(snapshot) {
        if (!this.isRunning()) return;
        this.store.setSnapshot(snapshot);
        this.store.broadcast(frame(MSG.SNAPSHOT, snapshot));
    }

    /** Renderer pushes raw terminal output. */
    pushTerminalData(termIndex, data) {
        if (!this.isRunning()) return;
        this.store.broadcast(frame(MSG.TERM_DATA, { index: termIndex, data }));
    }

    /** Renderer pushes a quick notice (e.g. "AI is thinking…"). */
    pushNotice(level, text) {
        if (!this.isRunning()) return;
        this.store.broadcast(frame(MSG.NOTICE, { level, text }));
    }

    // ── HTTP ────────────────────────────────────────────────────────────
    _onRequest(req, res) {
        const parsed = new URL(req.url, 'http://localhost');
        const pathname = parsed.pathname || '/';

        // Liveness / pairing endpoint used by the mobile app's preflight.
        if (pathname === '/api/ping') {
            res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
            res.end(JSON.stringify({ ok: true, name: 'son-of-anton', protocol: 1 }));
            return;
        }
        if (pathname === '/api/session') {
            const ok = this.store.validateToken(parsed.searchParams.get('t'));
            res.writeHead(ok ? 200 : 401, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
            res.end(JSON.stringify(ok ? { ok: true, snapshotVersion: this.store.snapshotVersion } : { ok: false }));
            return;
        }

        // Static webapp.
        if (this.webappRoot) {
            const safe = pathname === '/' ? '/index.html' : pathname;
            const filePath = path.join(this.webappRoot, decodeURIComponent(safe));
            if (filePath.startsWith(this.webappRoot)) {
                fs.stat(filePath, (err, stat) => {
                    if (err || !stat.isFile()) {
                        // SPA fallback: serve index.html for unknown routes
                        const idx = path.join(this.webappRoot, 'index.html');
                        fs.readFile(idx, (e2, buf) => {
                            if (e2) { res.writeHead(404); return res.end('not found'); }
                            res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
                            res.end(buf);
                        });
                        return;
                    }
                    const ext = path.extname(filePath).toLowerCase();
                    res.writeHead(200, { 'content-type': STATIC_MIME[ext] || 'application/octet-stream' });
                    fs.createReadStream(filePath).pipe(res);
                });
                return;
            }
        }

        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(FALLBACK_HTML);
    }

    // ── WebSocket ──────────────────────────────────────────────────────
    _onUpgrade(req, socket, head) {
        const parsed = new URL(req.url, 'http://localhost');
        if (parsed.pathname !== '/ws') {
            socket.write('HTTP/1.1 404 Not Found\r\n\r\n'); socket.destroy(); return;
        }
        if (!this.store.validateToken(parsed.searchParams.get('t'))) {
            socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); socket.destroy(); return;
        }
        this.wss.handleUpgrade(req, socket, head, ws => this._onWsConnect(ws, req));
    }

    _onWsConnect(ws, req) {
        ws.isAlive = true;
        ws.on('pong', () => { ws.isAlive = true; });

        this.store.addClient(ws);
        if (this.onClientChange) this.onClientChange(this.store.clientCount());
        this.log('info', `Mobile client connected (${this.store.clientCount()} total)`);

        // Greet + replay last snapshot if we have one.
        try {
            ws.send(frame(MSG.HELLO, {
                serverVersion: 1,
                serverTime: Date.now(),
                snapshotVersion: this.store.snapshotVersion,
            }));
            if (this.store.snapshot) {
                ws.send(frame(MSG.SNAPSHOT, this.store.snapshot));
            }
        } catch (_) { /* ignore */ }

        ws.on('message', raw => this._onWsMessage(ws, raw));
        ws.on('close', () => {
            this.store.removeClient(ws);
            if (this.onClientChange) this.onClientChange(this.store.clientCount());
            this.log('info', `Mobile client disconnected (${this.store.clientCount()} remaining)`);
        });
        ws.on('error', () => { /* the close handler will fire too */ });
    }

    _onWsMessage(ws, raw) {
        const msg = parse(raw.toString());
        if (!msg) return;
        switch (msg.t) {
            case MSG.PING:
                try { ws.send(frame(MSG.PONG, { ts: Date.now() })); } catch (_) {}
                break;
            case MSG.REQUEST:
                if (msg.d && msg.d.what === 'snapshot' && this.store.snapshot) {
                    try { ws.send(frame(MSG.SNAPSHOT, this.store.snapshot)); } catch (_) {}
                }
                break;
            case MSG.INPUT:
                if (this.onInput) this.onInput(msg.d || {});
                break;
            default:
                /* unknown frames are ignored to allow forward-compat */
                break;
        }
    }

    _startHeartbeat() {
        this._stopHeartbeat();
        this.heartbeat = setInterval(() => {
            if (!this.wss) return;
            this.wss.clients.forEach(ws => {
                if (ws.isAlive === false) {
                    try { ws.terminate(); } catch (_) {}
                    return;
                }
                ws.isAlive = false;
                try { ws.ping(); } catch (_) {}
            });
        }, HEARTBEAT_INTERVAL_MS);
        if (this.heartbeat.unref) this.heartbeat.unref();
        this._heartbeatTimeoutMs = HEARTBEAT_TIMEOUT_MS;
    }

    _stopHeartbeat() {
        if (this.heartbeat) clearInterval(this.heartbeat);
        this.heartbeat = null;
    }
}

module.exports = { MobileBridgeServer };
