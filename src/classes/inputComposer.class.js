class InputComposer {
    constructor(opts = {}) {
        // Singleton guard — if already open, just focus it
        if (document.getElementById("inputcomposer_bar")) {
            document.getElementById("inputcomposer_textarea").focus();
            return;
        }

        // Detach on-screen keyboard so it doesn't intercept input
        if (window.keyboard) window.keyboard.detach();

        this._autoActivated = !!opts.autoActivated;
        this._existingLineText = "";
        this._cursorRow = -1;
        this._cellHeight = 0;

        // Read terminal line state before building DOM
        if (this._autoActivated) {
            this._readTerminalLine();
        }

        this._buildDOM();
        this._bindEvents();

        // Pre-populate with existing line + intercepted char
        if (this._autoActivated) {
            const char = window._interceptedChar || "";
            this.textarea.value = this._existingLineText + char;
            window._interceptedChar = null;
            window._interceptedTermInstance = null;
            // Move cursor to end
            const len = this.textarea.value.length;
            this.textarea.selectionStart = len;
            this.textarea.selectionEnd = len;
        }

        setTimeout(() => {
            this.textarea.focus();
        }, 50);
    }

    _readTerminalLine() {
        const termWrapper = window._interceptedTermInstance
            || (window.term && window.term[window.currentTerm]);
        if (!termWrapper || !termWrapper.term) return;

        const term = termWrapper.term;
        const buffer = term.buffer.active;

        // Cursor row for inline positioning
        this._cursorRow = buffer.cursorY;

        // Cell height for pixel positioning
        try {
            this._cellHeight = term._core._renderService.dimensions.css.cell.height;
        } catch (e) {
            this._cellHeight = 0;
        }

        // Read current line text
        const line = buffer.getLine(buffer.baseY + buffer.cursorY);
        if (line) {
            const lineText = line.translateToString(true);
            // Extract user input after prompt (heuristic: match common prompt endings)
            const match = lineText.match(/^(.*?[\$>#%]\s?)(.*)/);
            this._existingLineText = match ? match[2] : lineText;
        }
    }

    _buildDOM() {
        const container = document.getElementById("main_shell_innercontainer");
        if (!container) return;

        const fontSize = (window.theme && window.theme.terminal && window.theme.terminal.fontSize)
            || (window.settings && window.settings.termFontSize)
            || 15;

        this.bar = document.createElement("div");
        this.bar.id = "inputcomposer_bar";

        // Inline positioning for auto-activated mode
        if (this._autoActivated && this._cursorRow >= 0 && this._cellHeight > 0) {
            this.bar.classList.add("inputcomposer-inline");
            const topPx = this._cursorRow * this._cellHeight;
            this.bar.style.top = topPx + "px";
            this.bar.style.bottom = "0";
            // Max height = remaining space from cursor to container bottom
            this._maxHeight = container.clientHeight - topPx - 20;
        } else {
            // Bottom-docked mode (manual Ctrl+Space)
            this._maxHeight = container.clientHeight * 0.4;
        }

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
        hints.textContent = "Shift+Enter: send | Tab: complete | Esc: close";

        this.bar.appendChild(hints);
        this.bar.appendChild(prompt);
        this.bar.appendChild(this.textarea);
        container.appendChild(this.bar);
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

            // --- Shift+Enter: send text + execute ---
            if (e.key === "Enter" && e.shiftKey) {
                e.preventDefault();
                this._sendAndExecute();
                return;
            }

            // --- Enter: insert newline (default textarea behavior, just stop propagation) ---
            if (e.key === "Enter" && !e.shiftKey) {
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
                    e.stopPropagation();
                    return;
                }
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

    _clearExistingInput(term) {
        // Ctrl+E (end of line) + Ctrl+U (kill to start) — clears readline input
        term.write("\x05\x15");
    }

    _sendAndExecute() {
        const text = this.textarea.value;
        const term = this._getTerminal();
        if (!text || !term) {
            this.close();
            return;
        }
        if (this._autoActivated) {
            this._clearExistingInput(term);
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
        if (this._autoActivated) {
            this._clearExistingInput(term);
        }
        if (text) {
            term.write(text);
        }
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
            if (bar.parentNode) bar.parentNode.removeChild(bar);
            if (window.keyboard) window.keyboard.attach();
        }
    }
}

module.exports = { InputComposer };
