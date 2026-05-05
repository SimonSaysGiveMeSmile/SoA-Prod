/**
 * MobileQRWidget
 *
 * Sci-fi tile that lets the user pair a mobile device with the current Son of
 * Anton session by scanning a QR code. Shows:
 *
 *   - status pill (offline / starting / online · N clients)
 *   - QR image encoding the LAN URL (and the public URL once the tunnel is up)
 *   - copy-to-clipboard for both URLs
 *   - a single button to start/stop the bridge
 *
 * IMPORTANT: This file is loaded via a <script> tag in ui.html. In Electron's
 * renderer with nodeIntegration: true, top-level require() in such files
 * causes the renderer to crash silently (black screen). Keep all require()
 * calls inside methods. We deliberately DO NOT load `qrcode` here — QR images
 * are generated in the main process (which has Node free of those constraints)
 * and shipped over IPC as data URLs.
 */

class MobileQRWidget {
    constructor(parentId) {
        if (!parentId) throw new Error('MobileQRWidget: missing parentId');

        // Lazy-load the bridge controller (also a <script>-loaded class, exposed
        // as a top-level identifier by its own <script> tag). Falling back to
        // `require()` keeps us robust if the load order ever changes.
        if (!window.mobileBridge) {
            const Bridge = (typeof MobileBridge !== 'undefined')
                ? MobileBridge
                : require('./classes/mobileBridge.class.js').MobileBridge;
            window.mobileBridge = new Bridge();
        }
        this.bridge = window.mobileBridge;

        this.parent = document.getElementById(parentId);
        if (!this.parent) return;

        this.parent.insertAdjacentHTML('beforeend', `
            <div id="mod_mobileQR" class="mod_mobileQR">
                <h1>// MOBILE LINK</h1>
                <div class="mqr-row mqr-status-row">
                    <span class="mqr-dot" data-state="off"></span>
                    <span class="mqr-status-text">offline</span>
                </div>
                <div class="mqr-qr-wrap">
                    <div class="mqr-qr-placeholder">
                        <span>tap "pair" to generate<br/>a session QR code</span>
                    </div>
                </div>
                <div class="mqr-urls" hidden>
                    <div class="mqr-url-row" data-kind="lan">
                        <span class="mqr-url-label">LAN</span>
                        <span class="mqr-url-value">—</span>
                        <button class="mqr-copy" data-target="lan" type="button">copy</button>
                    </div>
                    <div class="mqr-url-row" data-kind="public">
                        <span class="mqr-url-label">PUB</span>
                        <span class="mqr-url-value">—</span>
                        <button class="mqr-copy" data-target="public" type="button">copy</button>
                    </div>
                </div>
                <div class="mqr-actions">
                    <button class="mqr-toggle" type="button">PAIR</button>
                    <span class="mqr-clients" title="connected mobile clients">0 paired</span>
                </div>
            </div>
        `);

        this.root = document.getElementById('mod_mobileQR');
        this.dot = this.root.querySelector('.mqr-dot');
        this.statusText = this.root.querySelector('.mqr-status-text');
        this.qrWrap = this.root.querySelector('.mqr-qr-wrap');
        this.urls = this.root.querySelector('.mqr-urls');
        this.lanRow = this.root.querySelector('.mqr-url-row[data-kind="lan"] .mqr-url-value');
        this.publicRow = this.root.querySelector('.mqr-url-row[data-kind="public"] .mqr-url-value');
        this.toggleBtn = this.root.querySelector('.mqr-toggle');
        this.clientsText = this.root.querySelector('.mqr-clients');

        this.toggleBtn.addEventListener('click', () => this._toggle());
        this.root.querySelectorAll('.mqr-copy').forEach(btn => {
            btn.addEventListener('click', e => {
                const which = e.currentTarget.getAttribute('data-target');
                const value = which === 'lan' ? this._lanUrl : this._publicUrl;
                if (value) this._copyToClipboard(value, e.currentTarget);
            });
        });

        this._unsubscribe = this.bridge.onStatus(s => this._render(s));
        this.bridge.refreshStatus();

        this._refreshInterval = setInterval(() => {
            if (this.bridge.status && this.bridge.status.running) {
                this.bridge.refreshStatus();
            }
        }, 5000);
    }

    async _toggle() {
        this.toggleBtn.disabled = true;
        try {
            const status = this.bridge.status;
            if (status && status.running) {
                await this.bridge.stop();
            } else {
                this._setBusy('starting…');
                await this.bridge.start({ withTunnel: true });
            }
        } finally {
            this.toggleBtn.disabled = false;
        }
    }

    _setBusy(text) {
        this.dot.setAttribute('data-state', 'pending');
        this.statusText.textContent = text;
    }

    _render(status) {
        if (!this.root) return;
        const running = !!(status && status.running);
        this.dot.setAttribute('data-state', running ? (status.clients > 0 ? 'on' : 'idle') : 'off');
        if (running) {
            this.statusText.textContent = status.clients > 0 ? `online · ${status.clients} paired` : 'online · waiting';
        } else {
            this.statusText.textContent = 'offline';
        }
        this.toggleBtn.textContent = running ? 'UNPAIR' : 'PAIR';
        this.clientsText.textContent = `${status && status.clients ? status.clients : 0} paired`;

        const lan = (status && status.lanUrl) || null;
        const pub = (status && status.publicUrl) || null;
        this._lanUrl = lan;
        this._publicUrl = pub;

        if (running && (lan || pub)) {
            this.urls.hidden = false;
            this.lanRow.textContent = lan || '—';
            this.publicRow.textContent = pub || 'tunnel unavailable';
            this._renderQr(pub || lan);
        } else {
            this.urls.hidden = true;
            this._clearQr();
        }
    }

    _renderQr(url) {
        if (this._lastQr === url) return;
        this._lastQr = url;
        this.qrWrap.innerHTML = '';

        // Generation lives in the main process, both because the `qrcode`
        // package is unsafe to top-level-require in the renderer (see file
        // header) and because doing it once in main keeps every paired client
        // looking at exactly the same image.
        this.bridge.getQrDataUrl(url, {
            width: 196,
            margin: 1,
            color: { dark: '#ffffff', light: '#00000000' },
            errorCorrectionLevel: 'M',
        }).then(dataUrl => {
            // Only render if URL hasn't changed since the request was issued
            if (this._lastQr !== url) return;
            this.qrWrap.innerHTML = '';
            if (dataUrl) {
                const img = document.createElement('img');
                img.className = 'mqr-qr';
                img.alt = 'Pairing QR code';
                img.src = dataUrl;
                this.qrWrap.appendChild(img);
            } else {
                const fallback = document.createElement('div');
                fallback.className = 'mqr-qr-fallback';
                fallback.textContent = url;
                this.qrWrap.appendChild(fallback);
            }
        }).catch(() => {
            if (this._lastQr !== url) return;
            this.qrWrap.innerHTML = '';
            const fallback = document.createElement('div');
            fallback.className = 'mqr-qr-fallback';
            fallback.textContent = url;
            this.qrWrap.appendChild(fallback);
        });
    }

    _clearQr() {
        this._lastQr = null;
        this.qrWrap.innerHTML = `<div class="mqr-qr-placeholder"><span>tap "pair" to generate<br/>a session QR code</span></div>`;
    }

    _copyToClipboard(text, btn) {
        const done = () => {
            const prev = btn.textContent;
            btn.textContent = 'copied';
            btn.disabled = true;
            setTimeout(() => { btn.textContent = prev; btn.disabled = false; }, 1200);
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(done).catch(() => {
                this._fallbackCopy(text);
                done();
            });
        } else {
            this._fallbackCopy(text);
            done();
        }
    }

    _fallbackCopy(text) {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); } catch (_) { /* noop */ }
        document.body.removeChild(ta);
    }

    destroy() {
        if (this._refreshInterval) clearInterval(this._refreshInterval);
        if (this._unsubscribe) this._unsubscribe();
        if (this.root && this.root.parentNode) this.root.parentNode.removeChild(this.root);
    }
}

module.exports = { MobileQRWidget };
