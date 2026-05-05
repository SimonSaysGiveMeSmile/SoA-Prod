/**
 * PortUsageWidget - Displays port/folder/status for each terminal tab
 *
 * Replaces the old TodoWidget. Polls window.term every 2s and
 * listens for tab-switch / cwd-change events for immediate updates.
 */
class TodoWidget {
    constructor(parentId) {
        if (!parentId) throw "Missing parameters";

        this.parent = document.getElementById(parentId);
        let wrapper = document.createElement("div");
        wrapper.setAttribute("id", "mod_todoWidget");
        wrapper.innerHTML = `<div id="mod_todoWidget_innercontainer">
                <h1>PORT USAGE<span class="mod_todoWidget_count"></span></h1>
                <div id="mod_todoWidget_content">
                    <div class="todo-empty">SCANNING...</div>
                </div>
            </div>`;
        this.parent.appendChild(wrapper);

        this.containerEl = document.getElementById("mod_todoWidget");
        this.contentEl = document.getElementById("mod_todoWidget_content");
        this.countEl = this.containerEl.querySelector(".mod_todoWidget_count");

        // Shell process names → considered "idle"
        this._shells = new Set([
            "bash", "zsh", "fish", "sh", "dash", "ksh", "csh", "tcsh",
            "powershell", "pwsh", "cmd", "cmd.exe",
            "login", "-bash", "-zsh", "-fish", "-sh"
        ]);

        this._refresh = this._refresh.bind(this);

        // Immediate first render
        setTimeout(this._refresh, 500);

        // Poll every 2 seconds
        this._interval = setInterval(this._refresh, 2000);

        // Also refresh on tab switch and cwd change
        window.addEventListener('terminal-cwd-changed', this._refresh);
    }

    _refresh() {
        if (!window.term) {
            this.contentEl.innerHTML = '<div class="todo-empty">NO TERMINALS</div>';
            this.countEl.textContent = '';
            return;
        }

        const indices = Object.keys(window.term)
            .map(Number)
            .filter(i => window.term[i] && typeof window.term[i] === 'object')
            .sort((a, b) => a - b);

        if (indices.length === 0) {
            this.contentEl.innerHTML = '<div class="todo-empty">NO TERMINALS</div>';
            this.countEl.textContent = '';
            return;
        }

        this.countEl.textContent = ` (${indices.length})`;

        const activeTerm = window.currentTerm;
        let html = '';

        indices.forEach(idx => {
            const t = window.term[idx];
            const port = t.port || '?';
            const rawCwd = t.cwd || '';
            const cwd = this._shortenPath(rawCwd.replace(/^FALLBACK \|-- /, ''));
            const proc = t._lastProcess || '';
            const isActive = activeTerm === idx;
            const status = this._getStatus(proc);
            const tabName = this._getTabName(idx);

            html += `<div class="pu-row${isActive ? ' pu-active' : ''}" data-tab="${idx}">`;
            html += `<div class="pu-header">`;
            html += `<span class="pu-tab">${this._esc(tabName)}</span>`;
            html += `<span class="pu-port">:${port}</span>`;
            html += `<span class="pu-status-dot ${status.cls}" title="${status.label}"></span>`;
            html += `</div>`;
            html += `<div class="pu-folder" title="${this._esc(rawCwd)}">${this._esc(cwd || '—')}</div>`;
            html += `<div class="pu-proc">${this._esc(proc || 'shell')} · ${status.label}</div>`;
            html += `</div>`;
        });

        this.contentEl.innerHTML = html;

        // Click to switch tab
        this.contentEl.querySelectorAll('.pu-row').forEach(row => {
            row.addEventListener('click', () => {
                const tab = parseInt(row.dataset.tab, 10);
                if (window.focusShellTab) window.focusShellTab(tab);
            });
        });
    }

    _getTabName(idx) {
        if (window.terminalNames && window.terminalNames[idx]) {
            const name = window.terminalNames[idx];
            if (name !== "EMPTY") return name;
        }
        return idx === 0 ? 'MAIN' : `TAB ${idx}`;
    }

    _getStatus(proc) {
        if (!proc) return { cls: 'pu-idle', label: 'IDLE' };
        const lower = proc.toLowerCase().replace(/\.exe$/, '');
        if (this._shells.has(lower)) return { cls: 'pu-idle', label: 'IDLE' };
        if (/claude|anthropic/i.test(proc)) return { cls: 'pu-busy', label: 'AI AGENT' };
        if (/node|npm|npx|yarn|pnpm|bun|deno/i.test(proc)) return { cls: 'pu-busy', label: 'RUNNING' };
        if (/python|pip|python3/i.test(proc)) return { cls: 'pu-busy', label: 'RUNNING' };
        if (/git|gh|ssh|scp/i.test(proc)) return { cls: 'pu-busy', label: 'RUNNING' };
        if (/vim|nvim|nano|emacs|less|more|man/i.test(proc)) return { cls: 'pu-editor', label: 'EDITOR' };
        return { cls: 'pu-busy', label: 'ACTIVE' };
    }

    _shortenPath(p) {
        if (!p) return '';
        const home = require('os').homedir();
        if (p.startsWith(home)) p = '~' + p.slice(home.length);
        // Show last 2 segments if long
        const parts = p.split('/').filter(Boolean);
        if (parts.length > 3) {
            return '…/' + parts.slice(-2).join('/');
        }
        return p;
    }

    _esc(text) {
        if (!text) return '';
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { TodoWidget };
}
