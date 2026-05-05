/**
 * GitCommits - Side panel widget showing GitHub commit activity
 *
 * Fetches commit history via GitHub Search Commits API (public 60 req/hr).
 * Only requires a GitHub username — shows commits across all public repos.
 * Displays a contribution heatmap + recent commit list with repo labels.
 * Configurable via window.settings.gitCommits:
 *   { username, pat, days }
 */
class GitCommits {
    constructor(parentId) {
        if (!parentId) throw "Missing parameters";

        this.parent = document.getElementById(parentId);

        const cfg = (window.settings && window.settings.gitCommits) || {};
        this.username = cfg.username || "";
        this.pat = cfg.pat || "";
        this.days = cfg.days || 30;

        this._buildDOM();
        this._cacheEls();

        if (!this.username) {
            this._autoDetectUsername().then(() => {
                if (this.username) {
                    this._prefillConfig();
                    this._safeFetchAndRender();
                } else {
                    this._showConfig();
                }
            });
        } else {
            this._safeFetchAndRender();
        }

        this._interval = setInterval(() => this._safeFetchAndRender(), 5 * 60 * 1000);
    }

    async _autoDetectUsername() {
        try {
            const { execSync } = require("child_process");
            const cwd = (window.term && window.term[0] && window.term[0].cwd)
                ? window.term[0].cwd.replace(/^FALLBACK \|-- /, "")
                : require("os").homedir();

            const remoteUrl = execSync("git config --get remote.origin.url", {
                cwd, encoding: "utf8", timeout: 3000
            }).trim();

            const match = remoteUrl.match(/github\.com[:/]([^/]+)\//);
            if (match) {
                this.username = match[1];
            }
        } catch (_) {
            // not a git repo or no remote
        }
    }

    _prefillConfig() {
        document.getElementById("gc_cfg_username").value = this.username;
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
                    <label>USER</label>
                    <input id="gc_cfg_username" type="text" spellcheck="false" placeholder="github username" />
                </div>
                <div class="gc-cfg-row">
                    <label>PAT</label>
                    <input id="gc_cfg_pat" type="password" spellcheck="false" placeholder="ghp_... (optional)" />
                </div>
                <div class="gc-cfg-hint">Public API: 60 req/hr · PAT: 5,000 req/hr</div>
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
                this._safeFetchAndRender();
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

        if (this.username) document.getElementById("gc_cfg_username").value = this.username;
        if (this.pat) document.getElementById("gc_cfg_pat").value = this.pat;
    }

    async _saveConfig() {
        const usernameInput = document.getElementById("gc_cfg_username");
        const username = usernameInput.value.trim();
        const pat = document.getElementById("gc_cfg_pat").value.trim();

        if (!username) {
            usernameInput.classList.add("gc-input-error");
            this.infoEl.innerText = "ENTER USERNAME";
            setTimeout(() => usernameInput.classList.remove("gc-input-error"), 1500);
            return;
        }

        this.username = username;
        this.pat = pat;

        const saveBtn = document.getElementById("gc_cfg_save");
        saveBtn.textContent = "CONNECTING...";
        saveBtn.disabled = true;

        try {
            await this._fetchAndRender();

            if (!window.settings.gitCommits) window.settings.gitCommits = {};
            window.settings.gitCommits.username = username;
            window.settings.gitCommits.pat = pat;
            window.settings.gitCommits.days = this.days;
            delete window.settings.gitCommits.owner;
            delete window.settings.gitCommits.repo;

            const fs = require("fs");
            const path = require("path");
            const remote = require("@electron/remote");
            const settingsFile = path.join(remote.app.getPath("userData"), "settings.json");
            fs.writeFileSync(settingsFile, JSON.stringify(window.settings, "", 4));

            this.configEl.style.display = "none";
            this.heatmapEl.style.display = "";
            this.listEl.style.display = "";
            this.controlsEl.style.display = "";
        } catch (e) {
            this.infoEl.innerText = "CONNECTION FAILED";
            this._showConfigError(e.message);
        } finally {
            saveBtn.textContent = "CONNECT";
            saveBtn.disabled = false;
        }
    }

    _showConfigError(msg) {
        let errEl = this.configEl.querySelector(".gc-cfg-error");
        if (!errEl) {
            errEl = document.createElement("div");
            errEl.className = "gc-cfg-error";
            this.configEl.appendChild(errEl);
        }
        errEl.textContent = msg;
        errEl.style.display = "block";
        setTimeout(() => { errEl.style.display = "none"; }, 8000);
    }

    async _fetchAndRender() {
        if (!this.username) return;

        this.infoEl.innerText = "FETCHING...";

        const commits = await this._fetchCommits();
        this._renderHeatmap(commits);
        this._renderList(commits);
        this.infoEl.innerText = `@${this._esc(this.username)} · ${commits.length} COMMITS · ${this.days}D`;
    }

    async _safeFetchAndRender() {
        try {
            await this._fetchAndRender();
        } catch (e) {
            console.error("[GitCommits]", e);
            this.infoEl.innerText = "ERROR";
            this.listEl.innerHTML = `<div class="gc-empty">${this._esc(e.message)}</div>`;
        }
    }

    async _fetchCommits() {
        const since = new Date();
        since.setDate(since.getDate() - this.days);
        const sinceStr = since.toISOString().slice(0, 10);

        const headers = { "Accept": "application/vnd.github+json" };
        if (this.pat) headers["Authorization"] = `Bearer ${this.pat}`;

        let allItems = [];
        let page = 1;
        const perPage = 100;

        while (true) {
            const q = encodeURIComponent(`author:${this.username} author-date:>${sinceStr}`);
            const url = `https://api.github.com/search/commits?q=${q}&sort=author-date&order=desc&per_page=${perPage}&page=${page}`;
            const resp = await fetch(url, { headers });

            if (resp.status === 403) {
                const remaining = resp.headers.get("x-ratelimit-remaining");
                if (remaining === "0") {
                    const reset = resp.headers.get("x-ratelimit-reset");
                    const resetIn = reset ? Math.ceil((parseInt(reset) * 1000 - Date.now()) / 60000) : "?";
                    throw new Error(`Rate limited — resets in ${resetIn}m. Add a PAT for 5,000 req/hr.`);
                }
            }

            if (!resp.ok) {
                const body = await resp.text();
                throw new Error(`GitHub ${resp.status}: ${body.slice(0, 120)}`);
            }

            const data = await resp.json();
            const items = data.items || [];
            if (items.length === 0) break;

            allItems = allItems.concat(items);
            if (items.length < perPage || allItems.length >= data.total_count) break;
            page++;
            if (page > 10) break;
        }

        return allItems;
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

        const recent = commits.slice(0, 20);
        let html = "";

        recent.forEach(c => {
            const msg = (c.commit.message || "").split("\n")[0];
            const date = c.commit.author && c.commit.author.date;
            const ago = this._timeAgo(date);
            const sha = (c.sha || "").slice(0, 7);
            const repoName = (c.repository && c.repository.full_name) || "";

            html += `<div class="gc-row">`;
            html += `<div class="gc-msg">${this._esc(msg)}</div>`;
            html += `<div class="gc-meta">`;
            if (repoName) html += `<span class="gc-repo">${this._esc(repoName)}</span> · `;
            html += `${this._esc(sha)} · ${ago}`;
            html += `</div></div>`;
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
