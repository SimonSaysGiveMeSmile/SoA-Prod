/**
 * VirtualKeyboard — OS-native input with a slim modifier strip.
 *
 * Instead of rendering a full soft keyboard, we use a hidden <input> that
 * triggers the device's native keyboard on focus. A compact modifier row
 * provides terminal-specific keys (Esc, Tab, Ctrl, arrows, etc.) that
 * aren't available on a standard mobile keyboard.
 */

const MOD_KEYS = [
    { label: 'esc',   kind: 'hotkey', combo: 'esc' },
    { label: 'tab',   kind: 'hotkey', combo: 'tab' },
    { label: 'ctrl',  kind: 'sticky-ctrl' },
    { label: '⌫',     kind: 'special', text: '\x7f' },
    { label: '◀',     kind: 'hotkey', combo: 'left',  css: 'k-arrow' },
    { label: '▼',     kind: 'hotkey', combo: 'down',  css: 'k-arrow' },
    { label: '▲',     kind: 'hotkey', combo: 'up',    css: 'k-arrow' },
    { label: '▶',     kind: 'hotkey', combo: 'right', css: 'k-arrow' },
    { label: '↵',     kind: 'hotkey', combo: 'enter', css: 'k-enter' },
];

export class VirtualKeyboard {
    constructor(rootEl, { onInput }) {
        this.root = rootEl;
        this.onInput = onInput;
        this.ctrl = false;

        this._render();
    }

    _render() {
        this.root.innerHTML = '';
        this.root.className = 'kbd-strip';

        // Hidden input to capture OS keyboard
        this.input = document.createElement('input');
        this.input.type = 'text';
        this.input.className = 'kbd-hidden-input';
        this.input.autocomplete = 'off';
        this.input.autocapitalize = 'none';
        this.input.autocorrect = 'off';
        this.input.spellcheck = false;
        this.input.setAttribute('enterkeyhint', 'send');
        this.root.appendChild(this.input);

        this.input.addEventListener('input', (e) => {
            const text = e.data;
            if (text) {
                if (this.ctrl) {
                    const lower = text.toLowerCase();
                    if (lower.length === 1 && lower >= 'a' && lower <= 'z') {
                        this.onInput('term-keys', { text: String.fromCharCode(lower.charCodeAt(0) - 96) });
                    } else {
                        this.onInput('term-keys', { text });
                    }
                    this._setCtrl(false);
                } else {
                    this.onInput('term-keys', { text });
                }
            }
            // Clear input so next character fires a fresh event
            this.input.value = '';
        });

        this.input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                this.onInput('hotkey', { combo: 'enter' });
            } else if (e.key === 'Backspace') {
                e.preventDefault();
                this.onInput('term-keys', { text: '\x7f' });
            }
        });

        // Modifier strip
        const strip = document.createElement('div');
        strip.className = 'kbd-mods';
        for (const m of MOD_KEYS) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'k k-mod';
            if (m.css) btn.classList.add(m.css);
            btn.textContent = m.label;
            btn.addEventListener('pointerdown', (e) => {
                e.preventDefault();
                this._handleMod(m, btn);
            });
            strip.appendChild(btn);
        }
        this.root.appendChild(strip);
    }

    _handleMod(m, el) {
        el.classList.add('pressed');
        setTimeout(() => el.classList.remove('pressed'), 80);
        switch (m.kind) {
            case 'sticky-ctrl':
                this._setCtrl(!this.ctrl);
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

    _setCtrl(on) {
        this.ctrl = on;
        this.root.querySelectorAll('.k.k-mod').forEach(b => {
            if (b.textContent === 'ctrl') b.classList.toggle('active', on);
        });
    }

    focus() {
        if (this.input) this.input.focus();
    }

    blur() {
        if (this.input) this.input.blur();
    }

    show() { this.root.classList.remove('hidden'); }
    hide() { this.root.classList.add('hidden'); }
}
