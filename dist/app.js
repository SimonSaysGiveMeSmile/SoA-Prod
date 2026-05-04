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
const THEME_KEY = 'son-of-anton.theme';

/* ── Theme definitions ──────────────────────────────── */

const THEMES = {
    mono: {
        name: 'Mono',
        preview: ['#000000', '#ffffff'],
        vars: {
            '--bg':             '#000000',
            '--bg-alt':         '#111111',
            '--fg':             '#e0e0e0',
            '--fg-dim':         'rgba(224,224,224,0.55)',
            '--fg-faint':       'rgba(224,224,224,0.2)',
            '--accent':         '#ffffff',
            '--accent-glow':    'rgba(255,255,255,0.5)',
            '--accent-bg':      'rgba(255,255,255,0.08)',
            '--accent-bg-hover':'rgba(255,255,255,0.15)',
            '--warn':           '#ffb84d',
            '--err':            '#ff5d6f',
            '--line':           'rgba(224,224,224,0.22)',
            '--radius':         '2px',
            '--panel-bg':       'rgba(0,0,0,0.75)',
            '--font':           'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
        },
        colorScheme: 'dark',
    },
    matrix: {
        name: 'Matrix',
        preview: ['#000000', '#5fff5f'],
        vars: {
            '--bg':             '#000000',
            '--bg-alt':         '#03130a',
            '--fg':             '#aaffaa',
            '--fg-dim':         'rgba(170,255,170,0.55)',
            '--fg-faint':       'rgba(170,255,170,0.2)',
            '--accent':         '#5fff5f',
            '--accent-glow':    'rgba(95,255,95,0.6)',
            '--accent-bg':      'rgba(95,255,95,0.08)',
            '--accent-bg-hover':'rgba(95,255,95,0.15)',
            '--warn':           '#ffb84d',
            '--err':            '#ff5d6f',
            '--line':           'rgba(170,255,170,0.22)',
            '--radius':         '2px',
            '--panel-bg':       'rgba(3,19,10,0.85)',
            '--font':           'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
        },
        colorScheme: 'dark',
    },
    amber: {
        name: 'Amber',
        preview: ['#0a0800', '#ffb347'],
        vars: {
            '--bg':             '#0a0800',
            '--bg-alt':         '#141000',
            '--fg':             '#ffd9a0',
            '--fg-dim':         'rgba(255,217,160,0.55)',
            '--fg-faint':       'rgba(255,217,160,0.2)',
            '--accent':         '#ffb347',
            '--accent-glow':    'rgba(255,179,71,0.6)',
            '--accent-bg':      'rgba(255,179,71,0.08)',
            '--accent-bg-hover':'rgba(255,179,71,0.15)',
            '--warn':           '#ffe066',
            '--err':            '#ff5d6f',
            '--line':           'rgba(255,217,160,0.22)',
            '--radius':         '2px',
            '--panel-bg':       'rgba(10,8,0,0.85)',
            '--font':           'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
        },
        colorScheme: 'dark',
    },
    ocean: {
        name: 'Ocean',
        preview: ['#020c18', '#5fa8ff'],
        vars: {
            '--bg':             '#020c18',
            '--bg-alt':         '#081828',
            '--fg':             '#b0d4ff',
            '--fg-dim':         'rgba(176,212,255,0.55)',
            '--fg-faint':       'rgba(176,212,255,0.2)',
            '--accent':         '#5fa8ff',
            '--accent-glow':    'rgba(95,168,255,0.6)',
            '--accent-bg':      'rgba(95,168,255,0.08)',
            '--accent-bg-hover':'rgba(95,168,255,0.15)',
            '--warn':           '#ffb84d',
            '--err':            '#ff5d6f',
            '--line':           'rgba(176,212,255,0.22)',
            '--radius':         '2px',
            '--panel-bg':       'rgba(2,12,24,0.85)',
            '--font':           'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
        },
        colorScheme: 'dark',
    },
    rose: {
        name: 'Rose',
        preview: ['#0e0408', '#ff6b8a'],
        vars: {
            '--bg':             '#0e0408',
            '--bg-alt':         '#180812',
            '--fg':             '#ffc0d0',
            '--fg-dim':         'rgba(255,192,208,0.55)',
            '--fg-faint':       'rgba(255,192,208,0.2)',
            '--accent':         '#ff6b8a',
            '--accent-glow':    'rgba(255,107,138,0.6)',
            '--accent-bg':      'rgba(255,107,138,0.08)',
            '--accent-bg-hover':'rgba(255,107,138,0.15)',
            '--warn':           '#ffb84d',
            '--err':            '#ff5d6f',
            '--line':           'rgba(255,192,208,0.22)',
            '--radius':         '2px',
            '--panel-bg':       'rgba(14,4,8,0.85)',
            '--font':           'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
        },
        colorScheme: 'dark',
    },
    'liquid-glass': {
        name: 'Liquid Glass',
        preview: ['#f0f2f5', '#0071e3'],
        vars: {
            '--bg':             '#f0f2f5',
            '--bg-alt':         '#e8eaed',
            '--fg':             '#1d1d1f',
            '--fg-dim':         'rgba(29,29,31,0.5)',
            '--fg-faint':       'rgba(29,29,31,0.15)',
            '--accent':         '#0071e3',
            '--accent-glow':    'rgba(0,113,227,0.3)',
            '--accent-bg':      'rgba(0,113,227,0.08)',
            '--accent-bg-hover':'rgba(0,113,227,0.14)',
            '--warn':           '#e67e00',
            '--err':            '#e3342f',
            '--line':           'rgba(0,0,0,0.1)',
            '--radius':         '14px',
            '--panel-bg':       'rgba(255,255,255,0.55)',
            '--font':           "-apple-system, BlinkMacSystemFont, 'SF Pro Display', system-ui, sans-serif",
        },
        colorScheme: 'light',
    },
};

const DEFAULT_THEME = 'mono';

function applyTheme(name) {
    const theme = THEMES[name] || THEMES[DEFAULT_THEME];
    const root = document.documentElement;
    for (const [prop, val] of Object.entries(theme.vars)) {
        root.style.setProperty(prop, val);
    }
    root.setAttribute('data-theme', name);
    root.style.colorScheme = theme.colorScheme;
    root.style.fontFamily = theme.vars['--font'];
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme.vars['--bg']);
    try { localStorage.setItem(THEME_KEY, name); } catch (_) {}
}

function loadSavedTheme() {
    try {
        const saved = localStorage.getItem(THEME_KEY);
        if (saved && THEMES[saved]) return saved;
    } catch (_) {}
    return DEFAULT_THEME;
}

/* ── Boot theme immediately to avoid FOUC ────────── */
applyTheme(loadSavedTheme());

/* ── App ─────────────────────────────────────────── */

function readToken() {
    const params = new URLSearchParams(location.search);
    let t = params.get('t');
    if (!t && location.hash) {
        const hashParams = new URLSearchParams(location.hash.slice(1));
        t = hashParams.get('t');
    }
    if (!t) {
        const pathMatch = location.pathname.match(/^\/s\/([A-Za-z0-9_-]+)/);
        if (pathMatch) t = pathMatch[1];
    }
    if (t) {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify({
                token: t,
                origin: location.origin,
                ts: Date.now(),
            }));
        } catch (_) {}
        if (history.replaceState) {
            const clean = location.origin + '/';
            history.replaceState(null, '', clean);
        }
        return t;
    }
    try {
        const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
        if (saved && saved.token && saved.origin === location.origin) return saved.token;
    } catch (_) {}
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
        this.btnSettings = document.getElementById('btn-settings');
        this.reconnectOverlay = document.getElementById('reconnect-overlay');
        this.reconnectSub     = document.getElementById('reconnect-sub');
        this.reconnectDiag    = document.getElementById('reconnect-diag');
        this.reconnectRetry   = document.getElementById('reconnect-retry');
        this.reconnectOpenBrowser = document.getElementById('reconnect-open-browser');

        this.settingsOverlay = document.getElementById('settings-overlay');
        this.themeGrid = document.getElementById('theme-grid');
        this.settingsClose = document.getElementById('settings-close');

        this._snapshot = null;
        this._activeTab = 0;
        this._tabStates = new Map();
        this._flushScheduled = false;
        this._currentTheme = loadSavedTheme();
        this._idleTimer = null;
        this._chromeHidden = false;

        this._baseFontSize = 20;
        this._termCols = 80;
        this._userScrolledUp = false;

        this._pullHint = document.createElement('div');
        this._pullHint.className = 'pull-hint';
        document.body.appendChild(this._pullHint);

        if (this.themeGrid) this._renderThemeGrid();
        if (this.btnSettings) this._wireSettings();
        this._wireIdleHide();

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

        window.addEventListener('resize', () => this._fitTerminalFont());

        this.termEl.addEventListener('scroll', () => {
            this._userScrolledUp = !this._isAtBottom();
        }, { passive: true });

        this.socket.connect();
    }

    /* ── Settings / Themes ── */

    _renderThemeGrid() {
        this.themeGrid.innerHTML = '';
        for (const [id, theme] of Object.entries(THEMES)) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'theme-swatch' + (id === this._currentTheme ? ' active' : '');
            btn.dataset.theme = id;

            const [bgColor, accentColor] = theme.preview;
            btn.innerHTML = `
                <div class="swatch-preview" style="background:${bgColor};">
                    <div style="position:absolute;inset:25%;border-radius:50%;background:${accentColor};"></div>
                </div>
                <span class="swatch-name">${escapeHtml(theme.name)}</span>
            `;
            btn.addEventListener('click', () => this._selectTheme(id));
            this.themeGrid.appendChild(btn);
        }
    }

    _selectTheme(id) {
        if (!THEMES[id]) return;
        this._currentTheme = id;
        applyTheme(id);
        this.themeGrid.querySelectorAll('.theme-swatch').forEach(el => {
            el.classList.toggle('active', el.dataset.theme === id);
        });
    }

    _wireSettings() {
        if (!this.settingsOverlay || !this.settingsClose) return;
        this.btnSettings.addEventListener('click', () => this._openSettings());
        this.settingsClose.addEventListener('click', () => this._closeSettings());
        this.settingsOverlay.addEventListener('click', (e) => {
            if (e.target === this.settingsOverlay) this._closeSettings();
        });
    }

    _openSettings() {
        if (this.settingsOverlay) this.settingsOverlay.classList.add('open');
    }

    _closeSettings() {
        if (this.settingsOverlay) this.settingsOverlay.classList.remove('open');
    }

    /* ── Auto-hide chrome ── */

    _wireIdleHide() {
        const app = document.getElementById('app');
        const resetIdle = () => this._showChrome();
        for (const evt of ['pointerdown', 'pointermove', 'keydown', 'touchstart']) {
            app.addEventListener(evt, resetIdle, { passive: true });
        }
        this._resetIdleTimer();
    }

    _resetIdleTimer() {
        clearTimeout(this._idleTimer);
        this._idleTimer = setTimeout(() => {
            if (this.settingsOverlay && this.settingsOverlay.classList.contains('open')) return;
            if (this.reconnectOverlay && !this.reconnectOverlay.hidden) return;
            this._hideChrome();
        }, 5000);
    }

    _hideChrome() {
        if (this._chromeHidden) return;
        this._chromeHidden = true;
        const bb = document.getElementById('bottombar');
        if (bb) bb.classList.add('chrome-hidden');
        if (this.kbdEl) this.kbdEl.classList.add('chrome-hidden');
        this._pullHint.classList.add('visible');
    }

    _showChrome() {
        if (this._chromeHidden) {
            this._chromeHidden = false;
            const bb = document.getElementById('bottombar');
            if (bb) bb.classList.remove('chrome-hidden');
            if (this.kbdEl) this.kbdEl.classList.remove('chrome-hidden');
            this._pullHint.classList.remove('visible');
        }
        this._resetIdleTimer();
    }

    /* ── Socket ── */

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

        this._msgCounts = { hello: 0, snapshot: 0, 'term-data': 0, notice: 0, other: 0 };
        this._lastMsgAt = 0;

        this.socket.addEventListener('message', (ev) => {
            const msg = ev.detail;
            this._lastMsgAt = Date.now();
            this._msgCounts[msg.t] = (this._msgCounts[msg.t] || 0) + 1;
            switch (msg.t) {
                case 'hello':    break;
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
        if (state === 'connected' && !this._diagTimer) {
            this._diagTimer = setInterval(() => this._updateDiagStatus(), 2000);
        }
    }

    _updateDiagStatus() {
        if (this.socket.state !== 'connected') {
            if (this._diagTimer) { clearInterval(this._diagTimer); this._diagTimer = null; }
            return;
        }
        const s = this._msgCounts.snapshot;
        const t = this._msgCounts['term-data'];
        this.statusText.textContent = `paired · S:${s} T:${t}`;
    }

    diag() {
        const age = this._lastMsgAt ? ((Date.now() - this._lastMsgAt) / 1000).toFixed(1) + 's ago' : 'never';
        return {
            socketState: this.socket.state,
            messages: { ...this._msgCounts },
            lastMessage: age,
            activeTab: this._activeTab,
            tabStates: Array.from(this._tabStates.entries()).map(([k, v]) => ({
                tab: k,
                pendingBytes: v.pendingData.length,
            })),
            termChildNodes: this.termEl.childNodes.length,
        };
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
        const newActiveTab = activeTab ? activeTab.index : 0;
        this._hasReceivedSnapshot = true;
        this._activeTab = newActiveTab;

        for (const t of tabs) {
            if (!this._tabStates.has(t.index)) {
                this._tabStates.set(t.index, { termState: newState(), pendingData: '' });
            }
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
            if (t.status) el.setAttribute('data-status', t.status);
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

        const resyncBtn = document.createElement('button');
        resyncBtn.textContent = 'RESYNC';
        resyncBtn.addEventListener('click', () => {
            this._dismissTabMenu();
            this._resync();
        });

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

        menu.appendChild(resyncBtn);
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

    _resync() {
        this._tabStates.clear();
        this._hasReceivedSnapshot = false;
        this.termEl.innerHTML = '';
        this.socket.send('request', { what: 'snapshot' });
    }

    _renderTerminalSnapshot(term) {
        const ts = this._getTabState(this._activeTab);
        ts.termState = newState();
        ts.pendingData = '';

        const prevScrollTop = this.termEl.scrollTop;

        let text = term.screen || term.recent || '';
        if (!term.screen) {
            text = text.replace(/\r\n/g, '\n').replace(/\r/g, '');
        }
        const { html, state } = ansiToHtml(text, ts.termState);
        ts.termState = state;
        this.termEl.innerHTML = html;
        this._fitTerminalFont(term.cols);

        if (this._userScrolledUp) {
            this.termEl.scrollTop = prevScrollTop;
        } else {
            this._scrollTermBottom();
        }
    }

    _applyTerminalChunk(payload) {
        if (!payload || typeof payload.data !== 'string') return;
        if (this._hasReceivedSnapshot) return;
        const tabIndex = payload.tab ?? payload.index ?? this._activeTab;
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

        let data = ts.pendingData;
        ts.pendingData = '';

        data = data.replace(/\r\n/g, '\n');
        const crParts = data.split('\r');

        for (let ci = 0; ci < crParts.length; ci++) {
            if (ci > 0) this._eraseCurrentLine();
            const seg = crParts[ci];
            if (!seg) continue;
            const { html, state } = ansiToHtml(seg, ts.termState);
            ts.termState = state;
            this.termEl.insertAdjacentHTML('beforeend', html);
        }

        const MAX_NODES = 4000;
        while (this.termEl.childNodes.length > MAX_NODES) {
            this.termEl.removeChild(this.termEl.firstChild);
        }

        if (!this._userScrolledUp) {
            requestAnimationFrame(() => {
                this.termEl.scrollTop = this.termEl.scrollHeight;
            });
        }
    }

    _scrollTermBottom() {
        requestAnimationFrame(() => {
            this.termEl.scrollTop = this.termEl.scrollHeight;
        });
    }

    _isAtBottom() {
        const el = this.termEl;
        return (el.scrollHeight - el.scrollTop - el.clientHeight) < 10;
    }

    _eraseCurrentLine() {
        const el = this.termEl;
        while (el.childNodes.length) {
            const last = el.childNodes[el.childNodes.length - 1];
            if (last.nodeType === Node.TEXT_NODE) {
                const nlPos = last.textContent.lastIndexOf('\n');
                if (nlPos !== -1) {
                    last.textContent = last.textContent.substring(0, nlPos + 1);
                    return;
                }
            }
            el.removeChild(last);
        }
    }

    _fitTerminalFont(cols) {
        if (cols && cols > 0) this._termCols = cols;
        if (!this._termCols) {
            const text = this.termEl.textContent || '';
            const lines = text.split('\n');
            let maxLen = 0;
            for (const line of lines) {
                if (line.length > maxLen) maxLen = line.length;
            }
            if (maxLen > 40) this._termCols = maxLen;
            else this._termCols = 80;
        }
        const cs = getComputedStyle(this.termEl);
        const availW = this.termEl.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
        if (availW <= 0) return;

        const probe = document.createElement('span');
        probe.style.cssText = 'position:absolute;visibility:hidden;white-space:pre;font:' + this._baseFontSize + 'px/' + 1.45 + ' ' + cs.fontFamily;
        probe.textContent = 'M'.repeat(this._termCols);
        document.body.appendChild(probe);
        const lineW = probe.offsetWidth;
        document.body.removeChild(probe);

        if (lineW <= 0) return;
        const scale = availW / lineW;
        const fitted = Math.floor(this._baseFontSize * scale * 100) / 100;
        const clamped = Math.max(this._baseFontSize, fitted);
        this.termEl.style.fontSize = clamped + 'px';
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
        if (!text) return;
        const colour = level === 'error' ? '\x1b[91m' : (level === 'warn' ? '\x1b[93m' : '\x1b[92m');
        this._applyTerminalChunk({ data: `\r\n${colour}[${(level || 'info').toUpperCase()}] ${text}\x1b[0m\r\n` });
    }

    _showFatal(text) {
        document.getElementById('app').innerHTML = `
            <div style="padding:32px;text-align:center;color:var(--err);font-size:14px;letter-spacing:.18em;">
                <div style="font-size:18px;margin-bottom:14px;color:var(--fg);">SESSION REQUIRED</div>
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
    window._app = new App();
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js').catch(() => {});
        navigator.serviceWorker.addEventListener('controllerchange', () => {
            location.reload();
        });
    }
});
