class InputComposer {
    constructor() {
        // Singleton guard — if already open, just focus it
        if (document.getElementById("inputcomposer_bar")) {
            document.getElementById("inputcomposer_textarea").focus();
            return;
        }

        // Detach on-screen keyboard so it doesn't intercept input
        if (window.keyboard) window.keyboard.detach();

        this._buildDOM();
        this._bindEvents();

        setTimeout(() => {
            this.textarea.focus();
        }, 50);
    }

    _buildDOM() {
        const container = document.getElementById("main_shell_innercontainer");
        if (!container) return;

        // Resolve font size from terminal theme/settings
        const fontSize = (window.theme && window.theme.terminal && window.theme.terminal.fontSize)
            || (window.settings && window.settings.termFontSize)
            || 15;

        this.bar = document.createElement("div");
        this.bar.id = "inputcomposer_bar";

        // Prompt chevron
        const prompt = document.createElement("div");
        prompt.className = "inputcomposer-prompt";
        prompt.textContent = ">";

        // Textarea
        this.textarea = document.createElement("textarea");
        this.textarea.id = "inputcomposer_textarea";
        this.textarea.setAttribute("spellcheck", "false");
        this.textarea.setAttribute("autocomplete", "off");
        this.textarea.setAttribute("autocorrect", "off");
        this.textarea.setAttribute("autocapitalize", "off");
        this.textarea.setAttribute("rows", "1");
        this.textarea.placeholder = "Type here...";
        this.textarea.style.fontSize = fontSize + "px";

        // Hints strip
        const hints = document.createElement("div");
        hints.className = "inputcomposer-hints";
        hints.textContent = "Enter: send | Shift+Enter: newline | Tab: complete | Esc: close";

        this.bar.appendChild(hints);
        this.bar.appendChild(prompt);
        this.bar.appendChild(this.textarea);
        container.appendChild(this.bar);

        // Store max height for auto-expand (40% of container)
        this._maxHeight = container.clientHeight * 0.4;
    }

    _bindEvents() {
        // Auto-expand textarea as content grows
        this._inputHandler = () => {
            this.textarea.style.height = "auto";
            const scrollH = this.textarea.scrollHeight;
            this.textarea.style.height = Math.min(scrollH, this._maxHeight) + "px";
        };
        this.textarea.addEventListener("input", this._inputHandler);

        this._keyHandler = (e) => {
            const text = this.textarea.value;
            const atStart = this.textarea.selectionStart === 0 && this.textarea.selectionEnd === 0;
            const atEnd = this.textarea.selectionStart === text.length && this.textarea.selectionEnd === text.length;

            // --- Enter: send text + execute ---
            if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
                e.preventDefault();
                this._sendAndExecute();
                return;
            }

            // --- Shift+Enter: insert newline (default behavior, just stop propagation) ---
            if (e.key === "Enter" && e.shiftKey) {
                e.stopPropagation();
                return;
            }

            // --- Escape: close ---
            if (e.key === "Escape") {
                e.preventDefault();
                this.close();
                return;
            }

            // --- Tab: flush text to terminal + send Tab for completion, close ---
            if (e.key === "Tab" && !e.shiftKey && !e.ctrlKey) {
                e.preventDefault();
                this._flushAndTab();
                return;
            }

            // --- Ctrl+C ---
            if (e.key === "c" && (e.ctrlKey || e.metaKey)) {
                const hasSelection = this.textarea.selectionStart !== this.textarea.selectionEnd;
                if (hasSelection) {
                    // Let native copy happen
                    e.stopPropagation();
                    return;
                }
                // Empty or no selection: send interrupt
                e.preventDefault();
                this._sendInterrupt();
                return;
            }

            // --- Up arrow at position 0: shell history up ---
            if (e.key === "ArrowUp" && atStart) {
                e.preventDefault();
                this._sendEscapeSequence("\x1b[A");
                return;
            }

            // --- Down arrow at end: shell history down ---
            if (e.key === "ArrowDown" && atEnd) {
                e.preventDefault();
                this._sendEscapeSequence("\x1b[B");
                return;
            }

            // Stop propagation so xterm/keyboard don't intercept
            e.stopPropagation();
        };

        this.textarea.addEventListener("keydown", this._keyHandler);
    }

    _getTerminal() {
        return window.term && window.term[window.currentTerm];
    }

    _sendAndExecute() {
        const text = this.textarea.value;
        const term = this._getTerminal();
        if (!text || !term) {
            this.close();
            return;
        }
        term.write(text);
        term.write("\r");
        if (window.audioManager) window.audioManager.granted.play();
        this.close();
    }

    _flushAndTab() {
        const text = this.textarea.value;
        const term = this._getTerminal();
        if (!term) {
            this.close();
            return;
        }
        if (text) {
            term.write(text);
        }
        // Send Tab character for shell completion
        term.write("\t");
        this.close();
    }

    _sendInterrupt() {
        const term = this._getTerminal();
        if (term) {
            term.write("\x03");
        }
        this.close();
    }

    _sendEscapeSequence(seq) {
        const term = this._getTerminal();
        if (term) {
            term.write(seq);
        }
        this.close();
    }

    close() {
        if (!this.bar || !this.bar.parentNode) return;

        this.bar.classList.add("closing");
        setTimeout(() => {
            if (this.bar && this.bar.parentNode) {
                this.bar.parentNode.removeChild(this.bar);
            }
        }, 150);

        // Re-attach keyboard and focus terminal
        if (window.keyboard) window.keyboard.attach();
        const term = this._getTerminal();
        if (term) {
            term.term.focus();
        }
    }

    static isOpen() {
        return !!document.getElementById("inputcomposer_bar");
    }

    static closeIfOpen() {
        const bar = document.getElementById("inputcomposer_bar");
        if (bar) {
            // Quick removal without animation for cleanup scenarios
            if (bar.parentNode) bar.parentNode.removeChild(bar);
            if (window.keyboard) window.keyboard.attach();
        }
    }
}

module.exports = { InputComposer };
