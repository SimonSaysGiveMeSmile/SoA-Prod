class TextEditor {
    constructor() {
        if (document.getElementById("texteditor_overlay")) {
            // Already open, focus it
            document.getElementById("texteditor_textarea").focus();
            return;
        }

        // Detach on-screen keyboard so it doesn't intercept input
        if (window.keyboard) window.keyboard.detach();

        this._buildDOM();
        this._bindEvents();

        // Focus the textarea
        setTimeout(() => {
            this.textarea.focus();
        }, 50);
    }

    _buildDOM() {
        this.overlay = document.createElement("div");
        this.overlay.id = "texteditor_overlay";

        this.container = document.createElement("div");
        this.container.id = "texteditor_container";
        this.container.setAttribute("augmented-ui", "tl-clip br-clip exe");

        // Header
        const header = document.createElement("div");
        header.id = "texteditor_header";
        header.innerHTML = `<span class="texteditor_title">TEXT EDITOR</span>
            <span class="texteditor_hint">Enter to send | Escape to cancel</span>`;

        // Textarea
        this.textarea = document.createElement("textarea");
        this.textarea.id = "texteditor_textarea";
        this.textarea.setAttribute("spellcheck", "false");
        this.textarea.setAttribute("autocomplete", "off");
        this.textarea.setAttribute("autocorrect", "off");
        this.textarea.setAttribute("autocapitalize", "off");
        this.textarea.placeholder = "Type or paste your text here...\nFull cursor movement, selection, and editing supported.";

        // Footer with buttons
        const footer = document.createElement("div");
        footer.id = "texteditor_footer";

        const sendBtn = document.createElement("button");
        sendBtn.id = "texteditor_send";
        sendBtn.textContent = "SEND";
        sendBtn.onclick = () => this._send();

        const sendLineBtn = document.createElement("button");
        sendLineBtn.id = "texteditor_sendline";
        sendLineBtn.textContent = "SEND + ENTER";
        sendLineBtn.onclick = () => this._send(true);

        const cancelBtn = document.createElement("button");
        cancelBtn.id = "texteditor_cancel";
        cancelBtn.textContent = "CANCEL";
        cancelBtn.onclick = () => this.close();

        footer.appendChild(cancelBtn);
        footer.appendChild(sendBtn);
        footer.appendChild(sendLineBtn);

        this.container.appendChild(header);
        this.container.appendChild(this.textarea);
        this.container.appendChild(footer);
        this.overlay.appendChild(this.container);
        document.body.appendChild(this.overlay);
    }

    _bindEvents() {
        this._keyHandler = (e) => {
            // Shift+Enter = send with newline
            if (e.key === "Enter") {
                e.preventDefault();
                this._send(true);
                return;
            }
            // Escape = close
            if (e.key === "Escape") {
                e.preventDefault();
                this.close();
                return;
            }
            // Stop propagation so xterm/keyboard don't intercept
            e.stopPropagation();
        };

        this.textarea.addEventListener("keydown", this._keyHandler);

        // Prevent clicks on overlay from reaching terminal
        this.overlay.addEventListener("mousedown", (e) => {
            if (e.target === this.overlay) {
                this.close();
            }
        });
    }

    _send(withEnter = false) {
        const text = this.textarea.value;
        if (!text) {
            this.close();
            return;
        }

        const term = window.term[window.currentTerm];
        if (!term) {
            this.close();
            return;
        }

        // Send the text to the terminal
        term.write(text);
        if (withEnter) {
            term.write("\r");
        }

        if (window.audioManager) {
            window.audioManager.granted.play();
        }

        this.close();
    }

    close() {
        if (this.overlay && this.overlay.parentNode) {
            this.overlay.setAttribute("class", "closing");
            setTimeout(() => {
                if (this.overlay.parentNode) {
                    this.overlay.parentNode.removeChild(this.overlay);
                }
            }, 150);
        }

        // Re-attach keyboard and focus terminal
        if (window.keyboard) window.keyboard.attach();
        if (window.term[window.currentTerm]) {
            window.term[window.currentTerm].term.focus();
        }

        if (window.audioManager) {
            window.audioManager.denied.play();
        }
    }
}

module.exports = { TextEditor };
