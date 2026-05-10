class ConsoleLogWidget {
    constructor(parentId) {
        if (!parentId) throw "Missing parameters";

        this.MAX_ENTRIES = 200;
        this._entries = [];
        this._paused = false;

        const parent = document.getElementById(parentId);
        const wrapper = document.createElement("div");
        wrapper.id = "mod_consoleLog";
        wrapper.innerHTML = `
            <div id="mod_consoleLog_inner">
                <h1>CONSOLE LOG
                    <span class="cl-controls">
                        <span id="cl-clear" title="Clear">CLR</span>
                        <span id="cl-pause" title="Pause/Resume">&#9646;&#9646;</span>
                    </span>
                </h1>
                <div id="mod_consoleLog_content"></div>
            </div>`;
        parent.appendChild(wrapper);

        this._content = document.getElementById("mod_consoleLog_content");
        this._pauseBtn = document.getElementById("cl-pause");

        document.getElementById("cl-clear").addEventListener("click", () => {
            this._entries = [];
            this._content.innerHTML = '';
        });
        this._pauseBtn.addEventListener("click", () => {
            this._paused = !this._paused;
            this._pauseBtn.classList.toggle("cl-paused", this._paused);
        });

        this._intercept();
    }

    _intercept() {
        const levels = ['log', 'info', 'warn', 'error', 'debug'];
        const fmt = (arg) => {
            if (arg instanceof Error) return arg.stack || `${arg.name}: ${arg.message}`;
            if (typeof arg === 'string') return arg;
            try { return JSON.stringify(arg); } catch (_) { return String(arg); }
        };

        levels.forEach(level => {
            const original = console[level].bind(console);
            console[level] = (...args) => {
                original(...args);
                if (!this._paused) this._push(level, args.map(fmt).join(' '));
            };
        });
    }

    _push(level, text) {
        const ts = new Date().toTimeString().slice(0, 8);
        this._entries.push({ level, text, ts });
        if (this._entries.length > this.MAX_ENTRIES) this._entries.shift();

        const row = document.createElement("div");
        row.className = `cl-row cl-${level}`;
        row.innerHTML = `<span class="cl-ts">${ts}</span><span class="cl-text">${this._esc(text)}</span>`;
        this._content.appendChild(row);

        // trim DOM to MAX_ENTRIES
        while (this._content.children.length > this.MAX_ENTRIES) {
            this._content.removeChild(this._content.firstChild);
        }

        // auto-scroll unless user has scrolled up
        const el = this._content;
        const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        if (atBottom) el.scrollTop = el.scrollHeight;
    }

    _esc(text) {
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { ConsoleLogWidget };
}
