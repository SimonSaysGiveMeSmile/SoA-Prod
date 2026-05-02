/**
 * Son of Anton — Mobile Companion App entry point.
 *
 * Lifecycle:
 *   1. Read the session token from the URL (?t=…) or localStorage.
 *   2. Open a BridgeSocket to the same host that served us. Once paired we
 *      remember the token so accidental tab closes can resume seamlessly.
 *   3. Render snapshots into the tab strip + active terminal view.
 *   4. Stream incremental terminal output into the <pre>.
 *   5. Forward every user input back to the desktop.
 *
 * Reconnection is handled inside BridgeSocket — we just react to its state
 * events to show / hide the reconnect overlay.
 */

import { BridgeSocket, SocketState, Diagnosis } from './socket.js';
import { ansiToHtml, newState } from './ansi.js';
import { VirtualKeyboard } from './keyboard.js';

const STORAGE_KEY = 'son-of-anton.session';

function readToken() {
    const params = new URLSearchParams(location.search);
    let t = params.get('t');
    if (t) {
        // Persist for next launch (e.g. PWA reopen).
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify({
                token: t,
                origin: location.origin,
                ts: Date.now(),
            }));
        } catch (_) { /* private mode etc. */ }
        // Clean the URL so the token isn't shown / shared.
        if (history.replaceState) {
            const clean = location.origin + location.pathname;
            history.replaceState(null, '', clean);
        }
        return t;
    }
    try {
        const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
        if (saved && saved.token && saved.origin === location.origin) return saved.token;
    } catch (_) { /* ignore */ }
    return null;
}

function wsBaseFromHttp(origin) {
    if (origin.startsWith('https://')) return 'wss://' + origin.slice('https://'.length);
    if (origin.startsWith('http://'))  return 'ws://'  + origin.slice('http://'.length);
    return origin;
}

class App {
    constructor() {
        this.statusDot   = document.querySelector('#status .status-dot');
        this.statusText  = document.querySelector('#status .status-text');
        this.tabsEl      = document.getElementById('tabs');
        this.termEl      = document.getElementById('term');
        this.widgetsEl   = document.getElementById('widgets');
        this.kbdEl       = document.getElementById('kbd');
        this.viewEls     = Array.from(document.querySelectorAll('.view'));
        this.viewBtns    = Array.from(document.querySelectorAll('.bb-btn[data-view]'));
        this.btnNewTab   = document.getElementById('btn-newtab');
        this.btnMic      = document.getElementById('btn-mic');
        this.reconnectOverlay = document.getElementById('reconnect-overlay');
        this.reconnectSub     = document.getElementById('reconnect-sub');
        this.reconnectDiag    = document.getElementById('reconnect-diag');
        this.reconnectRetry   = document.getElementById('reconnect-retry');
        this.reconnectOpenBrowser = document.getElementById('reconnect-open-browser');

        this._snapshot = null;
        this._activeTab = 0;
        this._tabStates = new Map(); // tabIndex → { termState, pendingData }
        this._flushScheduled = false;

        const token = readToken();
        if (!token) {
            this._showFatal('No session token. Re-scan the QR code on the desktop.');
            return;
        }

        this.socket = new BridgeSocket({
            url: wsBaseFromHttp(location.origin),
            token,
        });

        this.kbd = new VirtualKeyboard(this.kbdEl, {
            onInput: (kind, payload) => this.socket.sendInput(kind, payload),
        });

        this._wireSocket();
        this._wireUi();

        this.socket.connect();
    }

    _wireSocket() {
        this.socket.addEventListener('state', (ev) => {
            const { state, attempt, code } = ev.detail;
            switch (state) {
                case SocketState.CONNECTING:
                    this._setStatus('connecting', `connecting${attempt > 1 ? ` · try ${attempt}` : '…'}`);
                    if (attempt > 1) this._showReconnect(`attempt ${attempt}`);
                    break;
                case SocketState.CONNECTED:
                    this._setStatus('connected', 'paired');
                    this._hideReconnect();
                    break;
                case SocketState.DISCONNECTED:
                    this._setStatus('disconnected', `link lost${code ? ` (${code})` : ''}`);
                    this._showReconnect('link lost · retrying');
                    break;
            }
        });

        this.socket.addEventListener('reconnect-scheduled', (ev) => {
            const { delay } = ev.detail;
            const secs = Math.max(0, Math.round(delay / 100) / 10);
            this.reconnectSub.textContent = secs > 0
                ? `retrying in ${secs}s`
                : 'retrying now…';
        });

        this.socket.addEventListener('message', (ev) => {
            const msg = ev.detail;
            switch (msg.t) {
                case 'hello':    /* nothing yet */ break;
                case 'snapshot': this._applySnapshot(msg.d); break;
                case 'term-data': this._applyTerminalChunk(msg.d); break;
                case 'notice':    this._showNotice(msg.d); break;
            }
        });

        this.socket.addEventListener('diagnosis', (ev) => {
            this._showDiagnosis(ev.detail.diagnosis);
        });
    }

    _wireUi() {
        this.viewBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                const target = btn.getAttribute('data-view');
                this._showView(target);
            });
        });

        this.btnNewTab.addEventListener('click', () => this.socket.sendInput('new-tab'));
        this.btnMic.addEventListener('click', () => this.socket.sendInput('voice-toggle'));

        this.termEl.addEventListener('click', () => {
            this._showView('terminal-view');
            this.kbd.focus();
        });

        this.reconnectRetry.addEventListener('click', () => {
            this.reconnectSub.textContent = 'retrying now…';
            this.socket.retryNow();
        });

        this.reconnectOpenBrowser.addEventListener('click', () => {
            window.open('http://captive.apple.com/hotspot-detect.html', '_blank');
        });
    }

    _showView(target) {
        this.viewEls.forEach(v => v.classList.toggle('active', v.id === target));
        this.viewBtns.forEach(b => b.setAttribute('aria-pressed', b.getAttribute('data-view') === target ? 'true' : 'false'));
        if (target === 'terminal-view') {
            this.kbd.show();
        } else {
            this.kbd.hide();
            this.kbd.blur();
        }
    }

    _setStatus(state, text) {
        this.statusDot.setAttribute('data-state', state);
        this.statusText.textContent = text;
    }

    _showReconnect(text) {
        this.reconnectOverlay.hidden = false;
        if (text) this.reconnectSub.textContent = text;
        this.reconnectRetry.hidden = false;
    }
    _hideReconnect() {
        this.reconnectOverlay.hidden = true;
        this.reconnectDiag.hidden = true;
        this.reconnectRetry.hidden = true;
        this.reconnectOpenBrowser.hidden = true;
    }

    _showDiagnosis(diag) {
        if (diag === Diagnosis.CONNECTED || diag === Diagnosis.NONE) {
            this.reconnectDiag.hidden = true;
            this.reconnectOpenBrowser.hidden = true;
            return;
        }
        this.reconnectDiag.hidden = false;
        this.reconnectRetry.hidden = false;
        this.reconnectOpenBrowser.hidden = true;

        switch (diag) {
            case Diagnosis.CAPTIVE_PORTAL:
                this.reconnectDiag.textContent =
                    'WiFi login required — complete the WiFi sign-in page, then tap RETRY.';
                this.reconnectOpenBrowser.hidden = false;
                break;
            case Diagnosis.SERVER_UNREACHABLE:
                this.reconnectDiag.textContent =
                    'Desktop not reachable on this network. Public WiFi often blocks local connections — re-scan the PUB (tunnel) QR code from the desktop.';
                break;
            case Diagnosis.NETWORK_OFFLINE:
                this.reconnectDiag.textContent =
                    'No internet connection. Connect to a network and tap RETRY.';
                break;
        }
    }

    _applySnapshot(snap) {
        if (!snap) return;
        this._snapshot = snap;

        const tabs = snap.tabs || [];
        const activeTab = tabs.find(t => t.active);
        this._activeTab = activeTab ? activeTab.index : 0;

        this._tabStates.clear();
        for (const t of tabs) {
            this._tabStates.set(t.index, { termState: newState(), pendingData: '' });
        }

        this._renderTabs(tabs, snap.activeTab);
        this._renderTerminalSnapshot(snap.terminal || {});
        this._renderWidgets(snap.widgets || {}, snap.host || {});
    }

    _renderTabs(tabs, activeIndex) {
        const frag = document.createDocumentFragment();
        for (const t of tabs) {
            const el = document.createElement('button');
            el.type = 'button';
            el.className = 'tab' + (t.active ? ' active' : '');
            const proc = t.process ? `<span class="tab-proc">${escapeHtml(t.process)}</span>` : '';
            el.innerHTML = `<span class="tab-name">${escapeHtml(t.name || `TAB ${t.index + 1}`)}</span>${proc}`;
            el.addEventListener('click', () => this.socket.sendInput('switch-tab', { index: t.index }));

            let pressTimer = null;
            let didLongPress = false;
            el.addEventListener('pointerdown', () => {
                didLongPress = false;
                pressTimer = setTimeout(() => {
                    didLongPress = true;
                    this._showTabMenu(t, el);
                }, 500);
            });
            const cancel = () => { if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; } };
            el.addEventListener('pointerup', (e) => { cancel(); if (didLongPress) e.preventDefault(); });
            el.addEventListener('pointerleave', cancel);
            el.addEventListener('pointermove', cancel);
            frag.appendChild(el);
        }

        const addBtn = document.createElement('button');
        addBtn.type = 'button';
        addBtn.className = 'tab tab-add';
        addBtn.textContent = '+';
        addBtn.addEventListener('click', () => this.socket.sendInput('new-tab'));
        frag.appendChild(addBtn);

        this.tabsEl.innerHTML = '';
        this.tabsEl.appendChild(frag);
    }

    _showTabMenu(tab, anchorEl) {
        this._dismissTabMenu();
        const menu = document.createElement('div');
        menu.className = 'tab-menu';

        const rect = anchorEl.getBoundingClientRect();
        menu.style.left = `${rect.left}px`;
        menu.style.top = `${rect.bottom + 4}px`;

        const renameBtn = document.createElement('button');
        renameBtn.textContent = 'RENAME';
        renameBtn.addEventListener('click', () => {
            this._dismissTabMenu();
            const name = prompt('Tab name:', tab.name || '');
            if (name !== null) this.socket.sendInput('rename-tab', { index: tab.index, name });
        });

        const closeBtn = document.createElement('button');
        closeBtn.textContent = 'CLOSE';
        closeBtn.addEventListener('click', () => {
            this._dismissTabMenu();
            if (confirm(`Close ${tab.name || 'this tab'}?`)) {
                this.socket.sendInput('close-tab', { index: tab.index });
            }
        });

        menu.appendChild(renameBtn);
        menu.appendChild(closeBtn);
        document.body.appendChild(menu);
        this._tabMenu = menu;

        const dismiss = (e) => {
            if (!menu.contains(e.target)) {
                this._dismissTabMenu();
                document.removeEventListener('pointerdown', dismiss);
            }
        };
        requestAnimationFrame(() => document.addEventListener('pointerdown', dismiss));
    }

    _dismissTabMenu() {
        if (this._tabMenu) {
            this._tabMenu.remove();
            this._tabMenu = null;
        }
    }

    _renderTerminalSnapshot(term) {
        const ts = this._getTabState(this._activeTab);
        ts.termState = newState();
        ts.pendingData = '';
        const text = term.recent || '';
        const { html, state } = ansiToHtml(text, ts.termState);
        ts.termState = state;
        this.termEl.innerHTML = html;
        this._scrollTermBottom();
    }

    _applyTerminalChunk(payload) {
        if (!payload || typeof payload.data !== 'string') return;
        const tabIndex = payload.tab != null ? payload.tab : this._activeTab;
        const ts = this._getTabState(tabIndex);
        ts.pendingData += payload.data;

        if (tabIndex === this._activeTab && !this._flushScheduled) {
            this._flushScheduled = true;
            requestAnimationFrame(() => this._flushPending());
        }
    }

    _getTabState(index) {
        if (!this._tabStates.has(index)) {
            this._tabStates.set(index, { termState: newState(), pendingData: '' });
        }
        return this._tabStates.get(index);
    }

    _flushPending() {
        this._flushScheduled = false;
        const ts = this._getTabState(this._activeTab);
        if (!ts.pendingData) return;

        const data = ts.pendingData;
        ts.pendingData = '';

        const { html, state } = ansiToHtml(data, ts.termState);
        ts.termState = state;
        this.termEl.insertAdjacentHTML('beforeend', html);

        const MAX_NODES = 4000;
        while (this.termEl.childNodes.length > MAX_NODES) {
            this.termEl.removeChild(this.termEl.firstChild);
        }
        this._scrollTermBottom();
    }

    _scrollTermBottom() {
        // Defer to next frame so layout is up to date
        requestAnimationFrame(() => {
            this.termEl.scrollTop = this.termEl.scrollHeight;
        });
    }

    _renderWidgets(widgets, host) {
        const cards = [];
        if (host && host.name) {
            cards.push(card('HOST', host.name, host.platform ? host.platform.toUpperCase() : ''));
        }
        if (widgets.clock) {
            const t = new Date(widgets.clock.time);
            const hh = String(t.getHours()).padStart(2, '0');
            const mm = String(t.getMinutes()).padStart(2, '0');
            const ss = String(t.getSeconds()).padStart(2, '0');
            cards.push(card('CLOCK', `${hh}:${mm}:${ss}`, t.toDateString()));
        }
        if (widgets.cpu) {
            cards.push(meterCard('CPU', widgets.cpu.usagePct));
        }
        if (widgets.ram) {
            cards.push(meterCard('MEMORY', widgets.ram.usagePct));
        }
        if (widgets.net) {
            const inbps  = formatRate(widgets.net.rx_sec || widgets.net.rxBytesPerSec);
            const outbps = formatRate(widgets.net.tx_sec || widgets.net.txBytesPerSec);
            cards.push(card('NETWORK', `${inbps} ↓ · ${outbps} ↑`, ''));
        }
        this.widgetsEl.innerHTML = cards.join('') || `<div class="w-card"><h2>No data yet</h2><div class="w-meta">Waiting for the desktop to push state…</div></div>`;
    }

    _showNotice({ level, text }) {
        // Lightweight: just print into the terminal as a coloured line for now.
        if (!text) return;
        const colour = level === 'error' ? '\x1b[91m' : (level === 'warn' ? '\x1b[93m' : '\x1b[92m');
        this._applyTerminalChunk({ data: `\r\n${colour}[${(level || 'info').toUpperCase()}] ${text}\x1b[0m\r\n` });
    }

    _showFatal(text) {
        document.getElementById('app').innerHTML = `
            <div style="padding:32px;text-align:center;color:#ff5d6f;font-size:14px;letter-spacing:.18em;">
                <div style="font-size:18px;margin-bottom:14px;color:#aaffaa;">SESSION REQUIRED</div>
                <div>${escapeHtml(text)}</div>
            </div>`;
    }
}

function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => (
        { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]
    ));
}

function card(title, value, meta) {
    return `<div class="w-card"><h2>${escapeHtml(title)}</h2><div class="w-value">${escapeHtml(value)}</div>${meta ? `<div class="w-meta">${escapeHtml(meta)}</div>` : ''}</div>`;
}

function meterCard(title, pct) {
    const v = Math.max(0, Math.min(100, Number(pct) || 0));
    return `<div class="w-card">
        <h2>${escapeHtml(title)}</h2>
        <div class="w-value">${v.toFixed(0)}%</div>
        <div class="w-bar"><span style="width:${v}%"></span></div>
    </div>`;
}

function formatRate(bps) {
    if (!Number.isFinite(bps)) return '—';
    if (bps < 1024) return `${bps.toFixed(0)} B/s`;
    if (bps < 1024 * 1024) return `${(bps / 1024).toFixed(1)} KB/s`;
    return `${(bps / 1024 / 1024).toFixed(2)} MB/s`;
}

window.addEventListener('DOMContentLoaded', () => {
    new App();
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js').catch(() => { /* fine if it fails */ });
    }
});
