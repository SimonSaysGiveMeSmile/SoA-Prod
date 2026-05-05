class Terminal {
    constructor(opts) {
        if (opts.role === "client") {
            if (!opts.parentId) throw "Missing options";

            this.xTerm = require("xterm").Terminal;
            const { AttachAddon } = require("xterm-addon-attach");
            const { FitAddon } = require("xterm-addon-fit");
            const { LigaturesAddon } = require("xterm-addon-ligatures");
            const { WebglAddon } = require("xterm-addon-webgl");
            this.Ipc = require("electron").ipcRenderer;

            this.port = opts.port || 3000;
            this.cwd = "";
            this.oncwdchange = () => { };

            this._sendSizeToServer = () => {
                let cols = this.term.cols.toString();
                let rows = this.term.rows.toString();
                while (cols.length < 3) {
                    cols = "0" + cols;
                }
                while (rows.length < 3) {
                    rows = "0" + rows;
                }
                this.Ipc.send("terminal_channel-" + this.port, "Resize", cols, rows);
            };

            // Support for custom color filters on the terminal - see #483
            let doCustomFilter = (window.isTermFilterValidated) ? true : false;

            // Parse & validate color filter
            if (window.isTermFilterValidated !== true && typeof window.theme.terminal.colorFilter === "object" && window.theme.terminal.colorFilter.length > 0) {
                doCustomFilter = window.theme.terminal.colorFilter.every((step, i, a) => {
                    let func = step.slice(0, step.indexOf("("));

                    switch (func) {
                        case "negate":
                        case "grayscale":
                            a[i] = {
                                func,
                                arg: []
                            };
                            return true;
                        case "lighten":
                        case "darken":
                        case "saturate":
                        case "desaturate":
                        case "whiten":
                        case "blacken":
                        case "fade":
                        case "opaquer":
                        case "rotate":
                        case "mix":
                            break;
                        default:
                            return false;
                    }

                    let arg = step.slice(step.indexOf("(") + 1, step.indexOf(")"));

                    if (typeof Number(arg) === "number") {
                        a[i] = {
                            func,
                            arg: [Number(arg)]
                        };
                        window.isTermFilterValidated = true;
                        return true;
                    }

                    return false;
                });
            }

            let color = require("color");
            let colorify;
            if (doCustomFilter) {
                colorify = (base, target) => {
                    let newColor = color(base);
                    target = color(target);

                    for (let i = 0; i < window.theme.terminal.colorFilter.length; i++) {
                        if (window.theme.terminal.colorFilter[i].func === "mix") {
                            newColor = newColor[window.theme.terminal.colorFilter[i].func](target, ...window.theme.terminal.colorFilter[i].arg);
                        } else {
                            newColor = newColor[window.theme.terminal.colorFilter[i].func](...window.theme.terminal.colorFilter[i].arg);
                        }
                    }

                    return newColor.hex();
                };
            } else {
                colorify = (base, target) => {
                    return color(base).grayscale().mix(color(target), 0.3).hex();
                };
            }

            let themeColor = `rgb(${window.theme.r}, ${window.theme.g}, ${window.theme.b})`;

            this.term = new this.xTerm({
                cols: 80,
                rows: 24,
                cursorBlink: window.theme.terminal.cursorBlink || true,
                cursorStyle: window.theme.terminal.cursorStyle || "block",
                allowTransparency: window.theme.terminal.allowTransparency || false,
                fontFamily: window.theme.terminal.fontFamily || "Fira Mono",
                fontSize: window.theme.terminal.fontSize || window.settings.termFontSize || 15,
                fontWeight: window.theme.terminal.fontWeight || "normal",
                fontWeightBold: window.theme.terminal.fontWeightBold || "bold",
                letterSpacing: window.theme.terminal.letterSpacing || 0,
                lineHeight: window.theme.terminal.lineHeight || 1,
                scrollback: 1500,
                bellStyle: "none",
                theme: {
                    foreground: window.theme.terminal.foreground,
                    background: window.theme.terminal.background,
                    cursor: window.theme.terminal.cursor,
                    cursorAccent: window.theme.terminal.cursorAccent,
                    selection: window.theme.terminal.selection,
                    black: window.theme.colors.black || colorify("#2e3436", themeColor),
                    red: window.theme.colors.red || colorify("#cc0000", themeColor),
                    green: window.theme.colors.green || colorify("#4e9a06", themeColor),
                    yellow: window.theme.colors.yellow || colorify("#c4a000", themeColor),
                    blue: window.theme.colors.blue || colorify("#3465a4", themeColor),
                    magenta: window.theme.colors.magenta || colorify("#75507b", themeColor),
                    cyan: window.theme.colors.cyan || colorify("#06989a", themeColor),
                    white: window.theme.colors.white || colorify("#d3d7cf", themeColor),
                    brightBlack: window.theme.colors.brightBlack || colorify("#555753", themeColor),
                    brightRed: window.theme.colors.brightRed || colorify("#ef2929", themeColor),
                    brightGreen: window.theme.colors.brightGreen || colorify("#8ae234", themeColor),
                    brightYellow: window.theme.colors.brightYellow || colorify("#fce94f", themeColor),
                    brightBlue: window.theme.colors.brightBlue || colorify("#729fcf", themeColor),
                    brightMagenta: window.theme.colors.brightMagenta || colorify("#ad7fa8", themeColor),
                    brightCyan: window.theme.colors.brightCyan || colorify("#34e2e2", themeColor),
                    brightWhite: window.theme.colors.brightWhite || colorify("#eeeeec", themeColor)
                }
            });
            let fitAddon = new FitAddon();
            this.term.loadAddon(fitAddon);
            this.term.open(document.getElementById(opts.parentId));
            try {
                let webglAddon = new WebglAddon();
                webglAddon.onContextLoss(() => {
                    console.warn('[Terminal] WebGL context lost on port ' + this.port + ', falling back to DOM renderer');
                    try { webglAddon.dispose(); } catch (e) { /* already disposed */ }
                });
                this.term.loadAddon(webglAddon);
            } catch (e) {
                console.warn('[Terminal] WebGL addon failed on port ' + this.port + ', using DOM renderer:', e.message);
            }
            let ligaturesAddon = new LigaturesAddon();
            this.term.loadAddon(ligaturesAddon);
            this.term.attachCustomKeyEventHandler(e => {
                if (window.keyboard && window.keyboard.keydownHandler) {
                    window.keyboard.keydownHandler(e);
                }

                // Double-space: open TextEditor overlay
                if (
                    window.autoCompose
                    && e.type === "keydown"
                    && e.key === " "
                    && !e.ctrlKey && !e.metaKey && !e.altKey
                    && !document.getElementById("inputcomposer_bar")
                    && !document.getElementById("texteditor_overlay")
                    && this.term.buffer.active.type !== "alternate"
                ) {
                    const now = Date.now();
                    if (window._lastSpaceTime && (now - window._lastSpaceTime) < 150) {
                        window._lastSpaceTime = 0;
                        InputComposer.closeIfOpen();
                        new TextEditor();
                        return false;
                    }
                    window._lastSpaceTime = now;
                }

                // Browser command detection: check for "browse", "back", "forward", "refresh" on Enter
                if (e.type === "keydown" && e.key === "Enter") {
                    // Get the current line from the terminal
                    const buffer = this.term.buffer.active;
                    const cursorRow = buffer.baseY + buffer.cursorY;
                    const currentLine = buffer.getLine(cursorRow);
                    if (currentLine) {
                        const lineText = currentLine.translateToString(true).trim();
                        // Strip shell prompt to get the actual command
                        // Match common prompt endings: $ > # %
                        const promptMatch = lineText.match(/[$>#%]\s*(.*)$/);
                        const cmd = promptMatch ? promptMatch[1].trim() : lineText;

                        if (buffer.type !== "alternate") {
                            const bMatch = lineText.match(/[$>#%❯›]\s*(.*)$/);
                            const bText = (bMatch ? bMatch[1] : lineText).trim();
                            if (bText) this._pendingBannerText = bText;
                        }

                        // Check for browser commands
                        if (cmd.startsWith('browse ') || cmd === 'browse' || cmd === 'back' || cmd === 'forward' || cmd === 'refresh') {
                            const parts = cmd.split(' ');
                            const action = parts[0];
                            const args = parts.slice(1);
                            if (window.handleBrowserCommand && window.handleBrowserCommand(action, args)) {
                                // Clear the command line
                                this.term.write('\r\x1b[K');
                                return false;
                            }
                        }
                    }
                }

                return true;
            });
            // Prevent soft-keyboard on touch devices #733
            document.querySelectorAll('.xterm-helper-textarea').forEach(textarea => textarea.setAttribute('readonly', 'readonly'))
            this.term.focus();

            // Context banner: floating element showing label + last Claude input
            let contextBanner = document.createElement('div');
            contextBanner.className = 'terminal-context-banner';

            // Derive tab index from parentId (e.g. "terminal0" → "0")
            let bannerKey = opts.parentId.replace(/\D/g, '');

            // Label button — click to edit session name
            let labelEl = document.createElement('span');
            labelEl.className = 'banner-label';
            let savedLabel = (window.bannerLabels && window.bannerLabels[bannerKey]) || '';
            labelEl.textContent = savedLabel || '✎';
            if (!savedLabel) labelEl.classList.add('empty');

            labelEl.addEventListener('click', (e) => {
                e.stopPropagation();
                let input = document.createElement('input');
                input.className = 'banner-label-input';
                input.type = 'text';
                input.maxLength = 40;
                input.value = (window.bannerLabels && window.bannerLabels[bannerKey]) || '';
                input.placeholder = 'Session name...';

                let commit = () => {
                    let val = input.value.trim().substring(0, 40);
                    if (!window.bannerLabels) window.bannerLabels = {};
                    window.bannerLabels[bannerKey] = val;
                    if (window.saveBannerLabels) window.saveBannerLabels();
                    labelEl.textContent = val || '✎';
                    labelEl.classList.toggle('empty', !val);
                    if (input.parentNode) input.parentNode.replaceChild(labelEl, input);
                };

                input.addEventListener('blur', commit);
                input.addEventListener('keydown', (ke) => {
                    ke.stopPropagation();
                    if (ke.key === 'Enter') { ke.preventDefault(); input.blur(); }
                    if (ke.key === 'Escape') {
                        ke.preventDefault();
                        if (input.parentNode) input.parentNode.replaceChild(labelEl, input);
                    }
                });

                labelEl.parentNode.replaceChild(input, labelEl);
                input.focus();
                input.select();
            });

            // Body — shows last Claude input, click to expand/collapse
            let bodyEl = document.createElement('span');
            bodyEl.className = 'banner-body';

            contextBanner.appendChild(labelEl);
            contextBanner.appendChild(bodyEl);

            // Expand/collapse on banner click (not on label)
            contextBanner.addEventListener('click', (e) => {
                e.stopPropagation();
                contextBanner.classList.toggle('expanded');
            });

            let xtermEl = document.getElementById(opts.parentId).querySelector('.xterm');
            if (xtermEl) {
                xtermEl.appendChild(contextBanner);
            } else {
                document.getElementById(opts.parentId).appendChild(contextBanner);
            }
            this._contextBanner = contextBanner;
            this._bannerBody = bodyEl;

            // Show banner immediately if a label was saved
            if (savedLabel) contextBanner.classList.add('visible');

            this.updateContextBanner = (text) => {
                if (!this._contextBanner || !text) return;
                this._bannerBody.textContent = '› ' + text;
                this._contextBanner.classList.remove('expanded');
                this._contextBanner.classList.add('visible');
            };

            this.Ipc.send("terminal_channel-" + this.port, "Renderer startup");
            this.Ipc.on("terminal_channel-" + this.port, (e, ...args) => {
                switch (args[0]) {
                    case "New cwd":
                        this.cwd = args[1];
                        this.oncwdchange(this.cwd);
                        break;
                    case "Fallback cwd":
                        this.cwd = "FALLBACK |-- " + args[1];
                        this.oncwdchange(this.cwd);
                        break;
                    case "New process":
                        if (this.onprocesschange) {
                            this.onprocesschange(args[1]);
                        }
                        break;
                    default:
                        return;
                }
            });
            this.resendCWD = () => {
                this.oncwdchange(this.cwd || null);
            };

            let sockHost = opts.host || "127.0.0.1";
            let sockPort = this.port;
            this._intentionallyClosed = false;
            this._reconnecting = false;
            this._reconnectTimer = null;
            this._attachAddon = null;
            this._systemSuspended = false;

            this._connectWebSocket = () => {
                this.socket = new WebSocket("ws://" + sockHost + ":" + sockPort);
                this.socket.onopen = () => {
                    // Dispose old AttachAddon if reconnecting
                    if (this._attachAddon) {
                        try { this._attachAddon.dispose(); } catch (e) { /* ignore */ }
                    }
                    this._attachAddon = new AttachAddon(this.socket);
                    this.term.loadAddon(this._attachAddon);
                    this.fit();
                    this.Ipc.send("terminal_channel-" + this.port, "Renderer startup");
                };
                this.socket.onerror = e => {
                    console.warn("[Terminal] WebSocket error on port " + sockPort + ":", e);
                };
                this.socket.onclose = e => {
                    if (this._intentionallyClosed) {
                        if (this.onclose) {
                            this.onclose(e);
                        }
                        return;
                    }
                    // Start reconnection attempts
                    this._reconnect();
                };

                this.lastSoundFX = Date.now();
                this._attachSocketMessageHandler();
            };

            this._attachSocketMessageHandler = () => {
                this.socket.addEventListener("message", e => {
                    let d = Date.now();

                    if (d - this.lastSoundFX > 30) {
                        if (window.passwordMode == "false")
                            window.audioManager.stdout.play();
                        this.lastSoundFX = d;
                    }
                    if (d - this.lastRefit > 10000) {
                        this.fit();
                    }

                    // See #397
                    if (!window.settings.experimentalGlobeFeatures) return;
                    let ips = e.data.match(/((25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)/g);
                    if (ips !== null && ips.length >= 1) {
                        ips = ips.filter((val, index, self) => { return self.indexOf(val) === index; });
                        ips.forEach(ip => {
                            window.mods.globe.addTemporaryConnectedMarker(ip);
                        });
                    }
                });
            };

            this._reconnect = () => {
                if (this._reconnecting || this._intentionallyClosed) return;
                if (this._systemSuspended) {
                    this._reconnecting = true;
                    return;
                }
                this._reconnecting = true;

                this.term.write('\r\n\x1b[33m\u26A0 Connection lost, reconnecting...\x1b[0m\r\n');

                let attempt = 0;
                const maxAttempts = 60;
                const maxDelay = 30000;

                const tryReconnect = () => {
                    if (this._intentionallyClosed || this._systemSuspended) {
                        return;
                    }
                    if (attempt >= maxAttempts) {
                        this._reconnecting = false;
                        this.term.write('\r\n\x1b[31m\u2717 Reconnection failed after ' + maxAttempts + ' attempts.\x1b[0m\r\n');
                        if (this.onclose) {
                            this.onclose({ code: 1006, reason: 'Reconnection exhausted' });
                        }
                        return;
                    }

                    attempt++;
                    let delay = Math.min(500 * Math.pow(2, attempt - 1), maxDelay);

                    this._reconnectTimer = setTimeout(() => {
                        if (this._intentionallyClosed || this._systemSuspended) {
                            return;
                        }

                        let ws = new WebSocket("ws://" + sockHost + ":" + sockPort);
                        ws.onopen = () => {
                            this._reconnecting = false;
                            this.socket = ws;
                            if (this._attachAddon) {
                                try { this._attachAddon.dispose(); } catch (e) { /* ignore */ }
                            }
                            this._attachAddon = new AttachAddon(this.socket);
                            this.term.loadAddon(this._attachAddon);
                            this.fit();
                            this.Ipc.send("terminal_channel-" + this.port, "Renderer startup");
                            this._attachSocketMessageHandler();
                            this.term.write('\r\n\x1b[32m\u2713 Reconnected.\x1b[0m\r\n');

                            this.socket.onclose = e => {
                                if (this._intentionallyClosed) {
                                    if (this.onclose) {
                                        this.onclose(e);
                                    }
                                    return;
                                }
                                this._reconnect();
                            };
                            this.socket.onerror = e => {
                                console.warn("[Terminal] WebSocket error on port " + sockPort + ":", e);
                            };
                        };
                        ws.onerror = () => {
                            // Will trigger onclose
                        };
                        ws.onclose = () => {
                            if (!this._reconnecting) return;
                            tryReconnect();
                        };
                    }, delay);
                };

                tryReconnect();
            };

            this._pauseForSleep = () => {
                this._systemSuspended = true;
                if (this._reconnectTimer) {
                    clearTimeout(this._reconnectTimer);
                    this._reconnectTimer = null;
                }
            };

            this._resumeFromSleep = () => {
                this._systemSuspended = false;
                if (!this._intentionallyClosed && this.socket &&
                    this.socket.readyState === WebSocket.OPEN) {
                    return;
                }
                if (this._reconnectTimer) {
                    clearTimeout(this._reconnectTimer);
                    this._reconnectTimer = null;
                }
                this._reconnecting = false;
                this._connectWebSocket();
            };

            // Initial connection
            this._connectWebSocket();

            let parent = document.getElementById(opts.parentId);
            parent.addEventListener("wheel", e => {
                this.term.scrollLines(Math.round(e.deltaY / 10));
            });
            this._lastTouchY = null;
            parent.addEventListener("touchstart", e => {
                this._lastTouchY = e.targetTouches[0].screenY;
            });
            parent.addEventListener("touchmove", e => {
                if (this._lastTouchY) {
                    let y = e.changedTouches[0].screenY;
                    let deltaY = y - this._lastTouchY;
                    this._lastTouchY = y;
                    this.term.scrollLines(-Math.round(deltaY / 10));
                }
            });
            parent.addEventListener("touchend", e => {
                this._lastTouch = null;
            });
            parent.addEventListener("touchcancel", e => {
                this._lastTouch = null;
            });

            document.querySelector(".xterm-helper-textarea").addEventListener("keydown", e => {
                if (e.key === "F11" && window.settings.allowWindowed) {
                    e.preventDefault();
                    window.toggleFullScreen();
                }
            });

            this.fit = () => {
                this.lastRefit = Date.now();
                const dims = fitAddon.proposeDimensions();
                if (!dims) return;
                let { cols, rows } = dims;

                // Apply custom fixes based on screen ratio, see #302
                let w = screen.width;
                let h = screen.height;
                let x = 1;
                let y = 0;

                function gcd(a, b) {
                    return (b == 0) ? a : gcd(b, a % b);
                }
                let d = gcd(w, h);

                if (d === 100) { y = 1; x = 3; }
                // if (d === 120) y = 1;
                if (d === 256) x = 2;

                if (window.settings.termFontSize < 15) y = y - 1;

                cols = cols + x;
                rows = rows + y;

                if (this.term.cols !== cols || this.term.rows !== rows) {
                    this.resize(cols, rows);
                }
            };

            this.resize = (cols, rows) => {
                this.term.resize(cols, rows);
                this._sendSizeToServer();
            };

            this.write = cmd => {
                this.socket.send(cmd);
            };

            this.writelr = cmd => {
                this.socket.send(cmd + "\r");
            };

            this.clipboard = {
                copy: () => {
                    if (!this.term.hasSelection()) return false;
                    document.execCommand("copy");
                    this.term.clearSelection();
                    this.clipboard.didCopy = true;
                },
                paste: () => {
                    this.write(remote.clipboard.readText());
                    this.clipboard.didCopy = false;
                },
                didCopy: false
            };

            this.close = () => {
                this._intentionallyClosed = true;
                if (this._reconnectTimer) {
                    clearTimeout(this._reconnectTimer);
                    this._reconnectTimer = null;
                }
                this._reconnecting = false;
                if (this.socket) {
                    this.socket.close();
                }
            };

        } else if (opts.role === "server") {

            this.Pty = require("node-pty");
            this.Websocket = require("ws").Server;
            this.Ipc = require("electron").ipcMain;

            this.renderer = null;
            this.port = opts.port || 3000;

            this._closed = false;
            this.onclosed = () => { };
            this.onopened = () => { };
            this.onresized = () => { };
            this.ondisconnected = () => { };

            this._disableCWDtracking = false;
            this._windowsCwdFromPrompt = null;
            this._lastPromptMatch = 0;

            this._parseWindowsCwdFromOutput = (data) => {
                // Match Windows prompt patterns
                // cmd.exe: "C:\path\to\dir>"
                // PowerShell: "PS C:\path\to\dir>"
                const patterns = [
                    /^PS ([A-Z]:\\[^>\r\n]*?)>\s*$/m,       // PowerShell
                    /^([A-Z]:\\[^>\r\n]*?)>\s*$/m,          // cmd.exe
                    /PS ([A-Z]:\\[^>\r\n]*?)> /m,           // PowerShell mid-line
                    /([A-Z]:\\[^>\r\n]*?)> /m,              // cmd.exe mid-line
                ];

                for (const pattern of patterns) {
                    const match = data.match(pattern);
                    if (match && match[1]) {
                        const cwd = match[1].trim();
                        // Validate it looks like a real path
                        if (cwd.length >= 3 && /^[A-Z]:\\/.test(cwd)) {
                            return cwd;
                        }
                    }
                }
                return null;
            };

            // Debug logging wrapper for CWD parsing
            this._debugLogCwdParse = (data, result) => {
                if (typeof window !== 'undefined' && window.settings && window.settings.debug) {
                    // Only log first 200 chars to avoid flooding console
                    const preview = data.length > 200 ? data.substring(0, 200) + '...' : data;
                    console.log("[Terminal] Parsing CWD from output:", preview.replace(/\r?\n/g, '\\n'));
                    if (result) {
                        console.log("[Terminal] Matched CWD:", result);
                    }
                }
            };

            this._getTtyCWD = tty => {
                return new Promise((resolve, reject) => {
                    let pid = tty._pid;
                    switch (require("os").type()) {
                        case "Linux":
                            require("fs").readlink(`/proc/${pid}/cwd`, (e, cwd) => {
                                if (e !== null) {
                                    reject(e);
                                } else {
                                    resolve(cwd);
                                }
                            });
                            break;
                        case "Darwin":
                            require("child_process").exec(`lsof -a -d cwd -p ${pid} | tail -1 | awk '{ for (i=9; i<=NF; i++) printf "%s ", $i }'`, (e, cwd) => {
                                if (e !== null) {
                                    reject(e);
                                } else {
                                    resolve(cwd.trim());
                                }
                            });
                            break;
                        case "Windows_NT":
                            // Use CWD parsed from prompt if available
                            if (this._windowsCwdFromPrompt) {
                                resolve(this._windowsCwdFromPrompt);
                            } else {
                                // Fall back to initial cwd - prompt-based detection will update later
                                reject(new Error("Waiting for prompt-based CWD detection"));
                            }
                            break;
                        default:
                            reject("Unsupported OS");
                    }
                });
            };
            this._getTtyProcess = tty => {
                return new Promise((resolve, reject) => {
                    let pid = tty._pid;
                    switch (require("os").type()) {
                        case "Linux":
                        case "Darwin":
                            require("child_process").exec(`ps -o comm --no-headers --sort=+pid -g ${pid} | tail -1`, (e, proc) => {
                                if (e !== null) {
                                    reject(e);
                                } else {
                                    resolve(proc.trim());
                                }
                            });
                            break;
                        default:
                            reject("Unsupported OS");
                    }
                });
            };
            this._nextTickUpdateTtyCWD = false;
            this._nextTickUpdateProcess = false;
            this._tick = setInterval(() => {
                if (this._nextTickUpdateTtyCWD && this._disableCWDtracking === false) {
                    this._nextTickUpdateTtyCWD = false;
                    this._getTtyCWD(this.tty).then(cwd => {
                        if (this.tty._cwd === cwd) return;
                        this.tty._cwd = cwd;
                        if (this.renderer) {
                            this.renderer.send("terminal_channel-" + this.port, "New cwd", cwd);
                        }
                    }).catch(e => {
                        if (!this._closed) {
                            console.log("Error while tracking TTY working directory: ", e);
                            this._disableCWDtracking = true;
                            try {
                                this.renderer.send("terminal_channel-" + this.port, "Fallback cwd", opts.cwd || process.env.PWD);
                            } catch (e) {
                                // renderer closed
                            }
                        }
                    });
                }

                if (this.renderer && this._nextTickUpdateProcess) {
                    this._nextTickUpdateProcess = false;
                    this._getTtyProcess(this.tty).then(process => {
                        if (this.tty._process === process) return;
                        this.tty._process = process;
                        if (this.renderer) {
                            this.renderer.send("terminal_channel-" + this.port, "New process", process);
                        }
                    }).catch(e => {
                        if (!this._closed) {
                            console.log("Error while retrieving TTY subprocess: ", e);
                            try {
                                this.renderer.send("terminal_channel-" + this.port, "New process", "");
                            } catch (e) {
                                // renderer closed
                            }
                        }
                    });
                }
            }, 1000);

            this.tty = this.Pty.spawn(opts.shell || "bash", (opts.params.length > 0 ? opts.params : (process.platform === "win32" ? [] : ["--login"])), {
                name: opts.env.TERM || "xterm-256color",
                cols: 80,
                rows: 24,
                cwd: opts.cwd || process.env.PWD,
                env: opts.env || process.env
            });

            this.tty.onExit((code, signal) => {
                this._closed = true;
                this.onclosed(code, signal);
            });

            // Persistent output buffer — captures tty data while no WS client is connected
            this._activeWs = null;
            this._pendingBuffer = [];
            this._pendingBufferSize = 0;
            const MAX_BUFFER_SIZE = 1024 * 1024; // 1 MB cap

            this._bufferData = (data) => {
                const len = typeof data === 'string' ? data.length : data.byteLength;
                this._pendingBuffer.push(data);
                this._pendingBufferSize += len;
                while (this._pendingBufferSize > MAX_BUFFER_SIZE && this._pendingBuffer.length > 0) {
                    const evicted = this._pendingBuffer.shift();
                    this._pendingBufferSize -= (typeof evicted === 'string' ? evicted.length : evicted.byteLength);
                }
            };

            this._persistentDataListener = this.tty.onData(data => {
                this._nextTickUpdateTtyCWD = true;
                this._nextTickUpdateProcess = true;

                if (require("os").type() === "Windows_NT") {
                    const parsed = this._parseWindowsCwdFromOutput(data);
                    this._debugLogCwdParse(data, parsed);
                    if (parsed && parsed !== this._windowsCwdFromPrompt) {
                        this._windowsCwdFromPrompt = parsed;
                        this.tty._cwd = parsed;
                        if (this.renderer) {
                            this.renderer.send("terminal_channel-" + this.port, "New cwd", parsed);
                        }
                    }
                }

                if (this._activeWs && this._activeWs.readyState === 1) {
                    try {
                        this._activeWs.send(data);
                    } catch (e) {
                        this._bufferData(data);
                    }
                } else {
                    this._bufferData(data);
                }
            });

            // Create WebSocket server with error handling for port conflicts
            try {
                this.wss = new this.Websocket({
                    port: this.port,
                    clientTracking: true,
                    verifyClient: info => {
                        // Clean stale connections first
                        for (const client of this.wss.clients) {
                            if (client.readyState !== 1 /* OPEN */) {
                                client.terminate();
                            }
                        }
                        // Allow if no active clients (reconnection case)
                        let activeClients = 0;
                        for (const client of this.wss.clients) {
                            if (client.readyState === 1) activeClients++;
                        }
                        return activeClients < 1;
                    }
                });

                // Handle async errors emitted by the WebSocketServer
                this.wss.on('error', (err) => {
                    console.error('[Terminal] WebSocketServer emitted error:', err);
                    // For EADDRINUSE, kill the pty - the caller will handle retry
                    if (err.code === 'EADDRINUSE') {
                        this.tty.kill();
                    }
                });
            } catch (wsError) {
                // Clean up the pty process before throwing
                this.tty.kill();
                // Re-throw with proper error code for retry logic in _boot.js
                if (wsError.code === 'EADDRINUSE') {
                    const portError = new Error(`Port ${this.port} is already in use`);
                    portError.code = 'EADDRINUSE';
                    throw portError;
                }
                throw wsError;
            }
            this.Ipc.on("terminal_channel-" + this.port, (e, ...args) => {
                switch (args[0]) {
                    case "Renderer startup":
                        this.renderer = e.sender;
                        if (!this._disableCWDtracking && this.tty._cwd) {
                            this.renderer.send("terminal_channel-" + this.port, "New cwd", this.tty._cwd);
                        }
                        if (this._disableCWDtracking) {
                            this.renderer.send("terminal_channel-" + this.port, "Fallback cwd", opts.cwd || process.env.PWD);
                        }
                        break;
                    case "Resize":
                        let cols = args[1];
                        let rows = args[2];
                        try {
                            this.tty.resize(Number(cols), Number(rows));
                        } catch (error) {
                            //Keep going, it'll work anyways.
                        }
                        if (typeof this.onresized === 'function') {
                            this.onresized(cols, rows);
                        }
                        break;
                    default:
                        return;
                }
            });
            this.wss.on("connection", ws => {
                this.onopened(this.tty._pid);
                this._activeWs = ws;

                // Flush any output buffered while disconnected
                if (this._pendingBuffer.length > 0) {
                    for (const chunk of this._pendingBuffer) {
                        try { ws.send(chunk); } catch (e) { break; }
                    }
                    this._pendingBuffer = [];
                    this._pendingBufferSize = 0;
                }

                ws.on("close", (code, reason) => {
                    if (this._activeWs === ws) {
                        this._activeWs = null;
                    }
                    this.ondisconnected(code, reason);
                });
                ws.on("message", msg => {
                    this.tty.write(msg);
                });
            });

            this.close = () => {
                if (this._persistentDataListener) {
                    this._persistentDataListener.dispose();
                    this._persistentDataListener = null;
                }
                this._activeWs = null;
                this._pendingBuffer = [];
                this._pendingBufferSize = 0;
                this.tty.kill();
                this._closed = true;
            };
        } else {
            throw "Unknown purpose";
        }
    }
}

module.exports = {
    Terminal
};
