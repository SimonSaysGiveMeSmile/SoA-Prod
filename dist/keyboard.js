/**
 * VirtualKeyboard
 *
 * Compact terminal-oriented soft keyboard for the mobile companion. Three rows
 * of letters/digits/punctuation plus a strip of common terminal modifiers
 * (Esc, Tab, Ctrl-prefixed combos, arrow keys, Enter).
 *
 * Sends keystrokes back to the desktop via the supplied `onInput` callback,
 * which is wired to `BridgeSocket.sendInput`.
 */

const ROWS = [
    ['1','2','3','4','5','6','7','8','9','0'],
    ['q','w','e','r','t','y','u','i','o','p'],
    ['a','s','d','f','g','h','j','k','l',':'],
    ['z','x','c','v','b','n','m','-','/','='],
    ['~','`','#','*','&','|','>','<','"',"'"],
];

// Modifier row
const MOD_ROW = [
    { label: 'esc',   kind: 'hotkey', combo: 'esc',   wide: 1 },
    { label: 'tab',   kind: 'hotkey', combo: 'tab',   wide: 1 },
    { label: 'ctrl',  kind: 'sticky-ctrl',            wide: 1 },
    { label: '⌫',     kind: 'special', text: '\x7f',  wide: 1 },
    { label: '◀',     kind: 'hotkey', combo: 'left',  wide: 1, css: 'k-arrow' },
    { label: '▼',     kind: 'hotkey', combo: 'down',  wide: 1, css: 'k-arrow' },
    { label: '▲',     kind: 'hotkey', combo: 'up',    wide: 1, css: 'k-arrow' },
    { label: '▶',     kind: 'hotkey', combo: 'right', wide: 1, css: 'k-arrow' },
    { label: 'space', kind: 'special', text: ' ',     wide: 1, css: 'k-mod' },
    { label: '↵',     kind: 'hotkey', combo: 'enter', wide: 1, css: 'k-row-end' },
];

export class VirtualKeyboard {
    constructor(rootEl, { onInput }) {
        this.root = rootEl;
        this.onInput = onInput;
        this.ctrl = false;
        this.shift = false;

        this._render();
    }

    _render() {
        this.root.innerHTML = '';
        // Letter / digit rows
        for (const row of ROWS) {
            for (const ch of row) {
                this.root.appendChild(this._makeKey(ch));
            }
        }
        // Modifier row
        for (const m of MOD_ROW) {
            const k = document.createElement('button');
            k.type = 'button';
            k.className = 'k k-mod';
            if (m.css) k.classList.add(m.css);
            k.textContent = m.label;
            k.addEventListener('pointerdown', e => {
                e.preventDefault();
                this._handleMod(m, k);
            });
            this.root.appendChild(k);
        }
    }

    _makeKey(ch) {
        const k = document.createElement('button');
        k.type = 'button';
        k.className = 'k';
        k.textContent = ch;
        k.addEventListener('pointerdown', e => {
            e.preventDefault();
            this._press(ch, k);
        });
        return k;
    }

    _press(ch, el) {
        el.classList.add('pressed');
        setTimeout(() => el.classList.remove('pressed'), 80);
        if (this.ctrl) {
            // Ctrl+letter → 0x01-0x1a
            const lower = ch.toLowerCase();
            if (lower.length === 1 && lower >= 'a' && lower <= 'z') {
                const code = lower.charCodeAt(0) - 96;
                this.onInput('term-keys', { text: String.fromCharCode(code) });
            } else {
                this.onInput('term-keys', { text: ch });
            }
            this._setCtrl(false);
            return;
        }
        const out = this.shift ? ch.toUpperCase() : ch;
        this.onInput('term-keys', { text: out });
    }

    _handleMod(m, el) {
        el.classList.add('pressed');
        setTimeout(() => el.classList.remove('pressed'), 80);
        switch (m.kind) {
            case 'sticky-ctrl':
                this._setCtrl(!this.ctrl, el);
                break;
            case 'hotkey':
                if (this.ctrl && m.combo && /^[a-z]$/.test(m.combo)) {
                    this.onInput('hotkey', { combo: `ctrl+${m.combo}` });
                    this._setCtrl(false);
                } else {
                    this.onInput('hotkey', { combo: m.combo });
                }
                break;
            case 'special':
                this.onInput('term-keys', { text: m.text });
                break;
        }
    }

    _setCtrl(on, el) {
        this.ctrl = on;
        // Find the ctrl button and toggle highlight
        const buttons = this.root.querySelectorAll('.k.k-mod');
        buttons.forEach(b => {
            if (b.textContent === 'ctrl') {
                b.classList.toggle('active', on);
            }
        });
    }

    show() { this.root.classList.remove('hidden'); }
    hide() { this.root.classList.add('hidden'); }
}
