/**
 * BridgeSocket — robust WebSocket client for Son of Anton's mobile bridge.
 *
 * Goals:
 *   - Never give up. Once a session is paired, we keep trying to come back.
 *   - Tell the UI exactly what's going on (states + events).
 *   - Survive backgrounding (visibility change reconnect kick).
 *   - Heartbeat to detect silently-dead sockets.
 */

const PROTOCOL_VERSION = 1;

export const SocketState = Object.freeze({
    IDLE:         'idle',
    CONNECTING:   'connecting',
    CONNECTED:    'connected',
    DISCONNECTED: 'disconnected',
    GIVING_UP:    'giving-up',
});

export const Diagnosis = Object.freeze({
    NONE:               'none',
    CONNECTED:          'connected',
    CAPTIVE_PORTAL:     'captive-portal',
    SERVER_UNREACHABLE: 'server-unreachable',
    NETWORK_OFFLINE:    'network-offline',
});

export class BridgeSocket extends EventTarget {
    constructor({ url, token }) {
        super();
        this.baseUrl = url;          // e.g. ws://192.168.1.7:7330
        this.token = token;
        this.state = SocketState.IDLE;
        this.diagnosis = Diagnosis.NONE;
        this.ws = null;
        this._attempt = 0;
        this._stop = false;
        this._reconnectTimer = null;
        this._heartbeatTimer = null;
        this._lastPongAt = 0;
        this._probeController = null;

        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible' && this.state !== SocketState.CONNECTED) {
                this._scheduleReconnect(0);
            }
        });

        window.addEventListener('online', () => {
            if (this.state !== SocketState.CONNECTED) this._scheduleReconnect(0);
        });
        window.addEventListener('offline', () => {
            this._setDiagnosis(Diagnosis.NETWORK_OFFLINE);
        });

        const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
        if (conn) {
            conn.addEventListener('change', () => {
                if (this.state !== SocketState.CONNECTED) this._scheduleReconnect(0);
            });
        }
    }

    connect() {
        this._stop = false;
        this._open();
    }

    close() {
        this._stop = true;
        this._clearTimers();
        if (this.ws) {
            try { this.ws.close(1000, 'client closed'); } catch (_) {}
        }
        this._setState(SocketState.IDLE);
    }

    send(typeOrFrame, data, id) {
        if (!this.ws || this.ws.readyState !== 1) return false;
        const f = typeof typeOrFrame === 'string'
            ? { v: PROTOCOL_VERSION, t: typeOrFrame, d: data || {} }
            : typeOrFrame;
        if (id) f.id = id;
        try {
            this.ws.send(JSON.stringify(f));
            return true;
        } catch (_) { return false; }
    }

    sendInput(kind, payload = {}) {
        return this.send('input', Object.assign({ kind }, payload));
    }

    retryNow() {
        this._attempt = 0;
        this._scheduleReconnect(0);
    }

    _setDiagnosis(diag) {
        if (this.diagnosis === diag) return;
        this.diagnosis = diag;
        this.dispatchEvent(new CustomEvent('diagnosis', { detail: { diagnosis: diag } }));
    }

    _setState(state, detail) {
        if (this.state === state) return;
        this.state = state;
        this.dispatchEvent(new CustomEvent('state', { detail: { state, ...(detail || {}) } }));
    }

    _open() {
        this._clearTimers();
        const url = `${this.baseUrl}/ws?t=${encodeURIComponent(this.token)}`;
        this._setState(SocketState.CONNECTING, { attempt: this._attempt + 1 });

        this._probeConnectivity().then(diag => {
            if (this._stop) return;
            this._setDiagnosis(diag);

            if (diag === Diagnosis.NETWORK_OFFLINE || diag === Diagnosis.CAPTIVE_PORTAL) {
                this._scheduleReconnect();
                return;
            }

            let ws;
            try {
                ws = new WebSocket(url);
            } catch (e) {
                this._scheduleReconnect();
                return;
            }
            this.ws = ws;

            ws.addEventListener('open', () => {
                this._attempt = 0;
                this._lastPongAt = Date.now();
                this._setDiagnosis(Diagnosis.CONNECTED);
                this._setState(SocketState.CONNECTED);
                this._startHeartbeat();
                this.send('request', { what: 'snapshot' });
            });

            ws.addEventListener('message', (ev) => {
                let msg;
                try { msg = JSON.parse(ev.data); }
                catch (_) { return; }
                if (!msg || typeof msg.t !== 'string') return;
                if (msg.t === 'pong') {
                    this._lastPongAt = Date.now();
                    return;
                }
                this.dispatchEvent(new CustomEvent('message', { detail: msg }));
            });

            ws.addEventListener('error', () => {});

            ws.addEventListener('close', (ev) => {
                this._stopHeartbeat();
                this.ws = null;
                if (this._stop) {
                    this._setState(SocketState.IDLE, { code: ev.code });
                    return;
                }
                this._setState(SocketState.DISCONNECTED, { code: ev.code, reason: ev.reason });
                this._scheduleReconnect();
            });
        });
    }

    async _probeConnectivity() {
        if (!navigator.onLine) return Diagnosis.NETWORK_OFFLINE;

        if (this._probeController) this._probeController.abort();
        this._probeController = new AbortController();
        const signal = this._probeController.signal;
        const timeoutId = setTimeout(() => this._probeController.abort(), 6000);

        const httpOrigin = this.baseUrl.replace(/^ws(s?):\/\//, 'http$1://');

        try {
            const res = await fetch(httpOrigin + '/api/ping', {
                signal, cache: 'no-store',
            });
            clearTimeout(timeoutId);
            if (res.ok) {
                const body = await res.json().catch(() => null);
                if (body && body.ok) return Diagnosis.CONNECTED;
            }
            return Diagnosis.CAPTIVE_PORTAL;
        } catch (_) {
            // Server unreachable — check internet to classify further
        }

        try {
            const res = await fetch('http://connectivitycheck.gstatic.com/generate_204', {
                signal, mode: 'no-cors', cache: 'no-store', redirect: 'manual',
            });
            clearTimeout(timeoutId);
            if (res.type === 'opaqueredirect') return Diagnosis.CAPTIVE_PORTAL;
            return Diagnosis.SERVER_UNREACHABLE;
        } catch (_) {
            clearTimeout(timeoutId);
            return navigator.onLine ? Diagnosis.CAPTIVE_PORTAL : Diagnosis.NETWORK_OFFLINE;
        }
    }

    _scheduleReconnect(forcedDelayMs) {
        if (this._stop) return;
        this._clearTimers();
        this._attempt += 1;
        const delay = (forcedDelayMs != null)
            ? forcedDelayMs
            : Math.min(30000, 250 * Math.pow(1.7, Math.min(this._attempt - 1, 12)));
        this.dispatchEvent(new CustomEvent('reconnect-scheduled', { detail: { delay, attempt: this._attempt } }));
        this._reconnectTimer = setTimeout(() => this._open(), delay);
    }

    _startHeartbeat() {
        this._stopHeartbeat();
        this._heartbeatTimer = setInterval(() => {
            // If we haven't heard a pong in 15s, assume the connection is dead.
            if (Date.now() - this._lastPongAt > 15000) {
                try { this.ws && this.ws.close(4000, 'heartbeat timeout'); } catch (_) {}
                return;
            }
            this.send('ping', { ts: Date.now() });
        }, 5000);
    }

    _stopHeartbeat() {
        if (this._heartbeatTimer) clearInterval(this._heartbeatTimer);
        this._heartbeatTimer = null;
    }

    _clearTimers() {
        if (this._reconnectTimer) clearTimeout(this._reconnectTimer);
        this._reconnectTimer = null;
    }
}
