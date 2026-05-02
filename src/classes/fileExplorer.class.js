class FileExplorer {
    constructor(parentId) {
        if (!parentId) throw "Missing parameters";

        const fs = require("fs");
        const path = require("path");
        const mime = require("mime-types");

        this.fs = fs;
        this.path = path;
        this.mime = mime;
        this.cwd = null;
        this.entries = [];
        this.history = [];
        this.historyIndex = -1;
        this._reading = false;
        this._fsWatcher = null;
        this._watchDebounce = null;
        this._collapsed = false;
        this._editingFile = null;
        this._editDirty = false;

        const iconColor = `rgb(${window.theme.r}, ${window.theme.g}, ${window.theme.b})`;

        this.parent = document.getElementById(parentId);
        this.parent.innerHTML += `<div id="mod_fileExplorer" class="mod_fileExplorer">
            <div class="fe-header">
                <span class="fe-title">FILE EXPLORER</span>
                <div class="fe-controls">
                    <button class="fe-btn fe-btn-back" title="Back">&#9664;</button>
                    <button class="fe-btn fe-btn-fwd" title="Forward">&#9654;</button>
                    <button class="fe-btn fe-btn-up" title="Go up">&#9650;</button>
                    <button class="fe-btn fe-btn-home" title="Home">&#8962;</button>
                    <button class="fe-btn fe-btn-refresh" title="Refresh">&#8635;</button>
                    <button class="fe-btn fe-btn-collapse" title="Collapse">&#9660;</button>
                </div>
            </div>
            <div class="fe-breadcrumb"></div>
            <div class="fe-body">
                <div class="fe-list-view"></div>
                <div class="fe-editor-view" style="display:none;">
                    <div class="fe-editor-toolbar">
                        <span class="fe-editor-filename"></span>
                        <div class="fe-editor-actions">
                            <button class="fe-btn fe-btn-save" title="Save">SAVE</button>
                            <button class="fe-btn fe-btn-close-editor" title="Close">&times;</button>
                        </div>
                    </div>
                    <textarea class="fe-editor-textarea" spellcheck="false"></textarea>
                    <div class="fe-editor-status"></div>
                </div>
            </div>
        </div>`;

        this.container = document.getElementById("mod_fileExplorer");
        this.listView = this.container.querySelector(".fe-list-view");
        this.editorView = this.container.querySelector(".fe-editor-view");
        this.breadcrumb = this.container.querySelector(".fe-breadcrumb");
        this.textarea = this.container.querySelector(".fe-editor-textarea");
        this.editorStatus = this.container.querySelector(".fe-editor-status");
        this.editorFilename = this.container.querySelector(".fe-editor-filename");

        const btnBack = this.container.querySelector(".fe-btn-back");
        const btnFwd = this.container.querySelector(".fe-btn-fwd");
        const btnUp = this.container.querySelector(".fe-btn-up");
        const btnHome = this.container.querySelector(".fe-btn-home");
        const btnRefresh = this.container.querySelector(".fe-btn-refresh");
        const btnCollapse = this.container.querySelector(".fe-btn-collapse");
        const btnSave = this.container.querySelector(".fe-btn-save");
        const btnCloseEditor = this.container.querySelector(".fe-btn-close-editor");

        btnBack.addEventListener("click", () => this.goBack());
        btnFwd.addEventListener("click", () => this.goForward());
        btnUp.addEventListener("click", () => this.goUp());
        btnHome.addEventListener("click", () => this.navigate(this._getHomePath()));
        btnRefresh.addEventListener("click", () => this.refresh());
        btnCollapse.addEventListener("click", () => this.toggleCollapse());
        btnSave.addEventListener("click", () => this.saveFile());
        btnCloseEditor.addEventListener("click", () => this.closeEditor());

        this.textarea.addEventListener("input", () => {
            this._editDirty = true;
            this.editorStatus.textContent = "Modified";
            this.editorStatus.className = "fe-editor-status fe-status-modified";
        });

        this.textarea.addEventListener("keydown", (e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "s") {
                e.preventDefault();
                e.stopPropagation();
                this.saveFile();
            }
            if (e.key === "Tab") {
                e.preventDefault();
                const start = this.textarea.selectionStart;
                const end = this.textarea.selectionEnd;
                this.textarea.value = this.textarea.value.substring(0, start) + "    " + this.textarea.value.substring(end);
                this.textarea.selectionStart = this.textarea.selectionEnd = start + 4;
                this._editDirty = true;
                this.editorStatus.textContent = "Modified";
                this.editorStatus.className = "fe-editor-status fe-status-modified";
            }
        });

        this.textarea.addEventListener("focus", () => {
            if (window.keyboard && window.keyboard.detach) window.keyboard.detach();
        });
        this.textarea.addEventListener("blur", () => {
            if (window.keyboard && window.keyboard.attach) window.keyboard.attach();
        });

        this._formatBytes = (bytes) => {
            if (bytes === 0) return "0 B";
            const k = 1024;
            const sizes = ["B", "KB", "MB", "GB"];
            const i = Math.floor(Math.log(bytes) / Math.log(k));
            return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
        };

        this._getHomePath = () => {
            if (window.settings && window.settings.cwd) return window.settings.cwd;
            return process.env.HOME || process.env.USERPROFILE || "/";
        };

        this._getFileIcon = (entry) => {
            if (entry.type === "dir") return "&#128193;";
            if (entry.type === "symlink") return "&#128279;";
            const ext = path.extname(entry.name).toLowerCase();
            const codeExts = [".js", ".ts", ".jsx", ".tsx", ".py", ".rb", ".go", ".rs", ".c", ".cpp", ".h", ".java", ".cs", ".swift", ".kt"];
            const dataExts = [".json", ".yaml", ".yml", ".xml", ".toml", ".ini", ".csv"];
            const docExts = [".md", ".txt", ".log", ".rtf", ".doc", ".pdf"];
            const imgExts = [".png", ".jpg", ".jpeg", ".gif", ".svg", ".bmp", ".webp", ".ico"];
            if (codeExts.includes(ext)) return "&#128196;";
            if (dataExts.includes(ext)) return "&#128202;";
            if (docExts.includes(ext)) return "&#128220;";
            if (imgExts.includes(ext)) return "&#127912;";
            return "&#128462;";
        };

        this._isEditable = (filePath) => {
            const filetype = mime.lookup(path.extname(filePath).slice(1));
            if (!filetype) {
                const ext = path.extname(filePath).toLowerCase();
                const textExts = [".txt", ".md", ".log", ".sh", ".bash", ".zsh", ".fish",
                    ".js", ".ts", ".jsx", ".tsx", ".py", ".rb", ".go", ".rs", ".c", ".cpp", ".h",
                    ".java", ".cs", ".swift", ".kt", ".json", ".yaml", ".yml", ".xml", ".toml",
                    ".ini", ".csv", ".html", ".css", ".scss", ".less", ".sql", ".env", ".gitignore",
                    ".dockerignore", ".editorconfig", ".eslintrc", ".prettierrc", ".cfg", ".conf",
                    ".makefile", ".cmake", ".gradle"];
                return textExts.includes(ext) || ext === "";
            }
            return mime.charset(filetype) === "UTF-8";
        };

        this.navigate = (dir) => {
            if (this._editDirty) {
                if (!confirm("You have unsaved changes. Discard?")) return;
            }
            this.closeEditor(true);
            if (this.cwd !== dir) {
                if (this.historyIndex < this.history.length - 1) {
                    this.history = this.history.slice(0, this.historyIndex + 1);
                }
                this.history.push(dir);
                this.historyIndex = this.history.length - 1;
            }
            this.readDir(dir);
        };

        this.goBack = () => {
            if (this.historyIndex > 0) {
                this.historyIndex--;
                this.closeEditor(true);
                this.readDir(this.history[this.historyIndex]);
            }
        };

        this.goForward = () => {
            if (this.historyIndex < this.history.length - 1) {
                this.historyIndex++;
                this.closeEditor(true);
                this.readDir(this.history[this.historyIndex]);
            }
        };

        this.goUp = () => {
            if (this.cwd) {
                const parent = path.dirname(this.cwd);
                if (parent !== this.cwd) this.navigate(parent);
            }
        };

        this.refresh = () => {
            if (this.cwd) this.readDir(this.cwd);
        };

        this.toggleCollapse = () => {
            this._collapsed = !this._collapsed;
            const body = this.container.querySelector(".fe-body");
            const breadcrumbEl = this.container.querySelector(".fe-breadcrumb");
            const collapseBtn = this.container.querySelector(".fe-btn-collapse");
            if (this._collapsed) {
                body.style.display = "none";
                breadcrumbEl.style.display = "none";
                collapseBtn.innerHTML = "&#9650;";
                collapseBtn.title = "Expand";
            } else {
                body.style.display = "";
                breadcrumbEl.style.display = "";
                collapseBtn.innerHTML = "&#9660;";
                collapseBtn.title = "Collapse";
            }
        };

        this.watchDir = (dir) => {
            if (this._fsWatcher) {
                this._fsWatcher.close();
                this._fsWatcher = null;
            }
            try {
                this._fsWatcher = fs.watch(dir, (eventType) => {
                    if (eventType !== "change") {
                        clearTimeout(this._watchDebounce);
                        this._watchDebounce = setTimeout(() => this.readDir(this.cwd), 800);
                    }
                });
            } catch (_) { /* permission denied, non-existent, etc. */ }
        };

        this.readDir = async (dir) => {
            if (this._reading) return;
            this._reading = true;

            try {
                const content = await fs.promises.readdir(dir);
                this.cwd = dir;
                this.entries = [];

                const statPromises = content.map(async (file) => {
                    try {
                        const fstat = await fs.promises.lstat(path.join(dir, file));
                        const entry = {
                            name: file,
                            path: path.join(dir, file),
                            hidden: file.startsWith(".")
                        };
                        if (fstat.isDirectory()) {
                            entry.type = "dir";
                            entry.size = null;
                        } else if (fstat.isSymbolicLink()) {
                            entry.type = "symlink";
                            entry.size = fstat.size;
                        } else if (fstat.isFile()) {
                            entry.type = "file";
                            entry.size = fstat.size;
                        } else {
                            entry.type = "other";
                            entry.size = null;
                        }
                        entry.mtime = fstat.mtime;
                        return entry;
                    } catch (_) {
                        return { name: file, path: path.join(dir, file), type: "other", hidden: file.startsWith("."), size: null, mtime: null };
                    }
                });

                this.entries = await Promise.all(statPromises);
                this.entries.sort((a, b) => {
                    const order = { dir: 0, symlink: 1, file: 2, other: 3 };
                    return (order[a.type] - order[b.type]) || a.name.localeCompare(b.name);
                });

                this.renderBreadcrumb();
                this.renderList();
                this.watchDir(dir);
            } catch (err) {
                this.listView.innerHTML = `<div class="fe-error">Cannot access: ${window._escapeHtml(dir)}<br><small>${window._escapeHtml(err.message)}</small></div>`;
            } finally {
                this._reading = false;
            }
        };

        this.renderBreadcrumb = () => {
            if (!this.cwd) return;
            const parts = this.cwd.split(path.sep).filter(Boolean);
            let html = "";
            let accumulated = process.platform === "win32" ? "" : "/";

            html += `<span class="fe-crumb" data-path="${accumulated}">/</span>`;

            parts.forEach((part, i) => {
                accumulated = path.join(accumulated, part);
                const isLast = i === parts.length - 1;
                html += `<span class="fe-crumb-sep">/</span>`;
                html += `<span class="fe-crumb${isLast ? " fe-crumb-active" : ""}" data-path="${window._escapeHtml(accumulated)}">${window._escapeHtml(part)}</span>`;
            });

            this.breadcrumb.innerHTML = html;
            this.breadcrumb.querySelectorAll(".fe-crumb").forEach(el => {
                el.addEventListener("click", () => {
                    this.navigate(el.dataset.path);
                });
            });
        };

        this.renderList = () => {
            let html = "";
            const showHidden = window.settings && window.settings.fileExplorerShowHidden;

            this.entries.forEach((entry, idx) => {
                if (entry.hidden && !showHidden) return;

                const icon = this._getFileIcon(entry);
                const sizeStr = entry.type === "file" && entry.size != null ? this._formatBytes(entry.size) : "";
                const typeClass = `fe-entry-${entry.type}`;

                html += `<div class="fe-entry ${typeClass}" data-idx="${idx}" title="${window._escapeHtml(entry.path)}">
                    <span class="fe-entry-icon">${icon}</span>
                    <span class="fe-entry-name">${window._escapeHtml(entry.name)}</span>
                    <span class="fe-entry-size">${sizeStr}</span>
                </div>`;
            });

            if (!html) {
                html = `<div class="fe-empty">Empty directory</div>`;
            }

            this.listView.innerHTML = html;
            this.listView.querySelectorAll(".fe-entry").forEach(el => {
                el.addEventListener("click", () => {
                    const idx = parseInt(el.dataset.idx);
                    const entry = this.entries[idx];
                    if (!entry) return;
                    if (entry.type === "dir") {
                        this.navigate(entry.path);
                    } else if (entry.type === "file") {
                        this.openFile(entry);
                    } else if (entry.type === "symlink") {
                        try {
                            const real = fs.realpathSync(entry.path);
                            const stat = fs.statSync(real);
                            if (stat.isDirectory()) {
                                this.navigate(real);
                            } else {
                                this.openFile({ ...entry, path: real, type: "file" });
                            }
                        } catch (_) {}
                    }
                });

                el.addEventListener("contextmenu", (e) => {
                    e.preventDefault();
                    const idx = parseInt(el.dataset.idx);
                    const entry = this.entries[idx];
                    if (entry) this.showContextMenu(e, entry);
                });
            });
        };

        this.openFile = (entry) => {
            if (this._editDirty) {
                if (!confirm("You have unsaved changes. Discard?")) return;
            }

            if (!this._isEditable(entry.path)) {
                if (entry.size && entry.size > 50 * 1024 * 1024) {
                    this.editorStatus.textContent = "File too large to preview";
                    return;
                }
                const ext = path.extname(entry.name).toLowerCase();
                if ([".png", ".jpg", ".jpeg", ".gif", ".svg", ".bmp", ".webp"].includes(ext)) {
                    this._showImagePreview(entry);
                    return;
                }
                this.editorStatus.textContent = "Binary file — cannot edit";
                this.editorStatus.className = "fe-editor-status fe-status-error";
                return;
            }

            if (entry.size && entry.size > 2 * 1024 * 1024) {
                this.editorStatus.textContent = "File too large to edit (>2MB)";
                this.editorStatus.className = "fe-editor-status fe-status-error";
                return;
            }

            fs.readFile(entry.path, "utf-8", (err, data) => {
                if (err) {
                    this.editorStatus.textContent = "Error: " + err.message;
                    this.editorStatus.className = "fe-editor-status fe-status-error";
                    return;
                }

                this._editingFile = entry.path;
                this._editDirty = false;
                this.textarea.value = data;
                this.editorFilename.textContent = entry.name;
                this.editorFilename.title = entry.path;
                this.editorStatus.textContent = "";
                this.editorStatus.className = "fe-editor-status";

                this.listView.style.display = "none";
                this.editorView.style.display = "flex";
            });
        };

        this.saveFile = () => {
            if (!this._editingFile) return;
            fs.writeFile(this._editingFile, this.textarea.value, "utf-8", (err) => {
                if (err) {
                    this.editorStatus.textContent = "Save failed: " + err.message;
                    this.editorStatus.className = "fe-editor-status fe-status-error";
                    return;
                }
                this._editDirty = false;
                this.editorStatus.textContent = "Saved";
                this.editorStatus.className = "fe-editor-status fe-status-saved";
                if (window.audioManager && window.audioManager.folder) {
                    window.audioManager.folder.play();
                }
            });
        };

        this.closeEditor = (force) => {
            if (this._editDirty && !force) {
                if (!confirm("You have unsaved changes. Discard?")) return;
            }
            this._editingFile = null;
            this._editDirty = false;
            this.textarea.value = "";
            this.editorFilename.textContent = "";
            this.editorStatus.textContent = "";
            this.editorStatus.className = "fe-editor-status";
            this.editorView.style.display = "none";
            this.listView.style.display = "";
        };

        this._showImagePreview = (entry) => {
            const encodedPath = window._encodePathURI ? window._encodePathURI(entry.path) : ("file://" + encodeURI(entry.path));
            new Modal({
                type: "custom",
                title: window._escapeHtml(entry.name),
                html: `<img src="${encodedPath}" style="max-width:100%;max-height:60vh;object-fit:contain;" ondragstart="return false;">`
            });
        };

        this.showContextMenu = (event, entry) => {
            const existing = document.querySelector(".fe-context-menu");
            if (existing) existing.remove();

            const menu = document.createElement("div");
            menu.className = "fe-context-menu";

            const items = [];
            if (entry.type === "dir") {
                items.push({ label: "Open in Terminal", action: () => {
                    if (window.term && window.term[window.currentTerm]) {
                        window.term[window.currentTerm].writelr(`cd "${entry.path}"`);
                    }
                }});
            }
            if (entry.type === "file" && this._isEditable(entry.path)) {
                items.push({ label: "Edit", action: () => this.openFile(entry) });
            }
            items.push({ label: "Copy Path", action: () => {
                require("electron").clipboard.writeText(entry.path);
            }});
            items.push({ label: "Insert Path in Terminal", action: () => {
                if (window.term && window.term[window.currentTerm]) {
                    window.term[window.currentTerm].write(`"${entry.path}"`);
                }
            }});
            if (entry.type === "file") {
                items.push({ label: "Open Externally", action: () => {
                    require("electron").shell.openPath(entry.path);
                }});
            }
            items.push({ label: "Delete", action: () => {
                if (confirm(`Delete "${entry.name}"?`)) {
                    const rm = entry.type === "dir" ? fs.promises.rmdir(entry.path, { recursive: true }) : fs.promises.unlink(entry.path);
                    rm.then(() => this.refresh()).catch(err => {
                        this.editorStatus.textContent = "Delete failed: " + err.message;
                        this.editorStatus.className = "fe-editor-status fe-status-error";
                    });
                }
            }});

            items.forEach(item => {
                const row = document.createElement("div");
                row.className = "fe-ctx-item";
                row.textContent = item.label;
                row.addEventListener("click", (e) => {
                    e.stopPropagation();
                    menu.remove();
                    item.action();
                });
                menu.appendChild(row);
            });

            menu.style.position = "fixed";
            menu.style.left = event.clientX + "px";
            menu.style.top = event.clientY + "px";
            document.body.appendChild(menu);

            const cleanup = (e) => {
                if (!menu.contains(e.target)) {
                    menu.remove();
                    document.removeEventListener("click", cleanup);
                }
            };
            setTimeout(() => document.addEventListener("click", cleanup), 0);
        };

        const startDir = this._getHomePath();
        this.navigate(startDir);
    }
}

module.exports = { FileExplorer };
