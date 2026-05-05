/**
 * Mobile Bridge SessionStore
 *
 * Holds the transient state shared with mobile clients:
 *   - the auth token
 *   - the most recent UI snapshot pushed by the renderer (so late-joiners see something)
 *   - the set of currently connected mobile clients
 *
 * Designed to be cheap and synchronous. Persistence is intentionally not provided
 * because everything here is tied to the lifetime of a single desktop session.
 */

const crypto = require('crypto');

class SessionStore {
    constructor() {
        this.token = null;
        this.snapshot = null;          // last full snapshot from renderer
        this.snapshotVersion = 0;      // monotonically increasing
        this.clients = new Set();      // Set<WebSocket>
        this.startedAt = null;
    }

    /** (Re)generate a fresh auth token. Returns the new token. */
    rotateToken() {
        this.token = crypto.randomBytes(24).toString('base64url');
        return this.token;
    }

    /** Validate a token sent by a connecting client. */
    validateToken(candidate) {
        if (!this.token || !candidate) return false;
        // Constant-time compare to avoid leaking timing info
        const a = Buffer.from(this.token);
        const b = Buffer.from(String(candidate));
        if (a.length !== b.length) return false;
        return crypto.timingSafeEqual(a, b);
    }

    setSnapshot(snapshot) {
        this.snapshot = snapshot || null;
        this.snapshotVersion += 1;
    }

    addClient(ws) {
        this.clients.add(ws);
    }

    removeClient(ws) {
        this.clients.delete(ws);
    }

    broadcast(rawFrame) {
        for (const ws of this.clients) {
            if (ws.readyState === 1 /* OPEN */) {
                try { ws.send(rawFrame); } catch (_) { /* socket may be tearing down */ }
            }
        }
    }

    clientCount() {
        return this.clients.size;
    }

    reset() {
        for (const ws of this.clients) {
            try { ws.close(1001, 'bridge stopped'); } catch (_) { /* ignore */ }
        }
        this.clients.clear();
        this.snapshot = null;
        this.snapshotVersion = 0;
        this.token = null;
        this.startedAt = null;
    }
}

module.exports = { SessionStore };
