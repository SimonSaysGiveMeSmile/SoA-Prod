// Disable eval()
window.eval = global.eval = function () {
    throw new Error("eval() is disabled for security reasons.");
};
// Security helper :)
window._escapeHtml = text => {
    if (text == null) return "";
    let map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    };
    return String(text).replace(/[&<>"']/g, m => { return map[m]; });
};
window._encodePathURI = uri => {
    return encodeURI(uri).replace(/#/g, "%23");
};
window._purifyCSS = str => {
    if (typeof str === "undefined") return "";
    if (typeof str !== "string") {
        str = str.toString();
    }
    return str.replace(/[<]/g, "");
};
window._delay = ms => {
    return new Promise((resolve, reject) => {
        setTimeout(resolve, ms);
    });
};

// Initiate basic error handling
window.onerror = (msg, path, line, col, error) => {
    document.getElementById("boot_screen").innerHTML += `${error} :  ${msg}<br/>==> at ${path}  ${line}:${col}`;
};

const path = require("path");
const fs = require("fs");
const electron = require("electron");
const remote = require("@electron/remote");
const ipc = electron.ipcRenderer;
const profiler = require("./performance/startupProfiler");
const { WidgetLoader } = require("./classes/widgetLoader.class");
const { DragManager } = require("./classes/dragManager.class");
const logFile = path.join(__dirname, '..', 'renderer_debug.log');
const log = (msg) => {
    try {
        fs.appendFileSync(logFile, `[${new Date().toISOString()}] ${msg}\n`);
    } catch (e) {
        // ignore
    }
    ipc.send("log", "info", msg);
};

log("[Renderer] Startup initiated - Direct Log");
try {
    profiler.mark('renderer-start');

    const settingsDir = remote.app.getPath("userData");
    log(`Settings dir: ${settingsDir}`);
    const themesDir = path.join(settingsDir, "themes");
    const keyboardsDir = path.join(settingsDir, "keyboards");
    const fontsDir = path.join(settingsDir, "fonts");
    const settingsFile = path.join(settingsDir, "settings.json");
    const shortcutsFile = path.join(settingsDir, "shortcuts.json");
    const lastWindowStateFile = path.join(settingsDir, "lastWindowState.json");
    const terminalNamesFile = path.join(settingsDir, "terminalNames.json");
    const bannerLabelsFile = path.join(settingsDir, "bannerLabels.json");

    // Load config
    try {
        log("Loading settings...");
        window.settings = require(settingsFile);
        log("Settings loaded");
    } catch (e) {
        log(`Error loading settings: ${e.message}`);
    }

    try {
        log("Loading shortcuts...");
        window.shortcuts = require(shortcutsFile);
        log("Shortcuts loaded");
    } catch (e) {
        log(`Error loading shortcuts: ${e.message}`);
    }

    try {
        log("Loading window state...");
        window.lastWindowState = require(lastWindowStateFile);
        log("Window state loaded");
    } catch (e) {
        log(`Error loading window state: ${e.message}`);
    }

    // Load terminal names with fallback to defaults (support up to 20 tabs)
    const defaultTerminalNames = {};
    for (let i = 0; i < 20; i++) {
        defaultTerminalNames[i] = i === 0 ? "MAIN SHELL" : "EMPTY";
    }
    try {
        if (fs.existsSync(terminalNamesFile)) {
            const saved = JSON.parse(fs.readFileSync(terminalNamesFile, 'utf-8'));
            window.terminalNames = Object.assign({}, defaultTerminalNames, saved);
        } else {
            window.terminalNames = defaultTerminalNames;
        }
    } catch (e) {
        console.error("Failed to load terminal names:", e);
        window.terminalNames = defaultTerminalNames;
    }

    window.saveTerminalNames = () => {
        try {
            fs.writeFileSync(terminalNamesFile, JSON.stringify(window.terminalNames, null, 4));
        } catch (e) {
            console.error("Failed to save terminal names:", e);
        }
    };

    // Banner labels — per-terminal session context, persisted
    try {
        if (fs.existsSync(bannerLabelsFile)) {
            window.bannerLabels = JSON.parse(fs.readFileSync(bannerLabelsFile, 'utf-8'));
        } else {
            window.bannerLabels = {};
        }
    } catch (e) {
        window.bannerLabels = {};
    }
    window.saveBannerLabels = () => {
        try {
            fs.writeFileSync(bannerLabelsFile, JSON.stringify(window.bannerLabels, null, 4));
        } catch (e) {
            console.error("Failed to save banner labels:", e);
        }
    };

    // Claude state tracking - maps terminal index to Claude session ID
    window.terminalSessions = {};  // { terminalIndex: sessionId }
    window.claudeState = null;     // Latest state from main process

    // Voice control instances
    window.voiceController = null;
    window.audioFeedback = null; // Audio feedback disabled - sounds removed
    window.waveformVisualizer = null;
    window.voiceToggleWidget = null;
    window.interimTranscription = null;
    window.activeTerminal = 0; // Track current terminal for voice integration
    window.micMonitor = null;

    // Browser tab tracking — tabType[i] = 'terminal' | 'browser', browserInstances[i] = BrowserTab
    window.tabType = {};
    window.browserInstances = {};

    // Ad overlay / thinking detection instances
    window.thinkingDetector = null;
    window.adOverlay = null;

    // Voice module imports (lazy loaded during initializeVoice)
    let VoiceController, VoiceState, WaveformVisualizer, VoiceToggleWidget, InterimTranscription;

    // IPC wrapper for voice (maps to electron.ipcRenderer)
    window.ipc = {
        invoke: (channel, ...args) => ipc.invoke(channel, ...args),
        send: (channel, ...args) => ipc.send(channel, ...args),
        on: (channel, callback) => {
            ipc.on(channel, (event, ...args) => callback(...args));
        },
    };

    // Forward main process voice debug logs to DevTools console
    ipc.on('voice:debug-log', (event, msg) => {
        console.log('%c[MAIN]', 'color: #ff9800; font-weight: bold', msg);
    });

    // Helper: generates the close button HTML for a tab
    window._tabCloseBtn = (index) => {
        return `<span class="tab-close" onclick="event.stopPropagation();window.closeShellTab(${index});" title="Close Tab">×</span>`;
    };

    window.enableTabRename = (tabIndex) => {
        const tabElement = document.getElementById(`shell_tab${tabIndex}`);
        if (!tabElement) return; // Tab doesn't exist yet (tabs 5-9)
        const textElement = tabElement.querySelector('p');
        if (!textElement) return;

        textElement.addEventListener('dblclick', (e) => {
            e.stopPropagation(); // Prevent tab switch
            // Hide close button during rename so it's not part of editable content
            const closeBtn = textElement.querySelector('.tab-close');
            if (closeBtn) closeBtn.style.display = 'none';
            textElement.setAttribute('contenteditable', 'true');
            textElement.focus();
            // Select only the text for easy replacement
            const range = document.createRange();
            const textNode = textElement.firstChild;
            if (textNode && textNode.nodeType === Node.TEXT_NODE) {
                range.selectNode(textNode);
            } else {
                range.selectNodeContents(textElement);
            }
            window.getSelection().removeAllRanges();
            window.getSelection().addRange(range);
        });

        textElement.addEventListener('blur', () => {
            textElement.removeAttribute('contenteditable');
            // Extract only text content, ignoring the close button span
            let newName = '';
            textElement.childNodes.forEach(node => {
                if (node.nodeType === Node.TEXT_NODE) newName += node.textContent;
            });
            newName = newName.trim().substring(0, 20);
            if (!newName) newName = tabIndex === 0 ? "MAIN SHELL" : "EMPTY";
            window.terminalNames[tabIndex] = newName;
            textElement.innerHTML = window._escapeHtml(newName) + window._tabCloseBtn(tabIndex);
            window.saveTerminalNames();
        });

        textElement.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                textElement.blur(); // Triggers save via blur handler
            } else if (e.key === 'Escape') {
                // Revert to saved name
                textElement.innerText = window.terminalNames[tabIndex];
                textElement.blur();
            }
        });
    };

    // Load CLI parameters
    if (remote.process.argv.includes("--nointro")) {
        window.settings.nointroOverride = true;
    } else {
        window.settings.nointroOverride = false;
    }
    if (remote.process.argv.includes("--nocursor")) {
        window.settings.nocursorOverride = true;
    } else {
        window.settings.nocursorOverride = false;
    }

    // Retrieve theme override (hotswitch)
    ipc.once("getThemeOverride", (e, theme) => {
        if (theme !== null) {
            window.settings.theme = theme;
            window.settings.nointroOverride = true;
            _loadTheme(require(path.join(themesDir, window.settings.theme + ".json")));
        } else {
            _loadTheme(require(path.join(themesDir, window.settings.theme + ".json")));
        }
    });
    ipc.send("getThemeOverride");
    // Same for keyboard override/hotswitch
    ipc.once("getKbOverride", (e, layout) => {
        if (layout !== null) {
            window.settings.keyboard = layout;
            window.settings.nointroOverride = true;
        }
    });
    ipc.send("getKbOverride");

    // Claude state updates from main process
    ipc.on('claude-state-update', (event, state) => {
        window.claudeState = state;

        // Map each active terminal to a Claude session based on CWD
        for (let i = 0; i < 5; i++) {
            if (window.term && window.term[i] && window.term[i].cwd) {
                const sessionId = findSessionForCwd(window.term[i].cwd, state.projects, state.liveContext);
                if (sessionId) {
                    window.terminalSessions[i] = sessionId;
                } else {
                    delete window.terminalSessions[i];
                }
            }
        }

        // Emit custom event for widgets to listen to (future phases)
        window.dispatchEvent(new CustomEvent('claude-state-changed', { detail: state }));
    });

    // Listen for terminal CWD changes to update session mappings
    window.addEventListener('terminal-cwd-changed', (event) => {
        const { terminal, cwd } = event.detail;
        if (!window.claudeState || !cwd) return;

        const sessionId = findSessionForCwd(cwd, window.claudeState.projects, window.claudeState.liveContext);
        if (sessionId) {
            window.terminalSessions[terminal] = sessionId;
        } else {
            delete window.terminalSessions[terminal];
        }

        // Re-emit state change so widgets refresh with new session mapping
        window.dispatchEvent(new CustomEvent('claude-state-changed', { detail: window.claudeState }));
    });

    // Helper: Find Claude session ID for a given CWD
    function findSessionForCwd(cwd, projects, liveContext) {
        if (!cwd) return null;

        const normalizedCwd = cwd.replace(/\\/g, '/').toLowerCase();

        // Prefer liveContext.session_id if CWD matches liveContext.project_dir
        if (liveContext && liveContext.session_id && liveContext.project_dir) {
            const normalizedLiveDir = liveContext.project_dir.replace(/\\/g, '/').toLowerCase();
            if (normalizedCwd.startsWith(normalizedLiveDir)) {
                return liveContext.session_id;
            }
        }

        // Fallback to lastSessionId from projects
        if (!projects) return null;

        let bestMatch = null;
        let bestMatchLen = 0;

        for (const [projPath, projData] of Object.entries(projects)) {
            const normalizedProj = projPath.replace(/\\/g, '/').toLowerCase();
            if (normalizedCwd.startsWith(normalizedProj) &&
                normalizedProj.length > bestMatchLen &&
                projData.lastSessionId) {
                bestMatch = projData.lastSessionId;
                bestMatchLen = normalizedProj.length;
            }
        }

        return bestMatch;
    }

    // Load UI theme
    window._loadTheme = theme => {

        if (document.querySelector("style.theming")) {
            document.querySelector("style.theming").remove();
        }

        // Load fonts
        let mainFont = new FontFace(theme.cssvars.font_main, `url("${path.join(fontsDir, theme.cssvars.font_main.toLowerCase().replace(/ /g, '_') + '.woff2').replace(/\\/g, '/')}")`);
        let lightFont = new FontFace(theme.cssvars.font_main_light, `url("${path.join(fontsDir, theme.cssvars.font_main_light.toLowerCase().replace(/ /g, '_') + '.woff2').replace(/\\/g, '/')}")`);
        let termFont = new FontFace(theme.terminal.fontFamily, `url("${path.join(fontsDir, theme.terminal.fontFamily.toLowerCase().replace(/ /g, '_') + '.woff2').replace(/\\/g, '/')}")`);

        document.fonts.add(mainFont);
        document.fonts.load("12px " + theme.cssvars.font_main);
        document.fonts.add(lightFont);
        document.fonts.load("12px " + theme.cssvars.font_main_light);
        document.fonts.add(termFont);
        document.fonts.load("12px " + theme.terminal.fontFamily);

        document.querySelector("head").innerHTML += `<style class="theming">
    :root {
        --font_main: "${window._purifyCSS(theme.cssvars.font_main)}";
        --font_main_light: "${window._purifyCSS(theme.cssvars.font_main_light)}";
        --font_mono: "${window._purifyCSS(theme.terminal.fontFamily)}";
        --color_r: ${window._purifyCSS(theme.colors.r)};
        --color_g: ${window._purifyCSS(theme.colors.g)};
        --color_b: ${window._purifyCSS(theme.colors.b)};
        --color_black: ${window._purifyCSS(theme.colors.black)};
        --color_light_black: ${window._purifyCSS(theme.colors.light_black)};
        --color_grey: ${window._purifyCSS(theme.colors.grey)};

        /* Used for error and warning modals */
        --color_red: ${window._purifyCSS(theme.colors.red) || "red"};
        --color_yellow: ${window._purifyCSS(theme.colors.yellow) || "yellow"};
    }

    body {
        font-family: var(--font_main), sans-serif;
        cursor: ${(window.settings.nocursorOverride || window.settings.nocursor) ? "none" : "default"} !important;
    }

    * {
   	   ${(window.settings.nocursorOverride || window.settings.nocursor) ? "cursor: none !important;" : ""}
	}

    ${window._purifyCSS(theme.injectCSS || "")}
    </style>`;

        window.theme = theme;
        window.theme.r = theme.colors.r;
        window.theme.g = theme.colors.g;
        window.theme.b = theme.colors.b;
    };

    function initGraphicalErrorHandling() {
        window.edexErrorsModals = [];

        // Network error codes that should not trigger PANIC modals
        const NETWORK_ERROR_CODES = ['ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'EPIPE', 'EAI_AGAIN'];

        const isNetworkError = (msg, error) => {
            const str = `${msg} ${error}`;
            return NETWORK_ERROR_CODES.some(code => str.includes(code));
        };

        // Catch Node.js EventEmitter errors (e.g. from third-party libs like geolite2-redist)
        process.on('uncaughtException', (error) => {
            if (error && isNetworkError(error.message || '', error.code || '')) {
                console.warn('[Renderer] Network error (suppressed):', error.message);
                ipc.send("log", "note", `Suppressed network error: ${error.message}`);
                return;
            }
            // Non-network errors: let window.onerror handle via re-throw
            throw error;
        });

        window.onerror = (msg, path, line, col, error) => {
            // Suppress PANIC modals for transient network errors
            if (isNetworkError(msg || '', error || '')) {
                console.warn('[Renderer] Network error (suppressed):', msg);
                ipc.send("log", "note", `Suppressed network error: ${msg}`);
                return true;  // Prevent default error handling
            }

            let errorModal = new Modal({
                type: "error",
                title: error,
                message: `${msg}<br/>        at ${path}  ${line}:${col}`
            });
            window.edexErrorsModals.push(errorModal);

            ipc.send("log", "error", `${error}: ${msg}`);
            ipc.send("log", "debug", `at ${path} ${line}:${col}`);
        };
    }

    function waitForFonts() {
        log("[Renderer] Waiting for fonts...");
        return new Promise(resolve => {
            const checkFonts = () => {
                log(`[Renderer] Checking fonts: readyState=${document.readyState}, fonts.status=${document.fonts.status}`);
                if (document.fonts.status === "loaded") {
                    log("[Renderer] Fonts loaded immediately/already");
                    resolve();
                } else {
                    document.fonts.ready.then(() => {
                        log("[Renderer] Fonts loaded via promise");
                        resolve();
                    });
                }
            };

            if (document.readyState === "complete") {
                checkFonts();
            } else {
                document.addEventListener("readystatechange", () => {
                    if (document.readyState === "complete") {
                        checkFonts();
                    }
                });
            }
        });
    }

    // A proxy function used to add multithreading to systeminformation calls - see backend process manager @ _multithread.js
    function initSystemInformationProxy() {
        const { nanoid } = require("nanoid/non-secure");

        window.si = new Proxy({}, {
            apply: () => { throw new Error("Cannot use sysinfo proxy directly as a function") },
            set: () => { throw new Error("Cannot set a property on the sysinfo proxy") },
            get: (target, prop, receiver) => {
                return function (...args) {
                    let callback = (typeof args[args.length - 1] === "function") ? true : false;

                    return new Promise((resolve, reject) => {
                        let id = nanoid();
                        let timeoutId = null;

                        const handler = (e, res) => {
                            clearTimeout(timeoutId);
                            if (callback) {
                                args[args.length - 1](res);
                            }
                            resolve(res);
                        };

                        ipc.once("systeminformation-reply-" + id, handler);
                        ipc.send("systeminformation-call", prop, id, ...args);

                        // 30 second timeout to prevent indefinite hangs
                        timeoutId = setTimeout(() => {
                            ipc.removeListener("systeminformation-reply-" + id, handler);
                            const error = new Error(`IPC timeout: systeminformation.${prop}() did not respond within 30s`);
                            console.error("[SI Proxy]", error.message);
                            reject(error);
                        }, 30000);
                    });
                };
            }
        });
        console.log("[SI Proxy] systeminformation proxy initialized");
    }

    // Initialize voice system
    async function initializeVoice() {
        console.log('[Voice] Initializing voice system...');

        try {
            // Lazy load voice modules
            const voiceControllerModule = require('./classes/voiceController.class');
            VoiceController = voiceControllerModule.VoiceController;
            VoiceState = voiceControllerModule.VoiceState;

            const waveformVisualizerModule = require('./classes/waveformVisualizer.class');
            WaveformVisualizer = waveformVisualizerModule.WaveformVisualizer;

            const voiceToggleWidgetModule = require('./classes/voiceToggleWidget.class');
            VoiceToggleWidget = voiceToggleWidgetModule.VoiceToggleWidget;

            const interimTranscriptionModule = require('./classes/interimTranscription.class');
            InterimTranscription = interimTranscriptionModule.InterimTranscription;

            // Create waveform visualizer
            window.waveformVisualizer = new WaveformVisualizer({ barCount: 32 });

            // Create interim transcription (Web Speech API)
            window.interimTranscription = new InterimTranscription({
                onInterim: (text) => {
                    // Wire interim results to waveform visualizer
                    if (window.waveformVisualizer) {
                        window.waveformVisualizer.showInterim(text);
                    }
                },
                onError: (error) => {
                    console.warn('[Voice] Interim transcription error:', error);
                },
            });

            // Create voice controller with callbacks
            window.voiceController = new VoiceController({
                maxRecordingMs: 60000,
                silenceTimeoutMs: window.settings.voiceSilenceTimeout || 2000,

                onStateChange: (state, oldState) => {
                    console.log('[Voice] State changed:', oldState, '->', state);

                    // Update tab bar mic button
                    const micBtn = document.getElementById('shell_mic_btn');
                    if (micBtn) {
                        micBtn.classList.remove('shell-mic-active', 'shell-mic-recording', 'shell-mic-processing');
                        if (state === VoiceState.RECORDING) {
                            micBtn.classList.add('shell-mic-active', 'shell-mic-recording');
                        } else if (state === VoiceState.PROCESSING) {
                            micBtn.classList.add('shell-mic-active', 'shell-mic-processing');
                        } else if (state === VoiceState.LISTENING) {
                            micBtn.classList.add('shell-mic-active');
                        }
                    }

                    // Update InputComposer voice button if present
                    const inputComposerVoiceBtn = document.querySelector('.inputcomposer-voice-btn');
                    if (inputComposerVoiceBtn) {
                        inputComposerVoiceBtn.classList.remove('recording', 'processing');
                        if (state === VoiceState.RECORDING) {
                            inputComposerVoiceBtn.classList.add('recording');
                        } else if (state === VoiceState.PROCESSING) {
                            inputComposerVoiceBtn.classList.add('processing');
                        }
                    }

                    // Update toggle widget
                    if (window.voiceToggleWidget) {
                        if (state === VoiceState.RECORDING) {
                            window.voiceToggleWidget.showRecording();
                        } else if (state === VoiceState.PROCESSING) {
                            window.voiceToggleWidget.showProcessing();
                        } else {
                            window.voiceToggleWidget.resetState();
                        }
                    }

                    // Show/hide waveform and manage interim transcription
                    if (state === VoiceState.RECORDING) {
                        const activeTerminal = window.currentTerm || 0;
                        window.waveformVisualizer.show(activeTerminal);
                        // Start Web Speech API for interim results (skip for on-device — it has its own)
                        if (window.interimTranscription && !window.voiceController.useOnDevice) {
                            window.interimTranscription.start();
                        }
                    } else if (state === VoiceState.PROCESSING && oldState === VoiceState.RECORDING) {
                        // Show loading animation with progress estimate
                        const durationMs = window.voiceController.getRecordingDurationMs();
                        window.waveformVisualizer.showProcessing(durationMs);
                        // Stop Web Speech API
                        if (window.interimTranscription && !window.voiceController.useOnDevice) {
                            window.interimTranscription.stop();
                        }
                    } else if (oldState === VoiceState.PROCESSING) {
                        window.waveformVisualizer.hide();
                    } else if (oldState === VoiceState.RECORDING) {
                        window.waveformVisualizer.hide();
                        // Stop Web Speech API
                        if (window.interimTranscription && !window.voiceController.useOnDevice) {
                            window.interimTranscription.stop();
                        }
                    }
                },

                onWakeDetected: () => {
                    console.log('[Voice] Wake word detected');
                },

                onTranscription: (text, success) => {
                    if (success && text) {
                        insertTranscriptionIntoTerminal(text);
                    }
                },

                onAudioLevel: (level, freqLevels) => {
                    if (window.waveformVisualizer) {
                        window.waveformVisualizer.updateLevels(freqLevels);
                    }
                },

                onError: (error) => {
                    console.error('[Voice] Error:', error);
                },

                onInterimTranscription: (text) => {
                    if (window.waveformVisualizer) {
                        window.waveformVisualizer.showInterim(text);
                    }
                },
            });

            const initialized = await window.voiceController.initialize();

            // Create toggle widget in right column
            const rightColumn = document.querySelector('#mod_column_right');
            if (rightColumn) {
                window.voiceToggleWidget = new VoiceToggleWidget(window.voiceController);
                window.voiceToggleWidget.create(rightColumn);

                if (!initialized) {
                    window.voiceToggleWidget.showUnavailable();
                }

                // Mic monitor — live waveform for diagnostics
                const { MicMonitor } = require('./classes/micMonitor.class');
                window.micMonitor = new MicMonitor('mod_column_right');

                // Register with DragManager (created after initial scan)
                if (window.dragManager && window.micMonitor._wrapperEl) {
                    window.dragManager.register(window.micMonitor._wrapperEl);
                }
            }

            console.log('[Voice] Voice system initialized:', initialized ? 'SUCCESS' : 'UNAVAILABLE');
        } catch (error) {
            console.error('[Voice] Voice system initialization failed:', error.message);
        }
    }

    function insertTranscriptionIntoTerminal(text) {
        // Check if InputComposer (text box) is active - insert there instead
        const textarea = document.getElementById("inputcomposer_textarea");
        if (textarea) {
            // Insert at cursor position
            const start = textarea.selectionStart;
            const end = textarea.selectionEnd;
            const before = textarea.value.substring(0, start);
            const after = textarea.value.substring(end);
            textarea.value = before + text + after;
            // Move cursor after inserted text
            const newPos = start + text.length;
            textarea.selectionStart = newPos;
            textarea.selectionEnd = newPos;
            textarea.dispatchEvent(new Event('input', { bubbles: true }));
            console.log('[Voice] Inserted transcription into InputComposer:', text);
            return;
        }

        const activeTerminal = window.currentTerm || 0;

        if (window.term && window.term[activeTerminal]) {
            const terminal = window.term[activeTerminal];
            if (terminal.socket && terminal.socket.readyState === WebSocket.OPEN) {
                terminal.write(text);
                console.log('[Voice] Sent transcription to terminal', activeTerminal, ':', text);
            } else {
                console.warn('[Voice] Terminal socket not open for index', activeTerminal);
            }
            return;
        }

        console.warn('[Voice] Could not find terminal for index', activeTerminal);
    }

    // Init audio
    window.audioManager = new AudioManager();

    // See #223
    remote.app.focus();

    let i = 0;
    if (window.settings.nointro || window.settings.nointroOverride) {
        initGraphicalErrorHandling();
        initSystemInformationProxy();
        document.getElementById("boot_screen").remove();
        document.body.setAttribute("class", "");
        waitForFonts().then(() => {
            log("[Renderer] Fonts ready, starting UI init");
            initUI();
        }).catch(e => {
            log(`[Renderer] Font loading failed: ${e.message}`);
        });
    } else {
        displayLine();
    }

    // Startup boot log
    function displayLine() {
        profiler.mark('boot-animation-start');
        let bootScreen = document.getElementById("boot_screen");
        let log = fs.readFileSync(path.join(__dirname, "assets", "misc", "boot_log.txt")).toString().split('\n');

        function isArchUser() {
            return require("os").platform() === "linux"
                && fs.existsSync("/etc/os-release")
                && fs.readFileSync("/etc/os-release").toString().includes("arch");
        }

        if (typeof log[i] === "undefined") {
            setTimeout(displayTitleScreen, 300);
            return;
        }

        if (log[i] === "Boot Complete") {
            window.audioManager.granted.play();
        } else {
            window.audioManager.stdout.play();
        }
        bootScreen.innerHTML += log[i] + "<br/>";
        i++;

        switch (true) {
            case i === 2:
                bootScreen.innerHTML += `Son of Anton Kernel version ${remote.app.getVersion()} boot at ${Date().toString()}; root:xnu-1699.22.73~1/RELEASE_X86_64`;
            case i === 4:
                setTimeout(displayLine, 500);
                break;
            case i > 4 && i < 25:
                setTimeout(displayLine, 30);
                break;
            case i === 25:
                setTimeout(displayLine, 400);
                break;
            case i === 42:
                setTimeout(displayLine, 300);
                break;
            case i > 42 && i < 82:
                setTimeout(displayLine, 25);
                break;
            case i === 83:
                if (isArchUser())
                    bootScreen.innerHTML += "btw i use arch<br/>";
                setTimeout(displayLine, 25);
                break;
            case i >= log.length - 2 && i < log.length:
                setTimeout(displayLine, 300);
                break;
            default:
                setTimeout(displayLine, Math.pow(1 - (i / 1000), 3) * 25);
        }
    }

    // Show "logo" and background grid
    async function displayTitleScreen() {
        let bootScreen = document.getElementById("boot_screen");
        if (bootScreen === null) {
            bootScreen = document.createElement("section");
            bootScreen.setAttribute("id", "boot_screen");
            bootScreen.setAttribute("style", "z-index: 9999999");
            document.body.appendChild(bootScreen);
        }
        bootScreen.innerHTML = "";
        window.audioManager.theme.play();

        await _delay(400);

        document.body.setAttribute("class", "");
        bootScreen.setAttribute("class", "center");
        bootScreen.innerHTML = "<h1>Son of Anton</h1>";
        let title = document.querySelector("section > h1");

        await _delay(200);

        document.body.setAttribute("class", "solidBackground");

        await _delay(100);

        title.setAttribute("style", `background-color: rgb(${window.theme.r}, ${window.theme.g}, ${window.theme.b});border-bottom: 5px solid rgb(${window.theme.r}, ${window.theme.g}, ${window.theme.b});`);

        await _delay(300);

        title.setAttribute("style", `border: 5px solid rgb(${window.theme.r}, ${window.theme.g}, ${window.theme.b});`);

        await _delay(100);

        title.setAttribute("style", "");
        title.setAttribute("class", "glitch");

        await _delay(500);

        document.body.setAttribute("class", "");
        title.setAttribute("class", "");
        title.setAttribute("style", `border: 5px solid rgb(${window.theme.r}, ${window.theme.g}, ${window.theme.b});`);

        await _delay(1000);
        profiler.mark('boot-animation-end');
        profiler.measure('boot-animation', 'boot-animation-start', 'boot-animation-end');
        if (window.term) {
            bootScreen.remove();
            return true;
        }
        initGraphicalErrorHandling();
        initSystemInformationProxy();
        waitForFonts().then(() => {
            bootScreen.remove();
            initUI();
        });
    }

    // Returns the user's desired display name
    async function getDisplayName() {
        let user = settings.username || null;
        if (user)
            return user;

        try {
            user = await require("username")();
        } catch (e) {
            if (window.settings && window.settings.debug) {
                console.warn("[Renderer] Username fetch failed:", e.message);
            }
        }

        return user;
    }

    // Create the UI's html structure and initialize the terminal client and the keyboard
    async function initUI() {
        document.body.innerHTML += `<section class="mod_column" id="mod_column_left">
        <h3 class="title"><p>PANEL</p><p>SYSTEM</p></h3>
    </section>
    <section id="main_shell" style="height:0%;width:0%;opacity:0;margin-bottom:0vh;" augmented-ui="bl-clip tr-clip exe">
        <h3 class="title" style="opacity:0;"><p>TERMINAL</p><p>MAIN SHELL</p></h3>
        <h1 id="main_shell_greeting"></h1>
    </section>
    <section class="mod_column" id="mod_column_right">
        <h3 class="title"><p>PANEL</p><p>NETWORK</p></h3>
    </section>`;

        profiler.mark('ui-structure-created');
        profiler.measure('ui-structure', 'renderer-start', 'ui-structure-created');
        profiler.measure('renderer-init', 'renderer-start', 'ui-structure-created');
        ipc.send("log", "info", "[Renderer] UI structure created");

        await _delay(10);

        window.audioManager.expand.play();
        document.getElementById("main_shell").setAttribute("style", "height:0%;margin-bottom:0vh;");

        await _delay(500);

        document.getElementById("main_shell").setAttribute("style", "margin-bottom: 0vh;");
        document.querySelector("#main_shell > h3.title").setAttribute("style", "");

        await _delay(700);

        document.getElementById("main_shell").setAttribute("style", "opacity: 0;");
        document.getElementById("main_shell").setAttribute("style", "opacity: 0;");
        /* Minimal Redesign: Removed Filesystem and Keyboard sections
        document.body.innerHTML += `
        <section id="filesystem" style="width: 0px;" class="${window.settings.hideDotfiles ? "hideDotfiles" : ""} ${window.settings.fsListView ? "list-view" : ""}">
        </section>
        <section id="keyboard" style="opacity:0;">
        </section>`;
        */
        /* Minimal Redesign: Disabled Keyboard initialization
        window.keyboard = new Keyboard({
            layout: path.join(keyboardsDir, settings.keyboard + ".json"),
            container: "keyboard"
        });
        */

        await _delay(10);

        document.getElementById("main_shell").setAttribute("style", "");

        await _delay(270);

        let greeter = document.getElementById("main_shell_greeting");

        getDisplayName().then(user => {
            if (user) {
                greeter.innerHTML += `Welcome back, <em>${user}</em>`;
            } else {
                greeter.innerHTML += "Welcome back";
            }
        });

        greeter.setAttribute("style", "opacity: 1;");

        // document.getElementById("filesystem").setAttribute("style", "");
        // document.getElementById("keyboard").setAttribute("style", "");
        // document.getElementById("keyboard").setAttribute("class", "animation_state_1");
        // window.audioManager.keyboard.play();

        await _delay(100);

        // document.getElementById("keyboard").setAttribute("class", "animation_state_1 animation_state_2");

        await _delay(1000);

        greeter.setAttribute("style", "opacity: 0;");

        await _delay(100);

        // document.getElementById("keyboard").setAttribute("class", "");

        await _delay(400);

        greeter.remove();

        // Initialize the terminal FIRST (critical path for interactivity)
        profiler.mark('terminal-init-start');
        let shellContainer = document.getElementById("main_shell");

        // Generate initial 5 tabs dynamically
        let tabsHtml = '';
        for (let i = 0; i < 5; i++) {
            tabsHtml += `<li id="shell_tab${i}" onclick="window.focusShellTab(${i});"${i === 0 ? ' class="active"' : ''}><p>${window._escapeHtml(window.terminalNames[i])}<span class="tab-close" onclick="event.stopPropagation();window.closeShellTab(${i});" title="Close Tab">×</span></p></li>`;
        }
        // Add + button for creating new tabs (up to 10 total)
        tabsHtml += `<li id="shell_add_tab" class="shell-add-tab" onclick="window.addShellTab();" title="New Terminal Tab (Ctrl+Shift+T)"><p>+</p></li>`;
        tabsHtml += `<li id="shell_browser_btn" class="shell-browser-btn" onclick="window.addBrowserShellTab();" title="New Browser Tab"><p>&#127760;</p></li>`;

        shellContainer.innerHTML += `
        <ul id="main_shell_tabs">
            ${tabsHtml}
            <li id="shell_mic_btn" class="shell-dev-btn shell-mic-btn" onclick="window.toggleMic();" title="Toggle Microphone"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg></li>
            <li id="shell_permission_btn" class="shell-dev-btn shell-permission-btn" onclick="window.cyclePermissionMode();" title="Permission Mode: ${window.settings.permissionMode || 'default'}" data-mode="${window.settings.permissionMode || 'default'}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg></li>
            <li id="shell_settings_btn" class="shell-dev-btn" onclick="window.openSettings();" title="Settings"><p>⚙</p></li>
            <li id="shell_power_btn" class="shell-dev-btn shell-power-btn" onclick="window.togglePowerMenu(event);" title="Power Menu"><p>⏻</p>
                <ul id="shell_power_menu" class="power-menu hidden">
                    <li onclick="event.stopPropagation(); window.powerReloadUI();">⟳ Reload UI</li>
                    <li onclick="event.stopPropagation(); window.powerRestart();">↻ Restart</li>
                    <li onclick="event.stopPropagation(); window.powerQuit();">⏼ Quit</li>
                </ul>
            </li>
        </ul>
        <div id="main_shell_innercontainer">
            <pre id="terminal0" class="active"></pre>
            <pre id="terminal1"></pre>
            <pre id="terminal2"></pre>
            <pre id="terminal3"></pre>
            <pre id="terminal4"></pre>
        </div>
        <div id="browser_container"></div>`;
        window.term = {
            0: new Terminal({
                role: "client",
                parentId: "terminal0",
                port: window.settings.port || 3000
            })
        };
        window.currentTerm = 0;
        window.tabType[0] = 'terminal';
        window.autoCompose = true;
        window.term[0].onprocesschange = p => {
            window.term[0]._lastProcess = p;
            // Only show process name if user hasn't set a custom name
            if (window.terminalNames[0] === "MAIN SHELL") {
                document.getElementById("shell_tab0").querySelector('p').innerHTML = `MAIN - ${p}${window._tabCloseBtn(0)}`;
            }
        };
        profiler.mark('terminal-ready');
        profiler.measure('terminal-creation', 'terminal-init-start', 'terminal-ready');
        profiler.measure('terminal-client', 'terminal-init-start', 'terminal-ready');
        // Enable rename on all tabs (up to 20)
        for (let i = 0; i < 20; i++) {
            window.enableTabRename(i);
        }
        // Prevent losing hardware keyboard focus on the terminal when using touch keyboard
        window.onmouseup = e => {
            // if (window.keyboard.linkedToTerm) window.term[window.currentTerm].term.focus();
        };
        window.term[0].term.writeln("\x1b[1m" + `Welcome to Son of Anton v${remote.app.getVersion()} - Electron v${process.versions.electron}` + "\x1b[0m");

        // System suspend/resume handling for sleep/wake reconnection
        ipc.on('system-suspend', () => {
            window._systemSuspended = true;
            Object.keys(window.term).forEach(idx => {
                if (window.term[idx] && window.term[idx].term) {
                    window.term[idx].term.write('\r\n\x1b[33m\u26A0 System sleeping...\x1b[0m\r\n');
                }
            });
        });

        ipc.on('system-resume', () => {
            window._systemSuspended = false;
            // Give the network stack a moment to come back
            setTimeout(() => {
                Object.keys(window.term).forEach(idx => {
                    if (window.term[idx] && window.term[idx]._reconnect) {
                        window.term[idx]._reconnect();
                    }
                });
            }, 1000);
        });

        // Save terminal state before unload for hot-reload preservation
        window.addEventListener("beforeunload", () => {
            // Release voice/mic resources so the audio channel is freed
            if (window.voiceController) {
                window.voiceController.release();
            }
            if (window.micMonitor) {
                window.micMonitor.release();
            }

            let ports = {};
            let buffers = {};
            Object.keys(window.term).forEach(idx => {
                if (window.term[idx] && window.term[idx].port) {
                    ports[idx] = window.term[idx].port;
                }
                if (window.term[idx] && window.term[idx].term) {
                    let buf = window.term[idx].term.buffer.active;
                    let lines = [];
                    for (let i = 0; i < buf.length; i++) {
                        let line = buf.getLine(i);
                        if (line) lines.push(line.translateToString(true));
                    }
                    buffers[idx] = lines.join("\r\n");
                }
            });
            sessionStorage.setItem("terminalPorts", JSON.stringify(ports));
            sessionStorage.setItem("terminalBuffers", JSON.stringify(buffers));
            sessionStorage.setItem("currentTerm", String(window.currentTerm));
        });

        // Restore extra terminals on hot-reload
        (function restoreTerminals() {
            let savedPorts = sessionStorage.getItem("terminalPorts");
            if (!savedPorts) return;

            let ports = JSON.parse(savedPorts);
            let buffers = JSON.parse(sessionStorage.getItem("terminalBuffers") || "{}");
            let savedCurrentTerm = parseInt(sessionStorage.getItem("currentTerm") || "0", 10);
            sessionStorage.removeItem("terminalPorts");
            sessionStorage.removeItem("terminalBuffers");
            sessionStorage.removeItem("currentTerm");

            ipc.send("ttylist");
            ipc.once("ttylist-reply", (e, alivePorts) => {
                Object.keys(ports).forEach(key => {
                    let idx = Number(key);
                    if (idx === 0) return;
                    let port = Number(ports[key]);
                    if (!alivePorts[port]) return;

                    try {
                        window.term[idx] = new Terminal({
                            role: "client",
                            parentId: "terminal" + idx,
                            port: port
                        });
                    } catch (termErr) {
                        console.error('[Tabs] Failed to restore terminal for tab ' + idx + ':', termErr);
                        return;
                    }

                    if (buffers[key]) {
                        window.term[idx].term.write(buffers[key]);
                    }

                    window.term[idx].onclose = () => {
                        delete window.term[idx].onprocesschange;
                        if (window.thinkingDetector) {
                            window.thinkingDetector.detach(idx);
                        }
                        window.terminalNames[idx] = "EMPTY";
                        window.saveTerminalNames();
                        document.getElementById("shell_tab" + idx).innerHTML = `<p>EMPTY${window._tabCloseBtn(idx)}</p>`;
                        document.getElementById("terminal" + idx).innerHTML = "";
                        window.term[idx].term.dispose();
                        delete window.term[idx];
                        window.useAppShortcut("PREVIOUS_TAB");
                    };

                    window.term[idx].onprocesschange = p => {
                        window.term[idx]._lastProcess = p;
                        const currentName = window.terminalNames[idx];
                        if (!currentName || currentName === "EMPTY" || currentName.startsWith('#')) {
                            document.getElementById("shell_tab" + idx).querySelector('p').innerHTML = `#${idx + 1} - ${p}${window._tabCloseBtn(idx)}`;
                        }
                    };

                    document.getElementById("shell_tab" + idx).innerHTML = `<p>::${port}${window._tabCloseBtn(idx)}</p>`;
                    window.enableTabRename(idx);

                    if (window.thinkingDetector && window.term[idx].socket) {
                        const doAttach = () => {
                            if (window.term[idx].socket.readyState === WebSocket.OPEN) {
                                window.thinkingDetector.attach(idx, window.term[idx].socket);
                            } else {
                                window.term[idx].socket.addEventListener('open', () => {
                                    window.thinkingDetector.attach(idx, window.term[idx].socket);
                                }, { once: true });
                            }
                        };
                        doAttach();
                    }
                });

                if (savedCurrentTerm > 0 && window.term[savedCurrentTerm]) {
                    setTimeout(() => {
                        window.focusShellTab(savedCurrentTerm);
                    }, 500);
                }
            });
        })();

        // Terminal image preview — drag-and-drop & clipboard paste
        (function initTerminalImagePreview() {
            const container = document.getElementById("main_shell_innercontainer");
            if (!container) return;

            const imageExts = /\.(png|jpe?g|gif|bmp|webp|svg|ico|tiff?)$/i;

            function showImagePreview(src, label) {
                // Remove any existing preview
                dismissPreview();

                const overlay = document.createElement("div");
                overlay.className = "terminal-image-preview";
                overlay.innerHTML = `
                    <div class="img-preview-inner">
                        <span class="img-preview-close">✕</span>
                        <img src="${src}" ondragstart="return false;">
                        <div class="img-preview-label">${window._escapeHtml(label)}</div>
                    </div>`;

                overlay.addEventListener("click", e => {
                    if (e.target === overlay || e.target.classList.contains("img-preview-close")) {
                        dismissPreview();
                    }
                });

                container.appendChild(overlay);
            }

            function dismissPreview() {
                const existing = container.querySelector(".terminal-image-preview");
                if (existing) existing.remove();
            }

            // Expose globally so other parts can trigger previews
            window.showTerminalImagePreview = showImagePreview;
            window.dismissTerminalImagePreview = dismissPreview;

            // Dismiss on Escape key
            document.addEventListener("keydown", e => {
                if (e.key === "Escape") dismissPreview();
            });

            // --- Drag and drop ---
            let dragCounter = 0;

            container.addEventListener("dragenter", e => {
                e.preventDefault();
                dragCounter++;
                container.classList.add("drag-over");
            });

            container.addEventListener("dragover", e => {
                e.preventDefault();
            });

            container.addEventListener("dragleave", e => {
                dragCounter--;
                if (dragCounter <= 0) {
                    dragCounter = 0;
                    container.classList.remove("drag-over");
                }
            });

            container.addEventListener("drop", e => {
                e.preventDefault();
                dragCounter = 0;
                container.classList.remove("drag-over");

                const files = e.dataTransfer.files;
                if (!files || files.length === 0) return;

                for (let i = 0; i < files.length; i++) {
                    const file = files[i];
                    if (file.type.startsWith("image/") || imageExts.test(file.name)) {
                        showImagePreview(
                            "file://" + file.path.replace(/#/g, "%23"),
                            file.name + " — " + formatBytes(file.size)
                        );
                        // Insert the file path into the active terminal
                        if (window.term && window.term[window.currentTerm]) {
                            window.term[window.currentTerm].write(file.path.includes(" ") ? `"${file.path}"` : file.path);
                        }
                        break; // Preview first image only
                    }
                }
            });

            // --- Clipboard paste for images ---
            container.addEventListener("paste", e => {
                const items = (e.clipboardData || {}).items;
                if (!items) return;

                for (let i = 0; i < items.length; i++) {
                    if (items[i].type.startsWith("image/")) {
                        e.preventDefault();
                        const blob = items[i].getAsFile();
                        if (!blob) return;

                        // Save to temp file and show preview
                        const reader = new FileReader();
                        reader.onload = () => {
                            const dataUrl = reader.result;
                            const ext = blob.type.split("/")[1] || "png";
                            const tmpDir = require("os").tmpdir();
                            const tmpPath = require("path").join(tmpDir, `clipboard_${Date.now()}.${ext}`);

                            // Write the buffer to a temp file
                            const buf = Buffer.from(dataUrl.split(",")[1], "base64");
                            require("fs").writeFile(tmpPath, buf, err => {
                                if (err) {
                                    console.error("[ImagePreview] Failed to save clipboard image:", err);
                                    return;
                                }
                                showImagePreview(dataUrl, "Clipboard image → " + tmpPath);
                                if (window.term && window.term[window.currentTerm]) {
                                    window.term[window.currentTerm].write(tmpPath.includes(" ") ? `"${tmpPath}"` : tmpPath);
                                }
                            });
                        };
                        reader.readAsDataURL(blob);
                        break;
                    }
                }
            });

            function formatBytes(bytes) {
                if (bytes < 1024) return bytes + " B";
                if (bytes < 1048576) return (bytes / 1024).toFixed(1) + " KB";
                return (bytes / 1048576).toFixed(1) + " MB";
            }

            console.log("[Startup] Terminal image preview initialized (drag-drop + clipboard)");
        })();

        // Initialize thinking detector and ad overlay system (INT-01, INT-02)
        const adOverlayEnabled = window.settings.adOverlayEnabled !== false;
        const adOverlayMode = window.settings.adOverlayMode || 'corner';
        const adDebounceMs = window.settings.adDebounceMs || 300;
        const adTimeoutMs = window.settings.adTimeoutMs || 30000;

        // Credit display widget in right column
        if (!window.mods) window.mods = {};
        window.mods.creditDisplay = new CreditDisplay("mod_column_right");

        // Thinking detector (DET-01 through DET-06)
        // Always enabled — serves both ad overlay and permission mode
        window.thinkingDetector = new ThinkingDetector({
            enabled: true,
            debounceMs: adDebounceMs,
            timeoutMs: adTimeoutMs
        });

        // Ad overlay (UI-01 through UI-05)
        // Load ad images from assets/ads/ folder if any exist
        const adsDir = require("path").join(__dirname, "assets", "ads");
        let adImageUrls = [];
        try {
            const fs = require("fs");
            if (fs.existsSync(adsDir)) {
                adImageUrls = fs.readdirSync(adsDir)
                    .filter(f => /\.(png|jpg|jpeg|gif|svg|webp)$/i.test(f))
                    .map(f => require("path").join(adsDir, f));
            }
        } catch (e) { /* no ads folder or read error — use placeholder */ }

        window.adOverlay = new AdOverlay({
            enabled: adOverlayEnabled,
            mode: adOverlayMode,
            creditSystem: window.mods.creditDisplay,
            imageUrls: adImageUrls
        });
        window.adOverlay.init();

        // Attach detector to main terminal's WebSocket
        if (window.term[0].socket) {
            const attachWhenReady = () => {
                if (window.term[0].socket.readyState === WebSocket.OPEN) {
                    window.thinkingDetector.attach(0, window.term[0].socket);
                } else {
                    window.term[0].socket.addEventListener('open', () => {
                        window.thinkingDetector.attach(0, window.term[0].socket);
                    }, { once: true });
                }
            };
            attachWhenReady();
        }

        // Test/demo functions — call from DevTools console (no app restart needed)
        window.testAdOverlay = (durationMs = 10000) => {
            if (!window.thinkingDetector || !window.adOverlay) {
                console.warn('[AdOverlay] System not initialized');
                return;
            }
            window.adOverlay.setEnabled(true);
            window.thinkingDetector.configure({ enabled: true });

            const termIdx = window.currentTerm || 0;
            console.log(`[AdOverlay] Simulating ${durationMs}ms thinking on terminal ${termIdx} (mode: ${window.adOverlay.mode})...`);

            window.dispatchEvent(new CustomEvent('thinking-state-changed', {
                detail: { terminalIndex: termIdx, isThinking: true, method: 'test' }
            }));

            setTimeout(() => {
                window.dispatchEvent(new CustomEvent('thinking-state-changed', {
                    detail: { terminalIndex: termIdx, isThinking: false, method: null }
                }));
                console.log('[AdOverlay] Test complete');
            }, durationMs);
        };

        window.testAdMode = (mode) => {
            if (!window.adOverlay) return;
            window.adOverlay.setMode(mode);
            console.log(`[AdOverlay] Switched to ${mode} mode`);
            window.testAdOverlay();
        };

        window.testAdReload = () => {
            try {
                const fs = require("fs");
                const p = require("path");
                const dir = p.join(__dirname, "assets", "ads");
                if (!fs.existsSync(dir)) {
                    console.warn(`[AdOverlay] No ads folder at ${dir} — create it and add images`);
                    return;
                }
                const urls = fs.readdirSync(dir)
                    .filter(f => /\.(png|jpg|jpeg|gif|svg|webp)$/i.test(f))
                    .map(f => p.join(dir, f));
                window.adOverlay.setImageUrls(urls);
                console.log(`[AdOverlay] Loaded ${urls.length} images from ${dir}`);
                if (urls.length > 0) console.log('[AdOverlay] Files:', urls.map(u => p.basename(u)));
            } catch (e) {
                console.error('[AdOverlay] Reload failed:', e);
            }
        };

        // Cycle ad mode — call window.toggleAdMode() from DevTools console
        window.toggleAdMode = () => {
            if (!window.adOverlay) return;
            const modes = ['corner', 'fullscreen', 'panel'];
            const idx = modes.indexOf(window.adOverlay.mode);
            const newMode = modes[(idx + 1) % modes.length];
            window.adOverlay.setMode(newMode);
            console.log(`[AdOverlay] Switched to ${newMode} mode`);
        };

        // Test tab status indicator — call window.testTabStatus(0, 'running') from DevTools
        window.testTabStatus = (tabIndex = 0, status = 'running') => {
            const valid = ['running', 'input', 'completed', 'idle', 'hidden'];
            if (!valid.includes(status)) {
                console.warn(`[TabStatus] Invalid status. Use: ${valid.join(', ')}`);
                return;
            }
            const tabEl = document.getElementById('shell_tab' + tabIndex);
            if (!tabEl) { console.warn('[TabStatus] Tab not found'); return; }
            if (status === 'hidden') {
                tabEl.removeAttribute('data-claude-status');
            } else {
                tabEl.setAttribute('data-claude-status', status);
            }
            console.log(`[TabStatus] Tab ${tabIndex} → ${status}`);
        };

        // Tab status indicator — tracks Claude Code state per terminal tab
        // States: running (green) | input (red) | completed (orange) | idle (blue)
        window.updateTabStatuses = () => {
            for (let i = 0; i < 5; i++) {
                const tabEl = document.getElementById('shell_tab' + i);
                if (!tabEl || tabEl.classList.contains('shell-dev-btn')) continue;

                const term = window.term && window.term[i];

                // No terminal instance → no indicator
                if (!term || typeof term !== 'object') {
                    tabEl.removeAttribute('data-claude-status');
                    continue;
                }

                // Check thinking and attention state from detector
                const isThinking = window.thinkingDetector && window.thinkingDetector.isThinking(i);
                const needsAttention = window.thinkingDetector && window.thinkingDetector.isNeedingAttention(i);

                if (needsAttention) {
                    // Needs attention → input (red) — regardless of thinking state
                    tabEl.setAttribute('data-claude-status', 'input');
                } else if (isThinking) {
                    // Thinking + no attention needed → running (green)
                    tabEl.setAttribute('data-claude-status', 'running');
                } else {
                    // Not thinking — check if there was a recent session
                    const detState = window.thinkingDetector && window.thinkingDetector._terminals[i];
                    const lastEnd = detState ? detState.lastThinkingEndTime : 0;

                    if (lastEnd > 0) {
                        // Had a thinking session before → completed (orange)
                        tabEl.setAttribute('data-claude-status', 'completed');
                    } else {
                        // Never had a thinking session → idle (blue)
                        tabEl.setAttribute('data-claude-status', 'idle');
                    }
                }
            }
        };

        // Update on thinking state changes
        window.addEventListener('thinking-state-changed', () => window.updateTabStatuses());

        // Context banner: show last user input when Claude starts thinking
        window.addEventListener('thinking-state-changed', (e) => {
            const { terminalIndex, isThinking } = e.detail;
            if (isThinking && window.term[terminalIndex] && window.term[terminalIndex]._pendingBannerText) {
                window.term[terminalIndex].updateContextBanner(window.term[terminalIndex]._pendingBannerText);
            }
        });
        // Update on attention state changes (permission prompts detected)
        window.addEventListener('claude-attention-changed', () => window.updateTabStatuses());

        // Permission mode: auto-grant logic for YOLO mode
        window.addEventListener('claude-attention-changed', (e) => {
            const { terminalIndex, needsAttention } = e.detail;
            if (!needsAttention) return;

            const mode = window.settings.permissionMode || 'default';

            if (mode === 'yolo') {
                // Auto-grant: send Enter to accept default menu selection (Claude Code uses interactive menus)
                // Then retry with "y" + Enter for classic y/n prompts if attention persists
                setTimeout(() => {
                    if (window.term && window.term[terminalIndex] && window.term[terminalIndex].socket) {
                        window.term[terminalIndex].socket.send("\r");
                    }
                    // Fallback: if still needs attention after 500ms, try "y" + Enter for y/n prompts
                    setTimeout(() => {
                        const state = window.thinkingDetector && window.thinkingDetector._terminals[terminalIndex];
                        if (state && state.needsAttention && window.term[terminalIndex] && window.term[terminalIndex].socket) {
                            window.term[terminalIndex].socket.send("y\r");
                        }
                    }, 500);
                }, 200);
            } else if (mode === 'ask') {
                // Ask Everything: flash the window and play alert sound
                if (remote.getCurrentWindow && !remote.getCurrentWindow().isFocused()) {
                    remote.getCurrentWindow().flashFrame(true);
                }
                if (window.settings.audio) {
                    try {
                        const audio = new Audio('assets/audio/alert.ogg');
                        audio.volume = (window.settings.audioVolume || 1.0) * 0.5;
                        audio.play().catch(() => {});
                    } catch(e) {}
                }
            }
        });

        // Permission mode cycling (ask -> default -> yolo -> ask)
        window.cyclePermissionMode = () => {
            const modes = ['ask', 'default', 'yolo'];
            const labels = { ask: 'Ask Everything', default: 'Default', yolo: 'YOLO' };
            const current = window.settings.permissionMode || 'default';
            const idx = modes.indexOf(current);
            const next = modes[(idx + 1) % modes.length];

            window.settings.permissionMode = next;

            // Apply to Claude Code settings files
            window._applyClaudePermissionMode(next);

            // Update button state
            const btn = document.getElementById('shell_permission_btn');
            if (btn) {
                btn.dataset.mode = next;
                btn.title = `Permission Mode: ${labels[next]}`;
            }

            // Persist to settings file
            try {
                fs.writeFileSync(settingsFile, JSON.stringify(window.settings, "", 4));
            } catch (err) {}

            // Brief visual feedback
            if (window.term && window.term[window.currentTerm]) {
                window.term[window.currentTerm].term.writeln(
                    `\x1b[90m[Son of Anton] Permission mode: \x1b[1m${labels[next]}\x1b[0m`
                );
            }
        };
        // Claude Code permission settings integration
        window._applyClaudePermissionMode = (mode) => {
            const os = require("os");
            const globalSettingsPath = path.join(os.homedir(), ".claude", "settings.json");
            const projectCwd = window.settings.cwd || __dirname;
            const projectSettingsPath = path.join(projectCwd, ".claude", "settings.local.json");

            const allTools = [
                "Read", "Edit", "Write", "Bash", "Glob", "Grep",
                "WebFetch", "WebSearch", "Task", "NotebookEdit", "LSP", "Skill"
            ];

            const readJson = (filePath) => {
                try {
                    if (fs.existsSync(filePath)) {
                        return JSON.parse(fs.readFileSync(filePath, "utf8"));
                    }
                } catch (e) {
                    if (window.settings && window.settings.debug) {
                        console.warn("[ClaudePerms] Failed to read", filePath, e.message);
                    }
                }
                return {};
            };

            const writeJson = (filePath, data) => {
                try {
                    const dir = path.dirname(filePath);
                    if (!fs.existsSync(dir)) {
                        fs.mkdirSync(dir, { recursive: true });
                    }
                    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
                } catch (e) {
                    if (window.settings && window.settings.debug) {
                        console.error("[ClaudePerms] Failed to write", filePath, e.message);
                    }
                }
            };

            const globalSettings = readJson(globalSettingsPath);
            const projectSettings = readJson(projectSettingsPath);

            // Back up original permissions on first call
            if (window.settings._claudeOriginalGlobalPerms === undefined) {
                window.settings._claudeOriginalGlobalPerms = globalSettings.permissions
                    ? JSON.parse(JSON.stringify(globalSettings.permissions))
                    : null;
                window.settings._claudeOriginalProjectPerms = projectSettings.permissions
                    ? JSON.parse(JSON.stringify(projectSettings.permissions))
                    : null;
                try {
                    fs.writeFileSync(settingsFile, JSON.stringify(window.settings, "", 4));
                } catch (e) {}
            }

            if (mode === 'yolo') {
                if (!globalSettings.permissions) globalSettings.permissions = {};
                globalSettings.permissions.allow = allTools;
                writeJson(globalSettingsPath, globalSettings);

                if (!projectSettings.permissions) projectSettings.permissions = {};
                projectSettings.permissions.allow = allTools;
                writeJson(projectSettingsPath, projectSettings);

            } else if (mode === 'ask') {
                if (globalSettings.permissions) {
                    delete globalSettings.permissions.allow;
                }
                writeJson(globalSettingsPath, globalSettings);

                if (projectSettings.permissions) {
                    delete projectSettings.permissions.allow;
                }
                writeJson(projectSettingsPath, projectSettings);

            } else {
                const origGlobal = window.settings._claudeOriginalGlobalPerms;
                const origProject = window.settings._claudeOriginalProjectPerms;

                if (origGlobal !== null && origGlobal !== undefined) {
                    globalSettings.permissions = JSON.parse(JSON.stringify(origGlobal));
                } else {
                    delete globalSettings.permissions;
                }
                writeJson(globalSettingsPath, globalSettings);

                if (origProject !== null && origProject !== undefined) {
                    projectSettings.permissions = JSON.parse(JSON.stringify(origProject));
                } else {
                    delete projectSettings.permissions;
                }
                writeJson(projectSettingsPath, projectSettings);
            }

            if (window.settings && window.settings.debug) {
                console.log("[ClaudePerms] Applied mode:", mode);
            }
        };

        // Apply Claude permission mode on startup
        window._applyClaudePermissionMode(window.settings.permissionMode || 'default');

        // Update on Claude state changes (session mapping, live context)
        window.addEventListener('claude-state-changed', () => window.updateTabStatuses());
        // Periodic refresh as safety net
        setInterval(() => window.updateTabStatuses(), 2000);

        // Initialize widget loader
        const widgetLoader = new WidgetLoader({
            profiler: profiler,
            staggerDelay: window.settings.widgetStaggerDelay || 100,
            onStartupComplete: (prof) => {
                if (process.env.PROFILE_STARTUP === 'deep') {
                    ipc.send('stop-content-tracing');
                }
                prof.logSummary();
            }
        });

        // Expose widgetDataReady globally so widget classes can report first data point
        window._widgetDataReady = (name) => widgetLoader.widgetDataReady(name);

        // Register widget classes
        widgetLoader.registerWidgets({
            clock: Clock,
            sysinfo: Sysinfo,
            hardwareInspector: HardwareInspector,
            cpuinfo: Cpuinfo,
            ramwatcher: RAMwatcher,
            toplist: Toplist,
            netstat: Netstat,
            globe: LocationGlobe,
            conninfo: Conninfo,
            todoWidget: TodoWidget,
            agentList: AgentList
        });

        // Load lightweight widgets immediately (Clock, TodoWidget, AgentList)
        profiler.mark('widgets-start');
        const lightweightLoaded = widgetLoader.loadLightweight();
        console.log('[Startup] Lightweight widgets loaded:', lightweightLoaded.join(', '));

        // Assign mods object (lightweight widgets available now), preserving creditDisplay
        const _creditDisplayRef = window.mods && window.mods.creditDisplay;
        window.mods = widgetLoader.getMods();
        if (_creditDisplayRef) window.mods.creditDisplay = _creditDisplayRef;

        // Defer heavy widgets until terminal is interactive
        setTimeout(async () => {
            try {
                const heavyLoaded = await widgetLoader.loadHeavyDeferred();
                console.log('[Startup] Heavy widgets loaded:', heavyLoaded.join(', '));
            } catch (e) {
                console.warn('[Startup] Heavy widgets failed to load:', e.message);
            }

            try {
                // Load deferred widgets last (for bottom positioning)
                const deferredLoaded = widgetLoader.loadDeferred();
                console.log('[Startup] Deferred widgets loaded:', deferredLoaded.join(', '));
            } catch (e) {
                console.warn('[Startup] Deferred widgets failed to load:', e.message);
            }

            // Update mods reference, preserving creditDisplay
            const _cdRef = window.mods && window.mods.creditDisplay;
            window.mods = widgetLoader.getMods();
            if (_cdRef) window.mods.creditDisplay = _cdRef;

            // Trigger widget fade-in animations
            document.querySelectorAll(".mod_column").forEach(e => {
                e.setAttribute("class", "mod_column activated");
            });

            let i = 0;
            let left = document.querySelectorAll("#mod_column_left > div");
            let right = document.querySelectorAll("#mod_column_right > div");
            let x = setInterval(() => {
                if (!left[i] && !right[i]) {
                    clearInterval(x);
                } else {
                    window.audioManager.panels.play();
                    if (left[i]) {
                        left[i].setAttribute("style", "animation-play-state: running;");
                    }
                    if (right[i]) {
                        right[i].setAttribute("style", "animation-play-state: running;");
                    }
                    i++;
                }
            }, 500);

            profiler.mark('widgets-complete');
            profiler.measure('widget-loading', 'widgets-start', 'widgets-complete');

            // Enable drag-and-drop reordering on all panel widgets
            window.dragManager = new DragManager();
            console.log('[Startup] DragManager initialized — widgets are now draggable');
        }, 0);

        await _delay(100);

        /* Minimal Redesign: Disabled FilesystemDisplay initialization
        window.fsDisp = new FilesystemDisplay({
            parentId: "filesystem"
        });
        */

        await _delay(200);

        const filesystemEl = document.getElementById("filesystem");
        if (filesystemEl) {
            filesystemEl.setAttribute("style", "opacity: 1;");
        }

        // Resend terminal CWD to fsDisp if we're hot reloading
        if (window.performance.navigation.type === 1) {
            Object.keys(window.term).forEach(idx => {
                if (window.term[idx] && window.term[idx].resendCWD) {
                    window.term[idx].resendCWD();
                }
            });
        }

        await _delay(200);

        window.updateCheck = new UpdateChecker();

        /* Minimal Redesign: Append placeholders to the bottom of columns using DOM API */
        const createPlaceholders = (columnId) => {
            const column = document.getElementById(columnId);
            if (column) {
                column.style.opacity = "1"; // Ensure column is visible
                column.style.display = "flex"; // Ensure flex layout

                // Create placeholders
                const p1 = document.createElement("div");
                p1.className = "placeholder-panel";
                p1.innerHTML = `<h3 class="title"><p>STATUS</p><p>OFFLINE</p></h3><h2 class="placeholder-text">RESERVED</h2>`;

                const p2 = document.createElement("div");
                p2.className = "placeholder-panel";
                p2.innerHTML = `<h3 class="title"><p>STATUS</p><p>OFFLINE</p></h3><h2 class="placeholder-text">RESERVED</h2>`;

                column.appendChild(p1);
                column.appendChild(p2);
            }
        };

        /* Placeholder creation removed - replaced by custom widgets */
        // createPlaceholders("mod_column_left");
        // createPlaceholders("mod_column_right");

        /* Restore Settings Shortcut (Ctrl+Shift+S) */
        document.addEventListener("keydown", e => {
            if (e.ctrlKey && e.shiftKey && (e.key === "s" || e.key === "S")) {
                window.openSettings();
            }
        });

        // Caps Lock: Toggle voice dictation
        // If voice is currently recording or processing, trigger transcription first, then disable
        document.addEventListener("keydown", async e => {
            if (e.code === "CapsLock") {
                e.preventDefault();
                // Check if voice controller is currently recording or processing
                if (window.voiceController &&
                    (window.voiceController.state === 'RECORDING' ||
                     window.voiceController.state === 'PROCESSING')) {
                    // Skip if already processing - just disable
                    if (window.voiceController.state === 'PROCESSING') {
                        await window.voiceController.disable();
                        console.log('[Mic] Dictation stopped');
                        return;
                    }
                    // Set isEnabled to false FIRST so _returnToListening doesn't restart
                    window.voiceController.isEnabled = false;
                    // Trigger transcription to process current audio
                    await window.voiceController._onSilenceTimeout();
                    // Ensure disabled state (in case _returnToListening did something)
                    if (window.voiceController.isEnabled) {
                        await window.voiceController.disable();
                    }
                    // Update UI
                    const btn = document.getElementById('shell_mic_btn');
                    if (btn) {
                        btn.title = 'Toggle Microphone';
                    }
                    if (window.voiceToggleWidget) {
                        window.voiceToggleWidget.setEnabled(false);
                    }
                    if (window.micMonitor) {
                        window.micMonitor.stop();
                    }
                    console.log('[Mic] Dictation stopped and recognized');
                } else {
                    window.toggleMic();
                }
            }
        });

        /* Minimal Redesign: Standalone keyboard sound handler (replaces keyboard.class.js sounds) */
        window.passwordMode = "false";
        let lastKeySoundTime = 0;
        document.addEventListener("keydown", e => {
            // Skip modifier-only keys and repeated keys for sound
            if (e.repeat && (e.code.startsWith('Shift') || e.code.startsWith('Alt') ||
                e.code.startsWith('Control') || e.code.startsWith('Caps'))) {
                return;
            }
            // Throttle sound to avoid overwhelming audio
            const now = Date.now();
            if (now - lastKeySoundTime < 30) return;
            lastKeySoundTime = now;

            if (window.passwordMode === "false") {
                window.audioManager.stdin.play();
            }
        });
        document.addEventListener("keyup", e => {
            if (window.passwordMode === "false" && e.key === "Enter") {
                window.audioManager.granted.play();
            }
        });

        /* Self-Test: Verify UI Integrity - Disabled to prevent modal popup */
        // setTimeout(() => {
        //     if (window.runUITests) window.runUITests();
        // }, 2000);

        /* Initialize Voice System */
        profiler.mark('voice-init-start');
        setTimeout(() => {
            initializeVoice();
        }, 2500);

        /* Auto-fix grey zone by toggling DevTools at startup (simulates Option+Cmd+I / Ctrl+Shift+I) */
        setTimeout(() => {
            const win = remote.getCurrentWindow();

            // Explicitly open DevTools
            win.webContents.openDevTools();

            // Wait for DevTools to open, then close them
            setTimeout(() => {
                win.webContents.closeDevTools();

                // Force terminal resize after closing to ensure proper layout
                setTimeout(() => {
                    if (typeof window.currentTerm !== "undefined" && window.term[window.currentTerm]) {
                        window.term[window.currentTerm].fit();
                        window.dispatchEvent(new Event('resize'));
                    }
                }, 150);
            }, 300);
        }, 1000);

        profiler.mark('renderer-ready');
        profiler.measure('renderer-total', 'renderer-start', 'renderer-ready');
        profiler.logSummary();
        ipc.send('log', 'info', JSON.stringify(profiler.getMetrics()));
    }

    window.themeChanger = theme => {
        ipc.send("setThemeOverride", theme);
        setTimeout(() => {
            window.location.reload(true);
        }, 100);
    };

    window.remakeKeyboard = layout => {
        const keyboardEl = document.getElementById("keyboard");
        if (!keyboardEl) {
            console.warn("[remakeKeyboard] Keyboard element not found - keyboard disabled in minimal redesign");
            return;
        }
        keyboardEl.innerHTML = "";
        window.keyboard = new Keyboard({
            layout: path.join(keyboardsDir, layout + ".json" || settings.keyboard + ".json"),
            container: "keyboard"
        });
        ipc.send("setKbOverride", layout);
    };

    window.focusShellTab = number => {
        window.audioManager.folder.play();

        // Close InputComposer on tab switch
        InputComposer.closeIfOpen();

        // --- Browser tab handling ---
        if (window.tabType[number] === 'browser') {
            if (number !== window.currentTerm) {
                window.currentTerm = number;

                // Deactivate all tab headers
                document.querySelectorAll('ul#main_shell_tabs > li[id^="shell_tab"]').forEach(e => {
                    e.classList.remove('active');
                });
                document.getElementById("shell_tab" + number).classList.add("active");

                // Hide all terminal pres and browser containers
                document.querySelectorAll('div#main_shell_innercontainer > pre').forEach(e => {
                    e.setAttribute("class", "");
                });
                document.querySelectorAll('div#main_shell_innercontainer > .browser-tab-container').forEach(e => {
                    e.classList.remove("active");
                });

                // Show this browser container
                const browserEl = document.getElementById("browser_tab_" + number);
                if (browserEl) browserEl.classList.add("active");

                // Hide ad overlay
                if (window.adOverlay) window.adOverlay.forceHide();

                // Focus the URL input
                if (window.browserInstances[number] && window.browserInstances[number].urlInput) {
                    window.browserInstances[number].urlInput.focus();
                }
            }
            return;
        }

        // --- Terminal tab handling (original logic) ---
        if (number !== window.currentTerm && window.term[number]) {
            window.currentTerm = number;

            // Deactivate all tab headers
            document.querySelectorAll('ul#main_shell_tabs > li[id^="shell_tab"]').forEach(e => {
                e.classList.remove('active');
            });
            document.getElementById("shell_tab" + number).classList.add("active");

            // Hide all terminal pres and browser containers
            document.querySelectorAll('div#main_shell_innercontainer > pre').forEach(e => {
                e.setAttribute("class", "");
            });
            document.querySelectorAll('div#main_shell_innercontainer > .browser-tab-container').forEach(e => {
                e.classList.remove("active");
            });
            document.getElementById("terminal" + number).setAttribute("class", "active");

            window.term[number].fit();
            window.term[number].term.focus();
            window.term[number].resendCWD();

            // Update ad overlay for active terminal (DET-06)
            if (window.thinkingDetector) {
                const isThinking = window.thinkingDetector.isThinking(number);
                if (isThinking && window.adOverlay) {
                    window.adOverlay.forceHide();
                    window.adOverlay.show(number);
                } else if (window.adOverlay) {
                    window.adOverlay.forceHide();
                }
            }

            // Update session mapping for the new active terminal
            if (window.claudeState && window.term[number].cwd) {
                const sessionId = findSessionForCwd(window.term[number].cwd, window.claudeState.projects, window.claudeState.liveContext);
                if (sessionId) {
                    window.terminalSessions[number] = sessionId;
                } else {
                    delete window.terminalSessions[number];
                }
                // Notify widgets of the change
                window.dispatchEvent(new CustomEvent('claude-state-changed', { detail: window.claudeState }));
            }

            // window.fsDisp.followTab();
        } else if (number > 0 && number <= 19 && window.tabType[number] !== 'browser' && window.term[number] !== null && typeof window.term[number] !== "object") {
            window.term[number] = null;
            window.tabType[number] = 'terminal';

            document.getElementById("shell_tab" + number).innerHTML = `<p>LOADING...${window._tabCloseBtn(number)}</p>`;
            ipc.send("ttyspawn", "true");
            ipc.once("ttyspawn-reply", (e, r) => {
                if (r.startsWith("ERROR")) {
                    document.getElementById("shell_tab" + number).innerHTML = `<p>ERROR${window._tabCloseBtn(number)}</p>`;
                } else if (r.startsWith("SUCCESS")) {
                    let port = Number(r.substr(9));

                    try {
                        window.term[number] = new Terminal({
                            role: "client",
                            parentId: "terminal" + number,
                            port
                        });
                    } catch (termErr) {
                        console.error('[Tabs] Failed to create terminal client for tab ' + number + ':', termErr);
                        document.getElementById("shell_tab" + number).innerHTML = `<p>ERROR${window._tabCloseBtn(number)}</p>`;
                        window.term[number] = undefined;
                        return;
                    }

                    window.term[number].onclose = e => {
                        delete window.term[number].onprocesschange;
                        // Detach thinking detector from closing terminal
                        if (window.thinkingDetector) {
                            window.thinkingDetector.detach(number);
                        }
                        window.terminalNames[number] = "DISCONNECTED";
                        window.saveTerminalNames();
                        document.getElementById("shell_tab" + number).innerHTML = `<p>DISCONNECTED${window._tabCloseBtn(number)}</p>`;
                        document.getElementById("terminal" + number).innerHTML = "";
                        window.term[number].term.dispose();
                        delete window.term[number];
                        window.useAppShortcut("PREVIOUS_TAB");
                    };

                    window.term[number].onprocesschange = p => {
                        window.term[number]._lastProcess = p;
                        // Only show process name if user hasn't set a custom name
                        const currentName = window.terminalNames[number];
                        if (!currentName || currentName === "EMPTY" || currentName.startsWith('#')) {
                            const tabEl = document.getElementById("shell_tab" + number);
                            if (tabEl) {
                                tabEl.querySelector('p').innerHTML = `#${number + 1} - ${p}${window._tabCloseBtn(number)}`;
                            }
                        }
                    };

                    document.getElementById("shell_tab" + number).innerHTML = `<p>::${port}${window._tabCloseBtn(number)}</p>`;
                    window.enableTabRename(number);

                    // Attach thinking detector to new terminal (DET-06)
                    if (window.thinkingDetector && window.term[number].socket) {
                        const attachNewTerm = () => {
                            if (window.term[number].socket.readyState === WebSocket.OPEN) {
                                window.thinkingDetector.attach(number, window.term[number].socket);
                            } else {
                                window.term[number].socket.addEventListener('open', () => {
                                    window.thinkingDetector.attach(number, window.term[number].socket);
                                }, { once: true });
                            }
                        };
                        attachNewTerm();
                    }

                    setTimeout(() => {
                        window.focusShellTab(number);
                    }, 500);
                }
            });
        }
    };

    // Mic toggle in tab bar
    window.toggleMic = async () => {
        if (!window.voiceController) {
            console.warn('[Mic] Voice controller not available');
            return;
        }
        const newState = await window.voiceController.toggle();
        // Update title (CSS state is managed by onStateChange callback)
        const btn = document.getElementById('shell_mic_btn');
        if (btn) {
            btn.title = newState ? 'Microphone ON (click to disable)' : 'Toggle Microphone';
        }
        if (window.voiceToggleWidget) {
            window.voiceToggleWidget.setEnabled(newState);
        }
        // Sync MicMonitor with mic toggle
        if (window.micMonitor) {
            if (newState) {
                window.micMonitor.start();
            } else {
                window.micMonitor.stop();
            }
        }
        console.log('[Mic] Toggled to:', newState ? 'ON' : 'OFF');
    };

    // Add new tab (+ button)
    window.addShellTab = () => {
        // Find the next available tab slot (tabs 0-19)
        let nextTab = -1;
        for (let i = 1; i < 20; i++) {
            const tabEl = document.getElementById('shell_tab' + i);
            if (!tabEl && nextTab === -1) {
                nextTab = i;
                break;
            }
        }

        if (nextTab === -1) {
            console.warn('[Tabs] Maximum of 20 tabs reached');
            return;
        }

        // Create the tab element before the + button
        const addBtn = document.getElementById('shell_add_tab');
        if (!addBtn) {
            console.error('[Tabs] Add button not found');
            return;
        }

        const newTab = document.createElement('li');
        newTab.id = 'shell_tab' + nextTab;
        newTab.onclick = () => window.focusShellTab(nextTab);
        newTab.innerHTML = `<p>${window._escapeHtml(window.terminalNames[nextTab] || 'EMPTY')}${window._tabCloseBtn(nextTab)}</p>`;
        addBtn.parentNode.insertBefore(newTab, addBtn);

        // Create terminal container
        const container = document.getElementById('main_shell_innercontainer');
        const newTerm = document.createElement('pre');
        newTerm.id = 'terminal' + nextTab;
        container.appendChild(newTerm);

        // Mark as terminal tab
        window.tabType[nextTab] = 'terminal';

        // Enable rename for the new tab
        window.enableTabRename(nextTab);

        // Focus the new tab (this will spawn a terminal)
        window.focusShellTab(nextTab);

        // Hide + / globe if we've reached 20 tabs
        if (nextTab >= 19) {
            addBtn.style.display = 'none';
            const browserBtn = document.getElementById('shell_browser_btn');
            if (browserBtn) browserBtn.style.display = 'none';
        }
    };

    // Get the total number of terminal tabs (excludes dev buttons)
    window.getTabCount = () => {
        const tabs = document.querySelectorAll('ul#main_shell_tabs > li[id^="shell_tab"]');
        return tabs.length;
    };

    // Close a terminal or browser tab
    window.closeShellTab = (index) => {
        const tabEl = document.getElementById('shell_tab' + index);
        if (!tabEl) return;

        // Don't close the last remaining tab
        const remainingTabs = document.querySelectorAll('ul#main_shell_tabs > li[id^="shell_tab"]:not(.shell-add-tab):not(.shell-browser-btn)');
        if (remainingTabs.length <= 1) {
            console.warn('[Tabs] Cannot close the last tab');
            return;
        }

        if (window.tabType[index] === 'browser') {
            // Clean up browser tab
            if (window.browserInstances[index]) {
                window.browserInstances[index].dispose();
                delete window.browserInstances[index];
            }
            delete window.tabType[index];
            const browserEl = document.getElementById('browser_tab_' + index);
            if (browserEl) browserEl.remove();
        } else {
            // Clean up terminal tab
            if (window.term[index] && typeof window.term[index] === 'object') {
                delete window.term[index].onclose;
                delete window.term[index].onprocesschange;

                if (window.thinkingDetector) {
                    window.thinkingDetector.detach(index);
                }

                if (window.term[index].close) {
                    window.term[index].close();
                } else if (window.term[index].socket) {
                    window.term[index].socket.close();
                }
                if (window.term[index].term) {
                    window.term[index].term.dispose();
                }
                delete window.term[index];
            }
            delete window.tabType[index];
            const termEl = document.getElementById('terminal' + index);
            if (termEl) termEl.remove();
        }

        // Clean up terminal name
        delete window.terminalNames[index];
        window.saveTerminalNames();

        // Remove tab header
        tabEl.remove();

        // Show the + / globe buttons in case they were hidden
        const addBtn = document.getElementById('shell_add_tab');
        if (addBtn) addBtn.style.display = '';
        const browserBtn = document.getElementById('shell_browser_btn');
        if (browserBtn) browserBtn.style.display = '';

        // Switch to another tab if we just closed the active one
        if (window.currentTerm === index) {
            const nextTab = document.querySelector('ul#main_shell_tabs > li[id^="shell_tab"]:not(.shell-add-tab):not(.shell-browser-btn)');
            if (nextTab) {
                const nextIndex = parseInt(nextTab.id.replace('shell_tab', ''), 10);
                window.focusShellTab(nextIndex);
            }
        }
    };

    // Add a browser tab in the unified tab system (any slot 0-19)
    window.addBrowserShellTab = (url) => {
        // Find the next available tab slot (tabs 0-19)
        let nextTab = -1;
        for (let i = 1; i < 20; i++) {
            const tabEl = document.getElementById('shell_tab' + i);
            if (!tabEl && nextTab === -1) {
                nextTab = i;
                break;
            }
        }

        if (nextTab === -1) {
            console.warn('[Tabs] Maximum of 20 tabs reached');
            return -1;
        }

        // Create tab header before the + button
        const addBtn = document.getElementById('shell_add_tab');
        if (!addBtn) {
            console.error('[Tabs] Add button not found');
            return -1;
        }

        const newTab = document.createElement('li');
        newTab.id = 'shell_tab' + nextTab;
        newTab.onclick = () => window.focusShellTab(nextTab);
        newTab.innerHTML = `<p>&#127760; Browser${window._tabCloseBtn(nextTab)}</p>`;
        addBtn.parentNode.insertBefore(newTab, addBtn);

        // Create browser container div (not a <pre>)
        const container = document.getElementById('main_shell_innercontainer');
        const browserDiv = document.createElement('div');
        browserDiv.id = 'browser_tab_' + nextTab;
        browserDiv.className = 'browser-tab-container';
        container.appendChild(browserDiv);

        // Create BrowserTab instance with webview
        const browserTab = new BrowserTab({
            parentId: 'browser_tab_' + nextTab,
            url: url || 'https://www.google.com'
        });

        // Update tab title when page title changes
        browserTab.onTitleChange = (title) => {
            const tabEl = document.getElementById('shell_tab' + nextTab);
            if (tabEl) {
                const short = title.length > 18 ? title.substring(0, 16) + '...' : title;
                tabEl.querySelector('p').innerHTML = `&#127760; ${window._escapeHtml(short)}${window._tabCloseBtn(nextTab)}`;
            }
        };

        // Mark this slot as a browser tab
        window.tabType[nextTab] = 'browser';
        window.browserInstances[nextTab] = browserTab;

        // Focus the new browser tab
        window.focusShellTab(nextTab);

        // Hide + / globe if we've reached 20 tabs
        if (nextTab >= 19) {
            addBtn.style.display = 'none';
            const browserBtn = document.getElementById('shell_browser_btn');
            if (browserBtn) browserBtn.style.display = 'none';
        }

        console.log(`[BrowserTab] Created browser tab at slot ${nextTab}`);
        return nextTab;
    };

    // Navigate browser from terminal command (backward compat)
    window.navigateBrowser = (url) => {
        // Find an existing browser tab or create one
        const existingBrowser = Object.keys(window.browserInstances)[0];
        if (existingBrowser !== undefined) {
            const idx = parseInt(existingBrowser, 10);
            window.browserInstances[idx].navigate(url);
            window.focusShellTab(idx);
        } else {
            window.addBrowserShellTab(url);
        }
    };

    // Terminal browser command handlers (backward compat)
    window.handleBrowserCommand = (cmd, args) => {
        switch (cmd) {
            case 'browse':
                if (args && args.length > 0) {
                    window.navigateBrowser(args.join(' '));
                } else {
                    window.addBrowserShellTab();
                }
                return true;
            case 'back': {
                const idx = Object.keys(window.browserInstances).find(k => parseInt(k, 10) === window.currentTerm);
                if (idx !== undefined) window.browserInstances[idx].back();
                return true;
            }
            case 'forward': {
                const idx = Object.keys(window.browserInstances).find(k => parseInt(k, 10) === window.currentTerm);
                if (idx !== undefined) window.browserInstances[idx].forward();
                return true;
            }
            case 'refresh': {
                const idx = Object.keys(window.browserInstances).find(k => parseInt(k, 10) === window.currentTerm);
                if (idx !== undefined) window.browserInstances[idx].refresh();
                return true;
            }
        }
        return false;
    };

    // Settings editor
    window.togglePowerMenu = (e) => {
        e.stopPropagation();
        const menu = document.getElementById("shell_power_menu");
        const btn = document.getElementById("shell_power_btn");
        if (!menu || !btn) return;

        const isHidden = menu.classList.contains("hidden");

        // Close any other open menus first
        document.querySelectorAll(".power-menu:not(.hidden)").forEach(m => {
            if (m !== menu) m.classList.add("hidden");
        });

        menu.classList.toggle("hidden");

        // Position the fixed menu below the power button
        if (!menu.classList.contains("hidden")) {
            const rect = btn.getBoundingClientRect();
            menu.style.top = (rect.bottom + 2) + "px";
            menu.style.right = (window.innerWidth - rect.right) + "px";
        }

        // Close on outside click
        const close = (event) => {
            // Don't close if click is inside the power button (includes the menu)
            if (btn.contains(event.target)) return;
            menu.classList.add("hidden");
            document.removeEventListener("click", close);
        };
        if (!menu.classList.contains("hidden")) {
            setTimeout(() => document.addEventListener("click", close), 0);
        }
    };

    window.powerReloadUI = () => {
        window.location.reload(true);
    };

    window.powerRestart = () => {
        remote.app.relaunch();
        remote.app.quit();
    };

    window.powerQuit = () => {
        remote.app.quit();
    };

    window.openSettings = async () => {
        if (document.getElementById("settingsEditor")) return;

        // Build lists of available keyboards, themes, monitors
        // Build lists of available keyboards, themes, monitors
        let themes, monitors, ifaces;

        fs.readdirSync(themesDir).forEach(th => {
            if (!th.endsWith(".json")) return;
            th = th.replace(".json", "");
            if (th === window.settings.theme) return;
            themes += `<option>${th}</option>`;
        });
        for (let i = 0; i < remote.screen.getAllDisplays().length; i++) {
            if (i !== window.settings.monitor) monitors += `<option>${i}</option>`;
        }
        let nets = await window.si.networkInterfaces();
        nets.forEach(net => {
            if (net.iface !== window.mods.netstat.iface) ifaces += `<option>${net.iface}</option>`;
        });

        // Unlink the tactile keyboard from the terminal emulator to allow filling in the settings fields
        if (window.keyboard && window.keyboard.detach) {
            window.keyboard.detach();
        }

        new Modal({
            type: "custom",
            title: `Settings <i>(v${remote.app.getVersion()})</i>`,
            html: `<div id="settingsEditor" class="settings-tabbed">
                <div class="settings-sidebar">
                    <div class="settings-tab settings-tab--active" data-tab="general">General</div>
                    <div class="settings-tab" data-tab="appearance">Appearance</div>
                    <div class="settings-tab" data-tab="audio">Audio</div>
                    <div class="settings-tab" data-tab="network">Network</div>
                    <div class="settings-tab" data-tab="files">Files</div>
                    <div class="settings-tab" data-tab="advanced">Advanced</div>
                    <div class="settings-tab" data-tab="ads">Ads & Misc</div>
                </div>
                <div class="settings-content">
                    <div class="settings-pane settings-pane--active" data-pane="general">
                        <h3 class="settings-pane__title">General</h3>
                        <table><tr><th>Key</th><th>Description</th><th>Value</th></tr>
                        <tr><td>shell</td><td>The program to run as a terminal emulator</td><td><input type="text" id="settingsEditor-shell" value="${window.settings.shell}"></td></tr>
                        <tr><td>shellArgs</td><td>Arguments to pass to the shell</td><td><input type="text" id="settingsEditor-shellArgs" value="${window.settings.shellArgs || ''}"></td></tr>
                        <tr><td>cwd</td><td>Working Directory to start in</td><td><input type="text" id="settingsEditor-cwd" value="${window.settings.cwd}"></td></tr>
                        <tr><td>env</td><td>Custom shell environment override</td><td><input type="text" id="settingsEditor-env" value="${window.settings.env}"></td></tr>
                        <tr><td>username</td><td>Custom username to display at boot</td><td><input type="text" id="settingsEditor-username" value="${window.settings.username}"></td></tr>
                        </table>
                    </div>
                    <div class="settings-pane" data-pane="appearance">
                        <h3 class="settings-pane__title">Appearance</h3>
                        <table><tr><th>Key</th><th>Description</th><th>Value</th></tr>
                        <tr><td>theme</td><td>Name of the theme to load</td><td><select id="settingsEditor-theme"><option>${window.settings.theme}</option>${themes}</select></td></tr>
                        <tr><td>termFontSize</td><td>Size of the terminal text in pixels</td><td><input type="number" id="settingsEditor-termFontSize" value="${window.settings.termFontSize}"></td></tr>
                        <tr><td>monitor</td><td>Which monitor to spawn the UI in</td><td><select id="settingsEditor-monitor">${(typeof window.settings.monitor !== "undefined") ? "<option>" + window.settings.monitor + "</option>" : ""}${monitors}</select></td></tr>
                        <tr><td>allowWindowed</td><td>Allow using F11 key to set the UI in windowed mode</td><td><select id="settingsEditor-allowWindowed"><option>${window.settings.allowWindowed}</option><option>${!window.settings.allowWindowed}</option></select></td></tr>
                        <tr><td>keepGeometry</td><td>Try to keep a 16:9 aspect ratio in windowed mode</td><td><select id="settingsEditor-keepGeometry"><option>${(window.settings.keepGeometry === false) ? 'false' : 'true'}</option><option>${(window.settings.keepGeometry === false) ? 'true' : 'false'}</option></select></td></tr>
                        <tr><td>nocursor</td><td>Hide the mouse cursor${(window.settings.nocursorOverride) ? " (Currently overridden by CLI flag)" : ""}</td><td><select id="settingsEditor-nocursor"><option>${window.settings.nocursor}</option><option>${!window.settings.nocursor}</option></select></td></tr>
                        <tr><td>nointro</td><td>Skip the intro boot log and logo${(window.settings.nointroOverride) ? " (Currently overridden by CLI flag)" : ""}</td><td><select id="settingsEditor-nointro"><option>${window.settings.nointro}</option><option>${!window.settings.nointro}</option></select></td></tr>
                        </table>
                    </div>
                    <div class="settings-pane" data-pane="audio">
                        <h3 class="settings-pane__title">Audio</h3>
                        <table><tr><th>Key</th><th>Description</th><th>Value</th></tr>
                        <tr><td>audio</td><td>Activate audio sound effects</td><td><select id="settingsEditor-audio"><option>${window.settings.audio}</option><option>${!window.settings.audio}</option></select></td></tr>
                        <tr><td>audioVolume</td><td>Set default volume for sound effects (0.0 - 1.0)</td><td><input type="number" id="settingsEditor-audioVolume" value="${window.settings.audioVolume || '1.0'}"></td></tr>
                        <tr><td>disableFeedbackAudio</td><td>Disable recurring feedback sound FX (input/output, mostly)</td><td><select id="settingsEditor-disableFeedbackAudio"><option>${window.settings.disableFeedbackAudio}</option><option>${!window.settings.disableFeedbackAudio}</option></select></td></tr>
                        </table>
                    </div>
                    <div class="settings-pane" data-pane="network">
                        <h3 class="settings-pane__title">Network</h3>
                        <table><tr><th>Key</th><th>Description</th><th>Value</th></tr>
                        <tr><td>port</td><td>Local port to use for UI-shell connection</td><td><input type="number" id="settingsEditor-port" value="${window.settings.port}"></td></tr>
                        <tr><td>pingAddr</td><td>IPv4 address to test Internet connectivity</td><td><input type="text" id="settingsEditor-pingAddr" value="${window.settings.pingAddr || "1.1.1.1"}"></td></tr>
                        <tr><td>iface</td><td>Override the interface used for network monitoring</td><td><select id="settingsEditor-iface"><option>${window.mods.netstat.iface}</option>${ifaces}</select></td></tr>
                        </table>
                    </div>
                    <div class="settings-pane" data-pane="files">
                        <h3 class="settings-pane__title">Files</h3>
                        <table><tr><th>Key</th><th>Description</th><th>Value</th></tr>
                        <tr><td>hideDotfiles</td><td>Hide files and directories starting with a dot in file display</td><td><select id="settingsEditor-hideDotfiles"><option>${window.settings.hideDotfiles}</option><option>${!window.settings.hideDotfiles}</option></select></td></tr>
                        <tr><td>fsListView</td><td>Show files in a more detailed list instead of an icon grid</td><td><select id="settingsEditor-fsListView"><option>${window.settings.fsListView}</option><option>${!window.settings.fsListView}</option></select></td></tr>
                        <tr><td>excludeThreadsFromToplist</td><td>Display threads in the top processes list</td><td><select id="settingsEditor-excludeThreadsFromToplist"><option>${window.settings.excludeThreadsFromToplist}</option><option>${!window.settings.excludeThreadsFromToplist}</option></select></td></tr>
                        </table>
                    </div>
                    <div class="settings-pane" data-pane="advanced">
                        <h3 class="settings-pane__title">Advanced</h3>
                        <table><tr><th>Key</th><th>Description</th><th>Value</th></tr>
                        <tr><td>experimentalGlobeFeatures</td><td>Toggle experimental features for the network globe</td><td><select id="settingsEditor-experimentalGlobeFeatures"><option>${window.settings.experimentalGlobeFeatures}</option><option>${!window.settings.experimentalGlobeFeatures}</option></select></td></tr>
                        <tr><td>experimentalFeatures</td><td>Toggle Chrome's experimental web features (DANGEROUS)</td><td><select id="settingsEditor-experimentalFeatures"><option>${window.settings.experimentalFeatures}</option><option>${!window.settings.experimentalFeatures}</option></select></td></tr>
                        <tr><td>contextWarningThreshold</td><td>Context usage percentage to trigger warning (0-100)</td><td><input type="number" id="settingsEditor-contextWarningThreshold" value="${window.settings.contextWarningThreshold || 80}" min="0" max="100"></td></tr>
                        <tr><td>permissionMode</td><td>Agent permission level: Ask Everything, Default, or YOLO (auto-grant all)</td><td><select id="settingsEditor-permissionMode"><option value="ask" ${(window.settings.permissionMode || 'default') === 'ask' ? 'selected' : ''}>Ask Everything</option><option value="default" ${(window.settings.permissionMode || 'default') === 'default' ? 'selected' : ''}>Default</option><option value="yolo" ${window.settings.permissionMode === 'yolo' ? 'selected' : ''}>YOLO</option></select></td></tr>
                        </table>
                    </div>
                    <div class="settings-pane" data-pane="ads">
                        <h3 class="settings-pane__title">Ads & Misc</h3>
                        <table><tr><th>Key</th><th>Description</th><th>Value</th></tr>
                        <tr><td>clockHours</td><td>Clock format (12/24 hours)</td><td><select id="settingsEditor-clockHours"><option>${(window.settings.clockHours === 12) ? "12" : "24"}</option><option>${(window.settings.clockHours === 12) ? "24" : "12"}</option></select></td></tr>
                        <tr><td>adOverlayEnabled</td><td>Show ad overlay during AI thinking time to earn credits</td><td><select id="settingsEditor-adOverlayEnabled"><option>${window.settings.adOverlayEnabled !== false}</option><option>${window.settings.adOverlayEnabled === false}</option></select></td></tr>
                        <tr><td>adOverlayMode</td><td>Ad display: corner, fullscreen (more credits), or panel</td><td><select id="settingsEditor-adOverlayMode"><option value="corner" ${(window.settings.adOverlayMode || 'corner') === 'corner' ? 'selected' : ''}>corner</option><option value="fullscreen" ${window.settings.adOverlayMode === 'fullscreen' ? 'selected' : ''}>fullscreen</option><option value="panel" ${window.settings.adOverlayMode === 'panel' ? 'selected' : ''}>panel</option></select></td></tr>
                        <tr><td>adDebounceMs</td><td>Debounce delay (ms) before showing/hiding overlay</td><td><input type="number" id="settingsEditor-adDebounceMs" value="${window.settings.adDebounceMs || 300}" min="0" max="2000"></td></tr>
                        <tr><td>adTimeoutMs</td><td>Max overlay display time (ms) before auto-hide</td><td><input type="number" id="settingsEditor-adTimeoutMs" value="${window.settings.adTimeoutMs || 30000}" min="5000" max="120000"></td></tr>
                        </table>
                    </div>
                </div>
            </div>
            <h6 id="settingsEditorStatus">Loaded values from memory</h6>
            <br>`,
            buttons: [
                { label: "Open in External Editor", action: `electron.shell.openPath('${settingsFile}');electronWin.minimize();` },
                { label: "Save to Disk", action: "window.writeSettingsFile()" },
                { label: "Reload UI", action: "window.location.reload(true);" },
                { label: "Restart App", action: "remote.app.relaunch();remote.app.quit();" },
                { label: "Quit", action: "remote.app.quit();" }
            ]
        }, () => {
            // Link the keyboard back to the terminal
            if (window.keyboard && window.keyboard.attach) {
                window.keyboard.attach();
            }

            // Focus back on the term
            window.term[window.currentTerm].term.focus();
        });

        // Attach tab switching listeners after modal is in the DOM
        // (inline <script> tags don't execute when inserted via innerHTML)
        document.querySelectorAll('.settings-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                document.querySelectorAll('.settings-tab').forEach(t => t.classList.remove('settings-tab--active'));
                document.querySelectorAll('.settings-pane').forEach(p => p.classList.remove('settings-pane--active'));
                tab.classList.add('settings-tab--active');
                document.querySelector('.settings-pane[data-pane="' + tab.dataset.tab + '"]').classList.add('settings-pane--active');
            });
        });
    };

    window.writeFile = (filePath) => {
        fs.writeFile(filePath, document.getElementById("fileEdit").value, "utf-8", (err) => {
            if (err) {
                document.getElementById("fedit-status").innerHTML = `<i style="color: var(--color_red);">Save failed: ${window._escapeHtml(err.message)}</i>`;
                if (window.settings && window.settings.debug) {
                    console.error("[Renderer] File write failed:", filePath, err.message);
                }
                return;
            }
            document.getElementById("fedit-status").innerHTML = "<i>File saved.</i>";
        });
    };

    window.writeSettingsFile = () => {
        window.settings = {
            shell: document.getElementById("settingsEditor-shell").value,
            shellArgs: document.getElementById("settingsEditor-shellArgs").value,
            cwd: document.getElementById("settingsEditor-cwd").value,
            env: document.getElementById("settingsEditor-env").value,
            username: document.getElementById("settingsEditor-username").value,
            keyboard: window.settings.keyboard || "en-US",
            theme: document.getElementById("settingsEditor-theme").value,
            termFontSize: Number(document.getElementById("settingsEditor-termFontSize").value),
            audio: (document.getElementById("settingsEditor-audio").value === "true"),
            audioVolume: Number(document.getElementById("settingsEditor-audioVolume").value),
            disableFeedbackAudio: (document.getElementById("settingsEditor-disableFeedbackAudio").value === "true"),
            pingAddr: document.getElementById("settingsEditor-pingAddr").value,
            clockHours: Number(document.getElementById("settingsEditor-clockHours").value),
            port: Number(document.getElementById("settingsEditor-port").value),
            monitor: Number(document.getElementById("settingsEditor-monitor").value),
            nointro: (document.getElementById("settingsEditor-nointro").value === "true"),
            nocursor: (document.getElementById("settingsEditor-nocursor").value === "true"),
            iface: document.getElementById("settingsEditor-iface").value,
            allowWindowed: (document.getElementById("settingsEditor-allowWindowed").value === "true"),
            forceFullscreen: window.settings.forceFullscreen,
            keepGeometry: (document.getElementById("settingsEditor-keepGeometry").value === "true"),
            excludeThreadsFromToplist: (document.getElementById("settingsEditor-excludeThreadsFromToplist").value === "true"),
            hideDotfiles: (document.getElementById("settingsEditor-hideDotfiles").value === "true"),
            fsListView: (document.getElementById("settingsEditor-fsListView").value === "true"),
            experimentalGlobeFeatures: (document.getElementById("settingsEditor-experimentalGlobeFeatures").value === "true"),
            experimentalFeatures: (document.getElementById("settingsEditor-experimentalFeatures").value === "true"),
            contextWarningThreshold: Number(document.getElementById("settingsEditor-contextWarningThreshold")?.value) || 80,
            permissionMode: document.getElementById("settingsEditor-permissionMode")?.value || 'default',
            adOverlayEnabled: (document.getElementById("settingsEditor-adOverlayEnabled")?.value === "true"),
            adOverlayMode: document.getElementById("settingsEditor-adOverlayMode")?.value || 'corner',
            adDebounceMs: Number(document.getElementById("settingsEditor-adDebounceMs")?.value) || 300,
            adTimeoutMs: Number(document.getElementById("settingsEditor-adTimeoutMs")?.value) || 30000
        };

        Object.keys(window.settings).forEach(key => {
            if (window.settings[key] === "undefined") {
                delete window.settings[key];
            }
        });

        // Sync ad mode preference to localStorage so it persists across sessions
        if (window.settings.adOverlayMode) {
            localStorage.setItem('soa_ad_mode', window.settings.adOverlayMode);
        }

        // Sync permission mode button with saved setting
        const permBtn = document.getElementById('shell_permission_btn');
        if (permBtn) {
            const labels = { ask: 'Ask Everything', default: 'Default', yolo: 'YOLO' };
            permBtn.dataset.mode = window.settings.permissionMode || 'default';
            permBtn.title = `Permission Mode: ${labels[window.settings.permissionMode] || 'Default'}`;
        }

        // Apply permission mode to Claude Code settings files
        window._applyClaudePermissionMode(window.settings.permissionMode || 'default');

        try {
            fs.writeFileSync(settingsFile, JSON.stringify(window.settings, "", 4));
            document.getElementById("settingsEditorStatus").innerText = "New values written to settings.json file at " + new Date().toTimeString();
        } catch (err) {
            document.getElementById("settingsEditorStatus").innerText = "Save failed: " + err.message;
            if (window.settings && window.settings.debug) {
                console.error("[Renderer] Settings write failed:", err.message);
            }
        }
    };

    window.toggleFullScreen = () => {
        let useFullscreen = (electronWin.isFullScreen() ? false : true);
        electronWin.setFullScreen(useFullscreen);

        //Update settings
        window.lastWindowState["useFullscreen"] = useFullscreen;

        try {
            fs.writeFileSync(lastWindowStateFile, JSON.stringify(window.lastWindowState, "", 4));
        } catch (err) {
            if (window.settings && window.settings.debug) {
                console.error("[Renderer] Window state save failed:", err.message);
            }
        }
    };

    // Display available keyboard shortcuts and custom shortcuts helper
    window.openShortcutsHelp = () => {
        if (document.getElementById("settingsEditor")) return;

        const shortcutsDefinition = {
            "COPY": "Copy selected buffer from the terminal.",
            "PASTE": "Paste system clipboard to the terminal.",
            "NEXT_TAB": "Switch to the next opened terminal tab (left to right order).",
            "PREVIOUS_TAB": "Switch to the previous opened terminal tab (right to left order).",
            "TAB_X": "Switch to terminal tab <strong>X</strong>, or create it if it hasn't been opened yet.",
            "SETTINGS": "Open the settings editor.",
            "SHORTCUTS": "List and edit available keyboard shortcuts.",
            "FUZZY_SEARCH": "Search for entries in the current working directory.",
            "TEXT_EDITOR": "Open a text editor overlay for composing and editing text before sending to the terminal.",
            "INPUT_COMPOSER": "Open an inline composer bar at the bottom of the terminal for quick text editing.",
            "FS_LIST_VIEW": "Toggle between list and grid view in the file browser.",
            "FS_DOTFILES": "Toggle hidden files and directories in the file browser.",
            "KB_PASSMODE": "Toggle the on-screen keyboard's \"Password Mode\", which allows you to safely<br>type sensitive information even if your screen might be recorded (disable visual input feedback).",
            "DEV_DEBUG": "Open Chromium Dev Tools, for debugging purposes.",
            "DEV_RELOAD": "Trigger front-end hot reload."
        };

        let appList = "";
        window.shortcuts.filter(e => e.type === "app").forEach(cut => {
            let action = (cut.action.startsWith("TAB_")) ? "TAB_X" : cut.action;

            appList += `<tr>
                        <td>${(cut.enabled) ? 'YES' : 'NO'}</td>
                        <td><input disabled type="text" maxlength=25 value="${cut.trigger}"></td>
                        <td>${shortcutsDefinition[action]}</td>
                    </tr>`;
        });

        let customList = "";
        window.shortcuts.filter(e => e.type === "shell").forEach(cut => {
            customList += `<tr>
                            <td>${(cut.enabled) ? 'YES' : 'NO'}</td>
                            <td><input disabled type="text" maxlength=25 value="${cut.trigger}"></td>
                            <td>
                                <input disabled type="text" placeholder="Run terminal command..." value="${cut.action}">
                                <input disabled type="checkbox" name="shortcutsHelpNew_Enter" ${(cut.linebreak) ? 'checked' : ''}>
                                <label for="shortcutsHelpNew_Enter">Enter</label>
                            </td>
                        </tr>`;
        });

        if (window.keyboard && window.keyboard.detach) {
            window.keyboard.detach();
        }
        new Modal({
            type: "custom",
            title: `Available Keyboard Shortcuts <i>(v${remote.app.getVersion()})</i>`,
            html: `<h5>Using either the on-screen or a physical keyboard, you can use the following shortcuts:</h5>
                <details open id="shortcutsHelpAccordeon1">
                    <summary>Emulator shortcuts</summary>
                    <table class="shortcutsHelp">
                        <tr>
                            <th>Enabled</th>
                            <th>Trigger</th>
                            <th>Action</th>
                        </tr>
                        ${appList}
                    </table>
                </details>
                <br>
                <details id="shortcutsHelpAccordeon2">
                    <summary>Custom command shortcuts</summary>
                    <table class="shortcutsHelp">
                        <tr>
                            <th>Enabled</th>
                            <th>Trigger</th>
                            <th>Command</th>
                        <tr>
                       ${customList}
                    </table>
                </details>
                <br>`,
            buttons: [
                { label: "Open Shortcuts File", action: `electron.shell.openPath('${shortcutsFile}');electronWin.minimize();` },
                { label: "Reload UI", action: "window.location.reload(true);" },
            ]
        }, () => {
            if (window.keyboard && window.keyboard.attach) {
                window.keyboard.attach();
            }
            window.term[window.currentTerm].term.focus();
        });

        let wrap1 = document.getElementById('shortcutsHelpAccordeon1');
        let wrap2 = document.getElementById('shortcutsHelpAccordeon2');

        wrap1.addEventListener('toggle', e => {
            wrap2.open = !wrap1.open;
        });

        wrap2.addEventListener('toggle', e => {
            wrap1.open = !wrap2.open;
        });
    };

    window.useAppShortcut = action => {
        switch (action) {
            case "COPY":
                window.term[window.currentTerm].clipboard.copy();
                return true;
            case "PASTE":
                // Check for image in clipboard first
                {
                    const clipImg = remote.clipboard.readImage();
                    if (clipImg && !clipImg.isEmpty()) {
                        const ext = "png";
                        const tmpDir = require("os").tmpdir();
                        const tmpPath = require("path").join(tmpDir, `clipboard_${Date.now()}.${ext}`);
                        const buf = clipImg.toPNG();
                        require("fs").writeFile(tmpPath, buf, err => {
                            if (err) {
                                console.error("[ImagePreview] Failed to save clipboard image:", err);
                                return;
                            }
                            const dataUrl = "data:image/png;base64," + buf.toString("base64");
                            if (window.showTerminalImagePreview) {
                                window.showTerminalImagePreview(dataUrl, "Clipboard image → " + tmpPath);
                            }
                            if (window.term && window.term[window.currentTerm]) {
                                window.term[window.currentTerm].write(tmpPath.includes(" ") ? `"${tmpPath}"` : tmpPath);
                            }
                        });
                        return true;
                    }
                }
                window.term[window.currentTerm].clipboard.paste();
                return true;
            case "NEXT_TAB":
                // Find next available tab (up to 10)
                for (let i = 1; i <= 10; i++) {
                    const next = (window.currentTerm + i) % 10;
                    if (window.term[next]) {
                        window.focusShellTab(next);
                        return true;
                    }
                }
                window.focusShellTab(0);
                return true;
            case "PREVIOUS_TAB":
                // Find previous available tab (up to 10)
                for (let i = 1; i <= 10; i++) {
                    const prev = (window.currentTerm - i + 10) % 10;
                    if (window.term[prev]) {
                        window.focusShellTab(prev);
                        return true;
                    }
                }
                return true;
            case "TAB_1":
                window.focusShellTab(0);
                return true;
            case "TAB_2":
                window.focusShellTab(1);
                return true;
            case "TAB_3":
                window.focusShellTab(2);
                return true;
            case "TAB_4":
                window.focusShellTab(3);
                return true;
            case "TAB_5":
                window.focusShellTab(4);
                return true;
            case "TAB_6":
                window.focusShellTab(5);
                return true;
            case "TAB_7":
                window.focusShellTab(6);
                return true;
            case "TAB_8":
                window.focusShellTab(7);
                return true;
            case "TAB_9":
                window.focusShellTab(8);
                return true;
            case "TAB_10":
                window.focusShellTab(9);
                return true;
            case "NEW_TAB":
                window.addShellTab();
                return true;
            case "SETTINGS":
                window.openSettings();
                return true;
            case "SHORTCUTS":
                window.openShortcutsHelp();
                return true;
            case "FUZZY_SEARCH":
                window.activeFuzzyFinder = new FuzzyFinder();
                return true;
            case "TEXT_EDITOR":
                InputComposer.closeIfOpen();
                new TextEditor();
                return true;
            case "INPUT_COMPOSER":
                new InputComposer();
                return true;
            case "FS_LIST_VIEW":
                if (window.fsDisp && window.fsDisp.toggleListview) {
                    window.fsDisp.toggleListview();
                }
                return true;
            case "FS_DOTFILES":
                if (window.fsDisp && window.fsDisp.toggleHidedotfiles) {
                    window.fsDisp.toggleHidedotfiles();
                }
                return true;
            case "KB_PASSMODE":
                if (window.keyboard && window.keyboard.togglePasswordMode) {
                    window.keyboard.togglePasswordMode();
                } else {
                    // Standalone password mode toggle when keyboard is disabled
                    window.passwordMode = (window.passwordMode === "false") ? "true" : "false";
                    console.log(`[KB_PASSMODE] Password mode: ${window.passwordMode}`);
                }
                return true;
            case "DEV_DEBUG":
                remote.getCurrentWindow().webContents.toggleDevTools();
                return true;
            case "DEV_RELOAD":
                window.location.reload(true);
                return true;
            default:
                console.warn(`Unknown "${action}" app shortcut action`);
                return false;
        }
    };

    // Global keyboard shortcuts
    const globalShortcut = remote.globalShortcut;
    globalShortcut.unregisterAll();

    window.registerKeyboardShortcuts = () => {
        window.shortcuts.forEach(cut => {
            if (!cut.enabled) return;

            if (cut.type === "app") {
                if (cut.action === "TAB_X") {
                    for (let i = 1; i <= 5; i++) {
                        let trigger = cut.trigger.replace("X", i);
                        let dfn = () => { window.useAppShortcut(`TAB_${i}`) };
                        globalShortcut.register(trigger, dfn);
                    }
                } else {
                    globalShortcut.register(cut.trigger, () => {
                        window.useAppShortcut(cut.action);
                    });
                }
            } else if (cut.type === "shell") {
                globalShortcut.register(cut.trigger, () => {
                    let fn = (cut.linebreak) ? "writelr" : "write";
                    window.term[window.currentTerm][fn](cut.action);
                });
            } else {
                console.warn(`${cut.trigger} has unknown type`);
            }
        });
    };
    window.registerKeyboardShortcuts();

    // Fallback: ensure Text Editor shortcut works even if not in user's shortcuts.json
    document.addEventListener("keydown", (e) => {
        if (e.ctrlKey && e.shiftKey && e.key === "E") {
            e.preventDefault();
            window.useAppShortcut("TEXT_EDITOR");
        }
    });

    // Fallback: Ctrl+Space opens InputComposer
    document.addEventListener("keydown", (e) => {
        if (e.ctrlKey && e.key === " ") {
            e.preventDefault();
            window.useAppShortcut("INPUT_COMPOSER");
        }
    });

    // See #361
    window.addEventListener("focus", () => {
        window.registerKeyboardShortcuts();
    });

    window.addEventListener("blur", () => {
        globalShortcut.unregisterAll();
    });

    // Prevent showing menu, exiting fullscreen or app with keyboard shortcuts
    document.addEventListener("keydown", e => {
        if (e.key === "Alt") {
            e.preventDefault();
        }
        if (e.code.startsWith("Alt") && e.ctrlKey && e.shiftKey) {
            e.preventDefault();
        }
        if (e.key === "F11" && !settings.allowWindowed) {
            e.preventDefault();
        }
        if (e.code === "KeyD" && e.ctrlKey) {
            e.preventDefault();
        }
        if (e.code === "KeyA" && e.ctrlKey) {
            e.preventDefault();
        }
    });

    // Fix #265
    window.addEventListener("keyup", e => {
        if (require("os").platform() === "win32" && e.key === "F4" && e.altKey === true) {
            remote.app.quit();
        }
        // Add Cmd+Q for macOS
        if (require("os").platform() === "darwin" && e.key === "q" && e.metaKey === true) {
            remote.app.quit();
        }
    });

    // Fix double-tap zoom on touchscreens
    electron.webFrame.setVisualZoomLevelLimits(1, 1);

    // Resize terminal with window
    window.onresize = () => {
        if (typeof window.currentTerm !== "undefined") {
            if (typeof window.term[window.currentTerm] !== "undefined") {
                window.term[window.currentTerm].fit();
            }
        }
    };

    // See #413
    window.resizeTimeout = null;
    let electronWin = remote.getCurrentWindow();
    electronWin.on("resize", () => {
        if (settings.keepGeometry === false) return;
        clearTimeout(window.resizeTimeout);
        window.resizeTimeout = setTimeout(() => {
            let win = remote.getCurrentWindow();
            if (win.isFullScreen()) return false;
            if (win.isMaximized()) {
                win.unmaximize();
                win.setFullScreen(true);
                return false;
            }

            let size = win.getSize();

            if (size[0] >= size[1]) {
                win.setSize(size[0], parseInt(size[0] * 9 / 16));
            } else {
                win.setSize(size[1], parseInt(size[1] * 9 / 16));
            }
        }, 100);
    });

    electronWin.on("leave-full-screen", () => {
        remote.getCurrentWindow().setSize(960, 540);
    });

} catch (e) {
    const fs = require('fs');
    const path = require('path');
    const logFile = path.join(__dirname, '..', 'renderer_debug.log');
    try { fs.appendFileSync(logFile, `[FATAL] ${e.message}\n${e.stack}\n`); } catch (err) { }
}

// Handle DevTools state changes to prevent grey zone
ipc.on('devtools-state-changed', (event, isOpen) => {
    // Force multiple resize attempts to ensure proper layout
    const forceResize = () => {
        if (typeof window.currentTerm !== "undefined") {
            if (typeof window.term[window.currentTerm] !== "undefined") {
                // Force terminal to recalculate dimensions
                window.term[window.currentTerm].fit();
            }
        }
        // Trigger window resize event
        window.dispatchEvent(new Event('resize'));
    };

    // Multiple resize attempts with delays to handle race conditions
    setTimeout(forceResize, 50);
    setTimeout(forceResize, 150);
    setTimeout(forceResize, 300);
});
