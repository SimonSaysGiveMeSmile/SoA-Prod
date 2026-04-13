/**
 * GitCommits - Side panel widget showing GitHub commit activity
 *
 * Fetches commit history via GitHub API (PAT or public).
 * Displays a contribution heatmap + recent commit list.
 * Configurable via window.settings.gitCommits:
 *   { owner, repo, pat, days }
 */
class GitCommits {
    constructor(parentId) {
        if (!parentId) throw "Missing parameters";

        this.parent = document.getElementById(parentId);

        const cfg = (window.settings && window.settings.gitCommits) || {};
        this.owner = cfg.owner || "";
        this.repo = cfg.repo || "";
        this.pat = cfg.pat || "";
        this.days = cfg.days || 30;

        this._buildDOM();
        this._cacheEls();

        if (!this.owner || !this.repo) {
            this._showConfig();
        } else {
            this._fetchAndRender();
        }

        this._interval = setInterval(() => this._fetchAndRender(), 5 * 60 * 1000);
    }

    _buildDOM() {
        const wrapper = document.createElement("div");
        wrapper.setAttribute("id", "mod_gitCommits");
        wrapper.innerHTML = `<div id="mod_gitCommits_inner">
            <h1>GIT ACTIVITY<i id="mod_gitCommits_info"></i></h1>
            <div id="mod_gitCommits_heatmap"></div>
            <div id="mod_gitCommits_controls">
                <span class="gc-interval" data-days="7">7D</span>
                <span class="gc-interval" data-days="14">14D</span>
                <span class="gc-interval gc-active" data-days="30">30D</span>
                <span class="gc-interval" data-days="90">90D</span>
            </div>
            <div id="mod_gitCommits_list"></div>
            <div id="mod_gitCommits_config" style="display:none">
                <div class="gc-cfg-row">
                    <label>OWNER</label>
                    <input id="gc_cfg_owner" type="text" spellcheck="false" placeholder="owner" />
                </div>
                <div class="gc-cfg-row">
                    <label>REPO</label>
                    <input id="gc_cfg_repo" type="text" spellcheck="false" placeholder="repo" />
                </div>
                <div class="gc-cfg-row">
                    <label>PAT</label>
                    <input id="gc_cfg_pat" type="password" spellcheck="false" placeholder="ghp_... (optional)" />
                </div>
                <button id="gc_cfg_save">CONNECT</button>
            </div>
        </div>`;
        this.parent.appendChild(wrapper);
    }

    _cacheEls() {
        this.infoEl = document.getElementById("mod_gitCommits_info");
        this.heatmapEl = document.getElementById("mod_gitCommits_heatmap");
        this.listEl = document.getElementById("mod_gitCommits_list");
        this.configEl = document.getElementById("mod_gitCommits_config");
        this.controlsEl = document.getElementById("mod_gitCommits_controls");

        this.controlsEl.querySelectorAll(".gc-interval").forEach(btn => {
            btn.addEventListener("click", () => {
                this.days = parseInt(btn.dataset.days, 10);
                this.controlsEl.querySelectorAll(".gc-interval").forEach(b => b.classList.remove("gc-active"));
                btn.classList.add("gc-active");
                this._fetchAndRender();
            });
        });

        document.getElementById("gc_cfg_save").addEventListener("click", () => {
            this._saveConfig();
        });
    }

    _showConfig() {
        this.heatmapEl.style.display = "none";
        this.listEl.style.display = "none";
        this.controlsEl.style.display = "none";
        this.configEl.style.display = "flex";
        this.infoEl.innerText = "SETUP REQUIRED";

        if (this.owner) document.getElementById("gc_cfg_owner").value = this.owner;
        if (this.repo) document.getElementById("gc_cfg_repo").value = this.repo;
        if (this.pat) document.getElementById("gc_cfg_pat").value = this.pat;
    }

    _saveConfig() {
        const owner = document.getElementById("gc_cfg_owner").value.trim();
        const repo = document.getElementById("gc_cfg_repo").value.trim();
        const pat = document.getElementById("gc_cfg_pat").value.trim();

        if (!owner || !repo) return;

        this.owner = owner;
        this.repo = repo;
        this.pat = pat;

        if (!window.settings.gitCommits) window.settings.gitCommits = {};
        window.settings.gitCommits.owner = owner;
        window.settings.gitCommits.repo = repo;
        window.settings.gitCommits.pat = pat;
        window.settings.gitCommits.days = this.days;

        const fs = require("fs");
        const path = require("path");
        const remote = require("@electron/remote");
        const settingsFile = path.join(remote.app.getPath("userData"), "settings.json");
        fs.writeFileSync(settingsFile, JSON.stringify(window.settings, "", 4));

        this.configEl.style.display = "none";
        this.heatmapEl.style.display = "";
        this.listEl.style.display = "";
        this.controlsEl.style.display = "";

        this._fetchAndRender();
    }

    async _fetchAndRender() {
        if (!this.owner || !this.repo) return;

        this.infoEl.innerText = "FETCHING...";

        try {
            const commits = await this._fetchCommits();
            this._renderHeatmap(commits);
            this._renderList(commits);
            this.infoEl.innerText = `${commits.length} COMMITS · ${this.days}D`;
        } catch (e) {
            console.error("[GitCommits]", e);
            this.infoEl.innerText = "ERROR";
            this.listEl.innerHTML = `<div class="gc-empty">${this._esc(e.message)}</div>`;
        }
    }

    async _fetchCommits() {
        const since = new Date();
        since.setDate(since.getDate() - this.days);

        const headers = { "Accept": "application/vnd.github+json" };
        if (this.pat) headers["Authorization"] = `Bearer ${this.pat}`;

        let allCommits = [];
        let page = 1;
        const perPage = 100;

        while (true) {
            const url = `https://api.github.com/repos/${this.owner}/${this.repo}/commits?since=${since.toISOString()}&per_page=${perPage}&page=${page}`;
            const resp = await fetch(url, { headers });

            if (!resp.ok) {
                const body = await resp.text();
                throw new Error(`GitHub ${resp.status}: ${body.slice(0, 120)}`);
            }

            const data = await resp.json();
            if (data.length === 0) break;

            allCommits = allCommits.concat(data);
            if (data.length < perPage) break;
            page++;
            if (page > 10) break;
        }

        return allCommits;
    }

    _renderHeatmap(commits) {
        const dayMap = new Map();
        const now = new Date();

        for (let i = 0; i < this.days; i++) {
            const d = new Date(now);
            d.setDate(d.getDate() - i);
            dayMap.set(d.toISOString().slice(0, 10), 0);
        }

        commits.forEach(c => {
            const day = (c.commit.author.date || "").slice(0, 10);
            if (dayMap.has(day)) dayMap.set(day, dayMap.get(day) + 1);
        });

        const max = Math.max(1, ...dayMap.values());
        const cols = Math.min(this.days, 7);
        const rows = Math.ceil(this.days / cols);

        let html = "";
        const sortedDays = [...dayMap.entries()].reverse();

        sortedDays.forEach(([day, count]) => {
            const intensity = count === 0 ? 0.06 : 0.15 + (count / max) * 0.85;
            const title = `${day}: ${count} commit${count !== 1 ? "s" : ""}`;
            html += `<div class="gc-cell" style="opacity:${intensity}" title="${title}"></div>`;
        });

        this.heatmapEl.innerHTML = html;
        this.heatmapEl.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
    }

    _renderList(commits) {
        if (commits.length === 0) {
            this.listEl.innerHTML = '<div class="gc-empty">NO COMMITS</div>';
            return;
        }

        const recent = commits.slice(0, 15);
        let html = "";

        recent.forEach(c => {
            const msg = (c.commit.message || "").split("\n")[0];
            const author = (c.commit.author && c.commit.author.name) || "unknown";
            const date = c.commit.author && c.commit.author.date;
            const ago = this._timeAgo(date);
            const sha = (c.sha || "").slice(0, 7);

            html += `<div class="gc-row">`;
            html += `<div class="gc-msg">${this._esc(msg)}</div>`;
            html += `<div class="gc-meta">${this._esc(sha)} · ${this._esc(author)} · ${ago}</div>`;
            html += `</div>`;
        });

        this.listEl.innerHTML = html;
    }

    _timeAgo(dateStr) {
        if (!dateStr) return "";
        const diff = Date.now() - new Date(dateStr).getTime();
        const mins = Math.floor(diff / 60000);
        if (mins < 60) return `${mins}m`;
        const hrs = Math.floor(mins / 60);
        if (hrs < 24) return `${hrs}h`;
        const days = Math.floor(hrs / 24);
        return `${days}d`;
    }

    _esc(text) {
        if (!text) return "";
        return String(text)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");
    }
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = { GitCommits };
}
