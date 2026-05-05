/**
 * MobileBridge (renderer side)
 *
 * Owns the renderer<->main IPC for the mobile companion bridge:
 *
 *   1. Snapshots the current UI state (open tabs, active terminal output,
 *      core widget data) on a throttle and pushes it to the main process,
 *      which broadcasts it to mobile clients.
 *   2. Streams raw terminal output as it arrives so the mobile terminal
 *      view stays responsive.
 *   3. Receives input events from a paired mobile device and dispatches them
 *      into the existing renderer surfaces (terminal, tab switching, etc.).
 *
 * Designed to be cheap when no mobile clients are connected:
 *   - the snapshot timer only runs while clients > 0
 *   - terminal output is only forwarded after the bridge starts
 */

// NOTE on require() placement
// ----------------------------
// This file is loaded via a <script src> tag in ui.html. In Electron's
// renderer with nodeIntegration: true, top-level require() calls inside such
// <script>-loaded files can crash the renderer hard (silent black screen,
// no console output, app never boots). Every other <script>-loaded widget
// class in this project (clock, fileExplorer, gitCommits, …) follows the same
// rule: keep require() inside methods, never at module top-level. Do not
// hoist these requires outside the methods that use them.

const SNAPSHOT_THROTTLE_MS = 250;       // 4 fps is plenty for the snapshot view
const TERMINAL_BUFFER_BYTES = 16 * 1024; // last 16 KiB of terminal output for late joiners

class MobileBridge {
    constructor() {
        const electron = require('electron');
        this._ipc = electron.ipcRenderer;

        this.status = { running: false, clients: 0 };
        this._snapshotTimer = null;
        this._snapshotPending = false;
        this._lastSnapshotAt = 0;
        this._termBuffers = {};   // { [index]: string }  — ring buffer of recent output per tab
        this._termHooked = new Set();
        this._listeners = new Set();

        this._ipc.on('mobile:input', (_e, input) => this._handleInput(input || {}));
        this._ipc.on('mobile:clients-changed', (_e, payload) => {
            this.status.clients = (payload && payload.clients) || 0;
            this._notify();
            this._maybeStartLoop();
        });
        this._ipc.on('mobile:status-changed', (_e, status) => {
            this.status = Object.assign({}, this.status, status || {});
            this._notify();
            this._maybeStartLoop();
        });
    }

    /** Subscribe to status updates (used by the QR widget). */
    onStatus(fn) {
        this._listeners.add(fn);
        try { fn(this.status); } catch (_) {}
        return () => this._listeners.delete(fn);
    }

    _notify() {
        for (const fn of this._listeners) {
            try { fn(this.status); } catch (_) {}
        }
    }

    async refreshStatus() {
        const s = await this._ipc.invoke('mobile:status');
        if (s && s.ok) {
            this.status = Object.assign({}, this.status, s);
            this._notify();
        }
        return this.status;
    }

    async start({ withTunnel = true } = {}) {
        const s = await this._ipc.invoke('mobile:start', { withTunnel });
        if (s && s.ok) {
            this.status = Object.assign({}, this.status, s);
            this._hookTerminals();
            this._maybeStartLoop();
            this._pushSnapshot(); // immediate first snapshot so the UI sees data
        }
        this._notify();
        return s;
    }

    async stop() {
        const s = await this._ipc.invoke('mobile:stop');
        if (s && s.ok) {
            this.status = Object.assign({}, this.status, s, { running: false });
            this._stopLoop();
        }
        this._notify();
        return s;
    }

    /** Ask main to render a QR code; returns a data URL. */
    async getQrDataUrl(text, opts) {
        const r = await this._ipc.invoke('mobile:qr', { text, opts });
        return (r && r.ok && r.dataUrl) ? r.dataUrl : null;
    }

    notice(level, text) {
        this._ipc.send('mobile:push-notice', { level, text });
    }

    // ── snapshot loop ──────────────────────────────────────────────────
    _maybeStartLoop() {
        if (this.status.running && this.status.clients > 0) this._startLoop();
        else this._stopLoop();
    }

    _startLoop() {
        if (this._snapshotTimer) return;
        this._snapshotTimer = setInterval(() => this._pushSnapshot(), SNAPSHOT_THROTTLE_MS);
    }

    _stopLoop() {
        if (this._snapshotTimer) {
            clearInterval(this._snapshotTimer);
            this._snapshotTimer = null;
        }
    }

    /** Public: explicitly request a snapshot push (e.g. after a tab switch). */
    requestSnapshot() {
        if (!this.status.running) return;
        // coalesce — at most one extra push per frame
        if (this._snapshotPending) return;
        this._snapshotPending = true;
        Promise.resolve().then(() => {
            this._snapshotPending = false;
            this._pushSnapshot();
        });
    }

    _pushSnapshot() {
        if (!this.status.running) return;
        let snapshot;
        try { snapshot = this._buildSnapshot(); }
        catch (e) { return; }
        this._ipc.send('mobile:push-snapshot', snapshot);
        this._lastSnapshotAt = Date.now();
    }

    _buildSnapshot() {
        const w = window;
        const activeIndex = (typeof w.currentTerm === 'number') ? w.currentTerm : 0;

        const tabs = [];
        const names = w.terminalNames || {};
        const types = w.tabType || {};
        const terms = w.term || {};

        // Walk the DOM so tabs are emitted in the user's current on-screen
        // order, not numeric index order. This keeps mobile ↔ desktop in sync
        // after a reorder (drag on mobile moves the <li>; the next snapshot
        // reflects that new order).
        let orderedIndices = [];
        try {
            const tabEls = document.querySelectorAll('ul#main_shell_tabs > li[id^="shell_tab"]');
            tabEls.forEach(li => {
                const m = /^shell_tab(\d+)$/.exec(li.id);
                if (m) orderedIndices.push(parseInt(m[1], 10));
            });
        } catch (_) { /* fall back to numeric order below */ }

        if (!orderedIndices.length) {
            const maxTabs = Math.max(
                Object.keys(names).length,
                Object.keys(terms).length,
                5
            );
            for (let i = 0; i < maxTabs; i++) orderedIndices.push(i);
        }

        for (const i of orderedIndices) {
            const exists = !!terms[i] || (names[i] && names[i] !== 'EMPTY');
            if (!exists && !terms[i]) continue;
            let status = 'idle';
            try {
                const tabEl = document.querySelector(`#shell_tab${i}`);
                if (tabEl) status = tabEl.getAttribute('data-claude-status') || 'idle';
            } catch (_) {}
            tabs.push({
                index: i,
                name: names[i] || `TAB ${i + 1}`,
                type: types[i] || 'terminal',
                active: i === activeIndex,
                process: terms[i] && terms[i]._lastProcess ? terms[i]._lastProcess : null,
                status,
            });
        }

        // Pull a chunk of recent output from the active terminal for the snapshot.
        const recent = this._termBuffers[activeIndex] || '';

        // Serialize the actual screen content from xterm.js with ANSI color
        // codes so the mobile terminal view preserves colors.
        let screen = '';
        try {
            const t = terms[activeIndex] && terms[activeIndex].term;
            if (t && t.buffer && t.buffer.active) {
                const buf = t.buffer.active;
                const lines = [];
                for (let y = 0; y < buf.length; y++) {
                    const line = buf.getLine(y);
                    if (!line) { lines.push(''); continue; }
                    let lineStr = '';
                    let prevFg = -2, prevBg = -2, prevFgKind = 'x', prevBgKind = 'x';
                    let prevBold = false, prevItalic = false, prevUnder = false, prevDim = false;
                    for (let x = 0; x < line.length; x++) {
                        const cell = line.getCell(x);
                        if (!cell) continue;
                        const ch = cell.getChars();
                        const fg = cell.getFgColor();
                        const bg = cell.getBgColor();
                        const bold = !!(cell.isBold && cell.isBold());
                        const italic = !!(cell.isItalic && cell.isItalic());
                        const under = !!(cell.isUnderline && cell.isUnderline());
                        const dim = !!(cell.isDim && cell.isDim());

                        // Use xterm.js boolean helpers — reliable across versions.
                        let fgKind = 'd', bgKind = 'd'; // d=default, p=palette, r=rgb
                        if (cell.isFgRGB && cell.isFgRGB())      fgKind = 'r';
                        else if (cell.isFgPalette && cell.isFgPalette()) fgKind = 'p';
                        if (cell.isBgRGB && cell.isBgRGB())      bgKind = 'r';
                        else if (cell.isBgPalette && cell.isBgPalette()) bgKind = 'p';

                        if (fg !== prevFg || bg !== prevBg || fgKind !== prevFgKind || bgKind !== prevBgKind
                            || bold !== prevBold || italic !== prevItalic || under !== prevUnder || dim !== prevDim) {
                            const sgr = [0];
                            if (bold) sgr.push(1);
                            if (dim) sgr.push(2);
                            if (italic) sgr.push(3);
                            if (under) sgr.push(4);
                            if (fgKind === 'p' && fg >= 0 && fg < 256) {
                                sgr.push(38, 5, fg);
                            } else if (fgKind === 'r' && fg >= 0) {
                                sgr.push(38, 2, (fg >> 16) & 0xff, (fg >> 8) & 0xff, fg & 0xff);
                            }
                            if (bgKind === 'p' && bg >= 0 && bg < 256) {
                                sgr.push(48, 5, bg);
                            } else if (bgKind === 'r' && bg >= 0) {
                                sgr.push(48, 2, (bg >> 16) & 0xff, (bg >> 8) & 0xff, bg & 0xff);
                            }
                            lineStr += '\x1b[' + sgr.join(';') + 'm';
                            prevFg = fg; prevBg = bg; prevFgKind = fgKind; prevBgKind = bgKind;
                            prevBold = bold; prevItalic = italic; prevUnder = under; prevDim = dim;
                        }
                        lineStr += ch || ' ';
                    }
                    lineStr += '\x1b[0m';
                    lines.push(lineStr);
                }
                screen = lines.join('\n');
            }
        } catch (_) {}

        const widgets = this._collectWidgetData();

        return {
            ts: Date.now(),
            host: this._getHostInfo(),
            activeTab: activeIndex,
            tabs,
            terminal: {
                index: activeIndex,
                recent,
                screen,
                cols: terms[activeIndex] && terms[activeIndex].term ? terms[activeIndex].term.cols : 80,
                rows: terms[activeIndex] && terms[activeIndex].term ? terms[activeIndex].term.rows : 24,
            },
            widgets,
        };
    }

    _getHostInfo() {
        try {
            const remote = require('@electron/remote');
            const os = require('os');
            return {
                name: os.hostname(),
                platform: process.platform,
                appVersion: remote.app.getVersion(),
            };
        } catch (_) {
            return { name: 'son-of-anton', platform: process.platform };
        }
    }

    _collectWidgetData() {
        const w = window;
        const data = {};
        try {
            if (w.mods && w.mods.clock) {
                data.clock = { time: new Date().toISOString() };
            }
            if (w.mods && w.mods.cpuinfo && w.mods.cpuinfo._lastUsage != null) {
                data.cpu = { usagePct: w.mods.cpuinfo._lastUsage };
            }
            if (w.mods && w.mods.ramwatcher && w.mods.ramwatcher._lastUsage != null) {
                data.ram = { usagePct: w.mods.ramwatcher._lastUsage };
            }
            if (w.mods && w.mods.netstat && w.mods.netstat._last) {
                data.net = w.mods.netstat._last;
            }
        } catch (_) { /* widgets are best-effort */ }
        return data;
    }

    // ── terminal output streaming ─────────────────────────────────────
    _hookTerminals() {
        const terms = window.term || {};
        Object.keys(terms).forEach(idx => this._hookOneTerminal(parseInt(idx, 10)));

        // Also re-hook periodically for tabs created later. Lightweight.
        if (!this._hookInterval) {
            this._hookInterval = setInterval(() => {
                const t = window.term || {};
                Object.keys(t).forEach(idx => this._hookOneTerminal(parseInt(idx, 10)));
            }, 2000);
            if (this._hookInterval.unref) this._hookInterval.unref();
        }
    }

    _hookOneTerminal(index) {
        if (this._termHooked.has(index)) return;
        const t = window.term && window.term[index];
        if (!t || !t.term || typeof t.term.onData !== 'function') return;
        // xterm.js exposes onRender / onData / parser hooks; we want what it *renders*.
        // The simplest reliable signal is `term.onWriteParsed` if available, otherwise
        // we wrap term.write.
        if (typeof t.term.onWriteParsed === 'function') {
            t.term.onWriteParsed(chunk => this._captureTerminalChunk(index, chunk));
        } else if (typeof t.term.write === 'function') {
            const orig = t.term.write.bind(t.term);
            t.term.write = (data, cb) => {
                this._captureTerminalChunk(index, data);
                return orig(data, cb);
            };
        }
        this._termHooked.add(index);
    }

    _captureTerminalChunk(index, chunk) {
        if (chunk == null) return;
        const text = (typeof chunk === 'string') ? chunk : (chunk.toString ? chunk.toString() : '');
        if (!text) return;
        // Maintain ring buffer
        const prev = this._termBuffers[index] || '';
        let next = prev + text;
        if (next.length > TERMINAL_BUFFER_BYTES) {
            next = next.slice(next.length - TERMINAL_BUFFER_BYTES);
        }
        this._termBuffers[index] = next;
        // Stream to mobile if anyone is listening
        if (this.status.running && this.status.clients > 0) {
            this._ipc.send('mobile:push-term-data', { index, data: text });
        }
    }

    // ── inbound: mobile → desktop input ───────────────────────────────
    _handleInput(input) {
        const kind = input && input.kind;
        if (!kind) return;
        const w = window;
        const activeIndex = (typeof w.currentTerm === 'number') ? w.currentTerm : 0;
        const term = w.term && w.term[activeIndex];

        switch (kind) {
            case 'term-keys': {
                const text = String(input.text || '');
                if (!text) return;
                if (term && term.socket && term.socket.readyState === 1) {
                    try { term.socket.send(text); } catch (_) {}
                } else if (term && term.term) {
                    try { term.term.input ? term.term.input(text) : term.term.write(text); } catch (_) {}
                }
                break;
            }
            case 'shell-command': {
                const line = String(input.line || '');
                if (!line) return;
                if (term && term.socket && term.socket.readyState === 1) {
                    try { term.socket.send(line + '\n'); } catch (_) {}
                }
                break;
            }
            case 'switch-tab': {
                const i = parseInt(input.index, 10);
                if (Number.isFinite(i) && typeof w.focusShellTab === 'function') {
                    try { w.focusShellTab(i); } catch (_) {}
                    this.requestSnapshot();
                }
                break;
            }
            case 'new-tab': {
                if (typeof w.addShellTab === 'function') {
                    try { w.addShellTab(); } catch (_) {}
                    this.requestSnapshot();
                }
                break;
            }
            case 'close-tab': {
                const i = parseInt(input.index, 10);
                if (Number.isFinite(i) && typeof w.closeShellTab === 'function') {
                    try { w.closeShellTab(i); } catch (_) {}
                    this.requestSnapshot();
                }
                break;
            }
            case 'move-tab': {
                const i = parseInt(input.index, 10);
                // `before` is the index of the tab that `i` should end up
                // immediately before, or -1 to append at the end of the strip.
                const before = (input.before === -1 || input.before === undefined)
                    ? -1
                    : parseInt(input.before, 10);
                if (!Number.isFinite(i)) break;
                try {
                    const list = document.getElementById('main_shell_tabs');
                    if (!list) break;
                    const src = document.getElementById('shell_tab' + i);
                    if (!src) break;
                    if (before === i) break;
                    if (before === -1) {
                        // Append before the + button (or any trailing add/browser
                        // buttons) so the dragged tab lands at the end of the
                        // terminal-tab run.
                        const addBtn = document.getElementById('shell_add_tab');
                        if (addBtn) list.insertBefore(src, addBtn);
                        else list.appendChild(src);
                    } else {
                        const ref = document.getElementById('shell_tab' + before);
                        if (!ref) break;
                        list.insertBefore(src, ref);
                    }
                    this.requestSnapshot();
                } catch (_) {}
                break;
            }
            case 'rename-tab': {
                const i = parseInt(input.index, 10);
                const name = String(input.name || '').trim().substring(0, 20);
                if (Number.isFinite(i) && name && w.terminalNames) {
                    w.terminalNames[i] = name;
                    if (typeof w.saveTerminalNames === 'function') {
                        try { w.saveTerminalNames(); } catch (_) {}
                    }
                    const tabEl = document.querySelector(`#shell_tab${i} p`);
                    if (tabEl) {
                        try {
                            const escFn = w._escapeHtml || (s => s);
                            const closeBtn = w._tabCloseBtn ? w._tabCloseBtn(i) : '';
                            tabEl.innerHTML = escFn(name) + closeBtn;
                        } catch (_) {}
                    }
                    this.requestSnapshot();
                }
                break;
            }
            case 'hotkey': {
                this._sendHotkey(String(input.combo || ''));
                break;
            }
            case 'voice-toggle': {
                if (typeof w.toggleMic === 'function') {
                    try { w.toggleMic(); } catch (_) {}
                }
                break;
            }
            default:
                /* ignore */
                break;
        }
    }

    _sendHotkey(combo) {
        // Translate a small set of common combos into the right control bytes
        // and forward to the active terminal. Anything more elaborate can be
        // added as the mobile UI grows.
        const map = {
            'ctrl+c':  '\x03',
            'ctrl+d':  '\x04',
            'ctrl+l':  '\x0c',
            'ctrl+u':  '\x15',
            'ctrl+w':  '\x17',
            'ctrl+r':  '\x12',
            'ctrl+a':  '\x01',
            'ctrl+e':  '\x05',
            'ctrl+z':  '\x1a',
            'esc':     '\x1b',
            'tab':     '\t',
            'enter':   '\r',
            'up':      '\x1b[A',
            'down':    '\x1b[B',
            'right':   '\x1b[C',
            'left':    '\x1b[D',
        };
        const bytes = map[combo.toLowerCase()];
        if (!bytes) return;
        const w = window;
        const activeIndex = (typeof w.currentTerm === 'number') ? w.currentTerm : 0;
        const term = w.term && w.term[activeIndex];
        if (term && term.socket && term.socket.readyState === 1) {
            try { term.socket.send(bytes); } catch (_) {}
        }
    }
}

module.exports = { MobileBridge };
