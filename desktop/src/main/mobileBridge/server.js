/**
 * Mobile Bridge HTTP + WebSocket Server (main process)
 *
 * Runs alongside the Electron desktop app. Its job is to expose the current
 * desktop session to a mobile companion app over the local network (and,
 * optionally, the public internet via a tunnel).
 *
 *   - HTTP serves the static mobile webapp bundled via electron-builder
 *     `extraResources` (Resources/mobile in packaged builds) or the repo
 *     `mobile/dist` in dev. If neither exists we fall back to a tiny
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

// The desktop app version is read once at module load and advertised to mobile
// clients so they can refuse to pair with a mismatched build.
const DESKTOP_VERSION = readDesktopVersion();

function readDesktopVersion() {
    // Outer desktop/package.json is authoritative (the inner src/package.json
    // holds runtime-deps only and may lag). In dev both exist; in packaged
    // builds the asar root has a single package.json we read from there.
    const candidates = [
        path.resolve(__dirname, '../../../package.json'),
        path.resolve(__dirname, '../../package.json'),
    ];
    for (const p of candidates) {
        try {
            const pkg = JSON.parse(fs.readFileSync(p, 'utf8'));
            if (pkg && pkg.version) return pkg.version;
        } catch (_) { /* try next */ }
    }
    return null;
}

// Resolve the path to the bundled mobile webapp. In packaged builds the PWA is
// shipped via electron-builder `extraResources` to Resources/mobile. In dev the
// monorepo layout puts it at <repo>/mobile/dist. We check packaged first so a
// contributor running a packaged build from a working tree still gets the
// shipped copy instead of an accidentally-mutated dev tree.
function resolveMobileWebappRoot() {
    const candidates = [];
    if (process.resourcesPath) {
        candidates.push(path.join(process.resourcesPath, 'mobile'));
    }
    candidates.push(path.resolve(__dirname, '../../../../mobile/dist'));
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
  was not found. If you built from source, run <code>npm run build:mobile</code>
  from the repo root and reload.</p>
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
    '.wav':  'audio/wav',
    '.mp3':  'audio/mpeg',
    '.ogg':  'audio/ogg',
};

class MobileBridgeServer {
    constructor({ logger, desktopVersion } = {}) {
        this.log = logger || ((..._a) => {});
        this.store = new SessionStore();
        this.httpServer = null;
        this.wss = null;
        this.heartbeat = null;
        this.tunnel = null;
        this.port = null;
        this.lanIp = null;
        this.webappRoot = null;
        this.desktopVersion = desktopVersion || DESKTOP_VERSION;
        this.onInput = null;          // set by IPC layer
        this.onClientChange = null;   // set by IPC layer
        this.onStatusChange = null;   // set by IPC layer
    }

    isRunning() { return !!this.httpServer; }

    status() {
        if (this.isRunning()) this.lanIp = getLanIp();
        return {
            running: this.isRunning(),
            port: this.port,
            lanUrl: this.lanIp && this.port ? `http://${this.lanIp}:${this.port}/s/${this.store.token}` : null,
            publicUrl: this.tunnel ? `${this.tunnel.url}/s/${this.store.token}` : null,
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
            openTunnel(this.port).then(t => {
                if (!this.isRunning()) {
                    if (t) t.close();
                    return;
                }
                this.tunnel = t;
                if (t) {
                    t.onDeath = () => {
                        this.tunnel = null;
                        this.log('warning', 'Public tunnel disconnected, LAN only');
                        if (this.onStatusChange) this.onStatusChange(this.status());
                    };
                    this.log('info', `Mobile bridge public URL: ${t.url}`);
                } else {
                    this.log('info', 'Public tunnel unavailable, LAN only');
                }
                if (this.onStatusChange) this.onStatusChange(this.status());
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

        if (pathname === '/api/ping') {
            // Include the current set of reachable endpoints so a mobile client
            // scanned in on one transport can discover the alternate and auto-
            // fail-over without a rescan. We only ship origins (scheme+host+port)
            // — the session token stays in the path, which is identical across
            // transports for the same session.
            const st = this.status();
            const endpoints = {};
            if (st.lanUrl)    endpoints.lan    = new URL(st.lanUrl).origin;
            if (st.publicUrl) endpoints.public = new URL(st.publicUrl).origin;
            res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
            res.end(JSON.stringify({
                ok: true,
                name: 'son-of-anton',
                protocol: 1,
                desktopVersion: this.desktopVersion,
                endpoints,
            }));
            return;
        }
        if (pathname === '/api/version') {
            res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
            res.end(JSON.stringify({ desktopVersion: this.desktopVersion, protocol: 1 }));
            return;
        }
        if (pathname === '/api/diag') {
            // Diagnostics are disabled by default: the legacy page embedded the live
            // pairing token into HTML, which leaked it to anyone who could reach the
            // tunnel URL. Enable only on demand (local debugging) by setting
            // SOA_BRIDGE_DIAG=1, and still require the session token as `?t=`.
            if (process.env.SOA_BRIDGE_DIAG !== '1') {
                res.writeHead(404, { 'content-type': 'text/plain' });
                res.end('not found');
                return;
            }
            if (!this.store.validateToken(parsed.searchParams.get('t'))) {
                res.writeHead(401, { 'content-type': 'text/plain' });
                res.end('unauthorized');
                return;
            }
            const status = this.status();
            res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
            res.end(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>SOA Diag</title>
<style>body{background:#000;color:#aaffaa;font-family:monospace;padding:16px}h1{font-size:14px;letter-spacing:.2em}
.ok{color:#5fff5f}.err{color:#ff5d6f}pre{font-size:12px;white-space:pre-wrap}</style></head><body>
<h1>SON OF ANTON &mdash; DIAGNOSTICS</h1>
<p class="ok">HTTP: OK</p>
<pre>Server: ${status.running ? 'running' : 'stopped'}
Port: ${status.port}
Clients: ${status.clients}
Token present: ${status.token ? 'yes' : 'no'}</pre>
</body></html>`);
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
