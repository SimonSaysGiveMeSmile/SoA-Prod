const signale = require("signale");
const profiler = require("./performance/startupProfiler");
profiler.mark('boot-start');
const { app, BrowserWindow, dialog, shell, session, systemPreferences } = require("electron");
const net = require("net");

// Helper function to check if a port is available
function isPortAvailable(port) {
    return new Promise((resolve) => {
        const server = net.createServer();
        server.once('error', () => {
            resolve(false);
        });
        server.once('listening', () => {
            server.close();
            resolve(true);
        });
        server.listen(port, '127.0.0.1');
    });
}

// Find an available port starting from the given port
async function findAvailablePort(startPort, maxAttempts = 20) {
    for (let i = 0; i < maxAttempts; i++) {
        const port = startPort + i;
        if (await isPortAvailable(port)) {
            return port;
        }
        signale.warn(`Port ${port} already in use, trying next port...`);
    }
    return null;
}

process.on("uncaughtException", e => {
    signale.fatal(e);
    dialog.showErrorBox("Son of Anton crashed", e.message || "Cannot retrieve error message.");
    if (tty) {
        tty.close();
    }
    if (extraTtys) {
        Object.keys(extraTtys).forEach(key => {
            if (extraTtys[key] !== null) {
                extraTtys[key].close();
            }
        });
    }
    process.exit(1);
});

app.on('will-quit', () => {
    cleanupVoiceIPC();
});

signale.start(`Starting Son of Anton v${app.getVersion()}`);
signale.info(`With Node ${process.versions.node} and Electron ${process.versions.electron}`);
signale.info(`Renderer is Chrome ${process.versions.chrome}`);

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
    signale.fatal("Error: Another instance of Son of Anton is already running. Cannot proceed.");
    app.exit(1);
}

const electron = require("electron");
const remoteMain = require('@electron/remote/main');
remoteMain.initialize();
const ipc = electron.ipcMain;
const path = require("path");
const url = require("url");
const fs = require("fs");
const which = require("which");
const Terminal = require("./classes/terminal.class.js").Terminal;
const ClaudeStateManager = require("./classes/claudeState.class.js");
const { setupVoiceIPC, cleanupVoiceIPC } = require('./main/ipc/voiceHandlers');

profiler.mark('modules-loaded');

ipc.on("log", (e, type, content) => {
    signale[type](content);
});

var win, tty, extraTtys;
var claudeStateManager = null;
const settingsFile = path.join(electron.app.getPath("userData"), "settings.json");
const shortcutsFile = path.join(electron.app.getPath("userData"), "shortcuts.json");
const lastWindowStateFile = path.join(electron.app.getPath("userData"), "lastWindowState.json");
const themesDir = path.join(electron.app.getPath("userData"), "themes");
const innerThemesDir = path.join(__dirname, "assets/themes");
const kblayoutsDir = path.join(electron.app.getPath("userData"), "keyboards");
const innerKblayoutsDir = path.join(__dirname, "assets/kb_layouts");
const fontsDir = path.join(electron.app.getPath("userData"), "fonts");
const innerFontsDir = path.join(__dirname, "assets/fonts");

// Unset proxy env variables to avoid connection problems on the internal websockets
// See #222
if (process.env.http_proxy) delete process.env.http_proxy;
if (process.env.https_proxy) delete process.env.https_proxy;

// Bypass GPU acceleration blocklist, trading a bit of stability for a great deal of performance, mostly on Linux
app.commandLine.appendSwitch("ignore-gpu-blocklist");
app.commandLine.appendSwitch("enable-gpu-rasterization");
app.commandLine.appendSwitch("enable-video-decode");

// Fix userData folder not setup on Windows
try {
    fs.mkdirSync(electron.app.getPath("userData"));
    signale.info(`Created config dir at ${electron.app.getPath("userData")}`);
} catch (e) {
    signale.info(`Base config dir is ${electron.app.getPath("userData")}`);
}
// Create default settings file
if (!fs.existsSync(settingsFile)) {
    fs.writeFileSync(settingsFile, JSON.stringify({
        shell: (process.platform === "win32") ? "powershell.exe" : "bash",
        shellArgs: '',
        cwd: electron.app.getPath("userData"),
        keyboard: "en-US",
        theme: "tron",
        termFontSize: 15,
        audio: true,
        audioVolume: 1.0,
        disableFeedbackAudio: false,
        clockHours: 24,
        pingAddr: "1.1.1.1",
        port: 3000,
        nointro: false,
        nocursor: false,
        forceFullscreen: true,
        allowWindowed: false,
        excludeThreadsFromToplist: true,
        hideDotfiles: false,
        fsListView: false,
        experimentalGlobeFeatures: false,
        experimentalFeatures: false,
        disableUITests: true
    }, "", 4));
    signale.info(`Default settings written to ${settingsFile}`);
}
// Create default shortcuts file
if (!fs.existsSync(shortcutsFile)) {
    fs.writeFileSync(shortcutsFile, JSON.stringify([
        { type: "app", trigger: "Ctrl+Shift+C", action: "COPY", enabled: true },
        { type: "app", trigger: "Ctrl+Shift+V", action: "PASTE", enabled: true },
        { type: "app", trigger: "Ctrl+Tab", action: "NEXT_TAB", enabled: true },
        { type: "app", trigger: "Ctrl+Shift+Tab", action: "PREVIOUS_TAB", enabled: true },
        { type: "app", trigger: "Ctrl+Shift+T", action: "NEW_TAB", enabled: true },
        { type: "app", trigger: "Ctrl+1", action: "TAB_1", enabled: true },
        { type: "app", trigger: "Ctrl+2", action: "TAB_2", enabled: true },
        { type: "app", trigger: "Ctrl+3", action: "TAB_3", enabled: true },
        { type: "app", trigger: "Ctrl+4", action: "TAB_4", enabled: true },
        { type: "app", trigger: "Ctrl+5", action: "TAB_5", enabled: true },
        { type: "app", trigger: "Ctrl+6", action: "TAB_6", enabled: true },
        { type: "app", trigger: "Ctrl+7", action: "TAB_7", enabled: true },
        { type: "app", trigger: "Ctrl+8", action: "TAB_8", enabled: true },
        { type: "app", trigger: "Ctrl+9", action: "TAB_9", enabled: true },
        { type: "app", trigger: "Ctrl+0", action: "TAB_10", enabled: true },
        { type: "app", trigger: "Ctrl+X", action: "TAB_X", enabled: true },
        { type: "app", trigger: "Ctrl+Shift+S", action: "SETTINGS", enabled: true },
        { type: "app", trigger: "Ctrl+Shift+K", action: "SHORTCUTS", enabled: true },
        { type: "app", trigger: "Ctrl+Shift+F", action: "FUZZY_SEARCH", enabled: true },
        { type: "app", trigger: "Ctrl+Shift+E", action: "TEXT_EDITOR", enabled: true },
        { type: "app", trigger: "Ctrl+Shift+L", action: "FS_LIST_VIEW", enabled: true },
        { type: "app", trigger: "Ctrl+Shift+H", action: "FS_DOTFILES", enabled: true },
        { type: "app", trigger: "Ctrl+Shift+P", action: "KB_PASSMODE", enabled: true },
        { type: "app", trigger: "Ctrl+Shift+I", action: "DEV_DEBUG", enabled: false },
        { type: "app", trigger: "Ctrl+Shift+F5", action: "DEV_RELOAD", enabled: true },
        { type: "shell", trigger: "Ctrl+Shift+Alt+Space", action: "neofetch", linebreak: true, enabled: false }
    ], "", 4));
    signale.info(`Default keymap written to ${shortcutsFile}`);
}
//Create default window state file
if (!fs.existsSync(lastWindowStateFile)) {
    fs.writeFileSync(lastWindowStateFile, JSON.stringify({
        useFullscreen: true
    }, "", 4));
    signale.info(`Default last window state written to ${lastWindowStateFile}`);
}

// Copy default themes & keyboard layouts & fonts
profiler.mark('asset-copy-start');
signale.pending("Mirroring internal assets...");
try {
    fs.mkdirSync(themesDir);
} catch (e) {
    // Folder already exists
}
fs.readdirSync(innerThemesDir).forEach(e => {
    fs.writeFileSync(path.join(themesDir, e), fs.readFileSync(path.join(innerThemesDir, e), { encoding: "utf-8" }));
});
try {
    fs.mkdirSync(kblayoutsDir);
} catch (e) {
    // Folder already exists
}
fs.readdirSync(innerKblayoutsDir).forEach(e => {
    fs.writeFileSync(path.join(kblayoutsDir, e), fs.readFileSync(path.join(innerKblayoutsDir, e), { encoding: "utf-8" }));
});
try {
    fs.mkdirSync(fontsDir);
} catch (e) {
    // Folder already exists
}
fs.readdirSync(innerFontsDir).forEach(e => {
    fs.writeFileSync(path.join(fontsDir, e), fs.readFileSync(path.join(innerFontsDir, e)));
});

profiler.mark('asset-copy-end');
profiler.measure('asset-copy', 'asset-copy-start', 'asset-copy-end');

// Version history logging
const versionHistoryPath = path.join(electron.app.getPath("userData"), "versions_log.json");
var versionHistory = fs.existsSync(versionHistoryPath) ? require(versionHistoryPath) : {};
var version = app.getVersion();
if (typeof versionHistory[version] === "undefined") {
    versionHistory[version] = {
        firstSeen: Date.now(),
        lastSeen: Date.now()
    };
} else {
    versionHistory[version].lastSeen = Date.now();
}
fs.writeFileSync(versionHistoryPath, JSON.stringify(versionHistory, 0, 2), { encoding: "utf-8" });

function createWindow(settings) {
    signale.info("Creating window...");

    // Grant microphone permission to the renderer process (required for packaged app)
    session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
        if (permission === 'media') {
            callback(true);
            return;
        }
        callback(true);
    });
    session.defaultSession.setPermissionCheckHandler((webContents, permission, requestingOrigin) => {
        if (permission === 'media') return true;
        return true;
    });

    // Request macOS microphone access at app level (triggers system prompt on first launch)
    if (process.platform === 'darwin' && systemPreferences.askForMediaAccess) {
        systemPreferences.askForMediaAccess('microphone').then(granted => {
            signale.info(`Microphone access ${granted ? 'granted' : 'denied'}`);
        }).catch(err => {
            signale.warn(`Microphone permission request failed: ${err.message}`);
        });
    }

    let display;
    if (!isNaN(settings.monitor)) {
        display = electron.screen.getAllDisplays()[settings.monitor] || electron.screen.getPrimaryDisplay();
    } else {
        display = electron.screen.getPrimaryDisplay();
    }
    let { x, y, width, height } = display.bounds;
    width++; height++;
    win = new BrowserWindow({
        title: "Son of Anton",
        x,
        y,
        width,
        height,
        show: true,
        resizable: true,
        movable: settings.allowWindowed || false,
        fullscreen: settings.forceFullscreen || false,
        autoHideMenuBar: true,
        frame: settings.allowWindowed || false,
        backgroundColor: '#000000',
        webPreferences: {
            devTools: true,
            enableRemoteModule: true,
            contextIsolation: false,
            backgroundThrottling: false,
            webSecurity: true,
            nodeIntegration: true,
            nodeIntegrationInSubFrames: false,
            allowRunningInsecureContent: false,
            experimentalFeatures: settings.experimentalFeatures || false
        }
    });

    // Enable @electron/remote for this window
    remoteMain.enable(win.webContents);

    win.loadURL(url.format({
        pathname: path.join(__dirname, 'ui.html'),
        protocol: 'file:',
        slashes: true
    }));

    signale.complete("Frontend window created!");
    profiler.mark('window-created');
    profiler.measure('window-init', 'terminal-created', 'window-created');
    win.show();
    if (!settings.allowWindowed) {
        win.setResizable(false);
    } else if (!require(lastWindowStateFile)["useFullscreen"]) {
        win.setFullScreen(false);
    }

    // Initialize Claude state manager after window is ready
    win.webContents.on('did-finish-load', () => {
        claudeStateManager = new ClaudeStateManager(win);
        claudeStateManager.start();
        signale.success("Claude state manager initialized");

        // Initialize voice IPC handlers
        setupVoiceIPC(win);
        signale.success("Voice IPC handlers initialized");

        // Notify renderer to track when ready
        win.webContents.send('main-window-loaded');
    });

    // Handle DevTools toggle to prevent grey zone issue
    win.webContents.on('devtools-opened', () => {
        // Force window to recalculate layout immediately
        if (win && !win.isDestroyed()) {
            win.webContents.send('devtools-state-changed', true);
        }
    });

    win.webContents.on('devtools-closed', () => {
        // Force window to recalculate layout and resize terminal immediately
        if (win && !win.isDestroyed()) {
            win.webContents.send('devtools-state-changed', false);
        }
    });

    signale.watch("Waiting for frontend connection...");
}

app.on('ready', async () => {
    // Auto-start contentTracing for deep profiling mode
    if (process.env.PROFILE_STARTUP === 'deep') {
        await profiler.startTracing();
    }

    // IPC handler: stop contentTracing when renderer signals startup-complete
    ipc.on('stop-content-tracing', async () => {
        const tracePath = await profiler.stopTracing();
        if (tracePath) {
            signale.info('Trace saved to: ' + tracePath);
        }
    });

    signale.pending(`Loading settings file...`);
    let settings = require(settingsFile);
    signale.pending(`Resolving shell path...`);
    settings.shell = await which(settings.shell).catch(e => { throw (e) });
    signale.info(`Shell found at ${settings.shell}`);
    profiler.mark('shell-resolved');
    signale.success(`Settings loaded!`);
    profiler.mark('settings-loaded');
    profiler.measure('require-time', 'boot-start', 'modules-loaded');
    profiler.measure('settings-load', 'modules-loaded', 'settings-loaded');

    if (!require("fs").existsSync(settings.cwd)) throw new Error("Configured cwd path does not exist.");

    // See #366
    profiler.mark('shell-env-start');
    let cleanEnv = await require("shell-env")(settings.shell).catch(e => { throw e; });
    profiler.mark('shell-env-end');
    profiler.measure('shell-env', 'shell-env-start', 'shell-env-end');

    Object.assign(cleanEnv, {
        TERM: "xterm-256color",
        COLORTERM: "truecolor",
        TERM_PROGRAM: "Son of Anton",
        TERM_PROGRAM_VERSION: app.getVersion()
    }, settings.env);

    signale.pending(`Creating new terminal process on port ${settings.port || '3000'}`);

    // Retry loop to handle EADDRINUSE errors (port taken between check and use)
    const maxRetries = 20;
    let usedPort = settings.port || 3000;

    for (let retry = 0; retry < maxRetries; retry++) {
        try {
            tty = new Terminal({
                role: "server",
                shell: settings.shell,
                params: settings.shellArgs || '',
                cwd: settings.cwd,
                env: cleanEnv,
                port: usedPort
            });
            // If we got here, terminal was created successfully
            break;
        } catch (err) {
            if (err.code === 'EADDRINUSE') {
                signale.warn(`Port ${usedPort} already in use, trying port ${usedPort + 1}...`);
                usedPort++;
                continue;
            }
            // For other errors, fail immediately
            signale.fatal(`Failed to create terminal: ${err.message}`);
            throw err;
        }
    }

    if (!tty) {
        throw new Error("Failed to create terminal: no available ports after retries");
    }

    signale.success(`Terminal back-end initialized on port ${usedPort}!`);
    profiler.mark('terminal-created');
    profiler.measure('terminal-init', 'settings-loaded', 'terminal-created');
    tty.onclosed = (code, signal) => {
        tty.ondisconnected = () => { };
        signale.complete("Terminal exited", code, signal);
        app.quit();
    };
    tty.onopened = () => {
        signale.success("Connected to frontend!");
        profiler.logSummary();
    };
    tty.onresized = (cols, rows) => {
        signale.info("Resized TTY to ", cols, rows);
    };
    tty.ondisconnected = () => {
        signale.error("Lost connection to frontend");
        signale.watch("Waiting for frontend connection...");
    };

    // Support for multithreaded systeminformation calls
    signale.pending("Starting multithreaded calls controller...");
    profiler.mark('multithread-start');
    require("./_multithread.js");
    profiler.mark('multithread-end');
    profiler.measure('multithread-init', 'multithread-start', 'multithread-end');

    createWindow(settings);
    profiler.mark('main-ready');
    profiler.measure('main-total', 'boot-start', 'main-ready');

    // Support for more terminals, used for creating tabs
    // Increase slot count to handle port conflicts (we'll dynamically find available ports)
    extraTtys = {};
    const basePort = Number(settings.port || 3000) + 2;
    const maxTerminals = 10; // Allow up to 10 terminal tabs
    let nextPort = basePort;

    // Pre-populate with slots
    for (let i = 0; i < maxTerminals; i++) {
        extraTtys[basePort + i] = null;
    }

    ipc.on("ttyspawn", async (e, arg) => {
        // Find the first null slot
        let slotKey = null;
        Object.keys(extraTtys).forEach(key => {
            if (extraTtys[key] === null && slotKey === null) {
                slotKey = key;
            }
        });

        if (slotKey === null) {
            signale.error("TTY spawn denied (Reason: exceeded max TTYs number)");
            e.sender.send("ttyspawn-reply", "ERROR: max number of ttys reached");
            return;
        }

        // Find an available port starting from nextPort
        const port = await findAvailablePort(nextPort, 20);

        if (port === null) {
            signale.error("TTY spawn denied (Reason: no available ports)");
            e.sender.send("ttyspawn-reply", "ERROR: no available ports");
            return;
        }

        // Update nextPort to try the next one next time
        nextPort = port + 1;

        // Mark this slot as pending (will be set to the terminal object after creation)
        extraTtys[slotKey] = {};

        signale.pending(`Creating new TTY process on port ${port}`);

        // Retry loop to handle EADDRINUSE errors (port taken between check and use)
        const maxRetries = 10;
        let term = null;
        let usedPort = port;

        for (let retry = 0; retry < maxRetries; retry++) {
            term = null;
            let asyncError = null;

            try {
                term = new Terminal({
                    role: "server",
                    shell: settings.shell,
                    params: settings.shellArgs || '',
                    cwd: tty.tty._cwd || settings.cwd,
                    env: cleanEnv,
                    port: usedPort
                });

                // Handle async errors from WebSocketServer (EADDRINUSE can be emitted after constructor returns)
                if (term.wss) {
                    const errorHandler = (err) => {
                        asyncError = err;
                    };
                    term.wss.on('error', errorHandler);
                }

                // Wait briefly to catch async errors
                await new Promise((resolve) => setTimeout(resolve, 50));

                if (asyncError && asyncError.code === 'EADDRINUSE') {
                    // Clean up
                    try {
                        if (term.wss) term.wss.close();
                        if (term.tty) term.tty.kill();
                    } catch (e) { /* ignore */ }
                    // Wait for port to be released
                    await new Promise((resolve) => setTimeout(resolve, 100));
                    throw asyncError;
                }

                // If we got here, terminal was created successfully
                break;
            } catch (err) {
                if (err.code === 'EADDRINUSE') {
                    signale.warn(`Port ${usedPort} already in use, trying port ${usedPort + 1}...`);
                    usedPort++;
                    // Clean up before retry
                    try {
                        if (term && term.wss) term.wss.close();
                        if (term && term.tty) term.tty.kill();
                    } catch (e) { /* ignore */ }
                    // Wait for port to be released before trying next
                    await new Promise((resolve) => setTimeout(resolve, 100));
                    continue;
                }
                // For other errors, fail immediately
                signale.error(`Failed to create terminal on port ${usedPort}: ${err.message}`);
                extraTtys[slotKey] = null;
                e.sender.send("ttyspawn-reply", "ERROR: failed to create terminal");
                return;
            }
        }

        if (!term) {
            signale.error("TTY spawn denied (Reason: no available ports after retries)");
            extraTtys[slotKey] = null;
            e.sender.send("ttyspawn-reply", "ERROR: no available ports");
            return;
        }

        const finalPort = usedPort;
        signale.success(`New terminal back-end initialized at ${finalPort}`);
        term.onclosed = (code, signal) => {
            term.ondisconnected = () => { };
            term.wss.close();
            signale.complete(`TTY exited at ${finalPort}`, code, signal);
            extraTtys[slotKey] = null;
            term = null;
        };
        term.onopened = pid => {
            signale.success(`TTY ${finalPort} connected to frontend (process PID ${pid})`);
        };
        term.onresized = () => { };
        term.ondisconnected = () => {
            signale.warn(`TTY ${finalPort} disconnected from frontend, waiting for reconnection...`);
        };

        extraTtys[slotKey] = term;
        e.sender.send("ttyspawn-reply", "SUCCESS: " + finalPort);
    });

    ipc.on("ttylist", (e) => {
        let alive = {};
        Object.keys(extraTtys).forEach(port => {
            if (extraTtys[port] !== null) {
                alive[port] = true;
            }
        });
        e.sender.send("ttylist-reply", alive);
    });

    // Backend support for theme and keyboard hotswitch
    let themeOverride = null;
    let kbOverride = null;
    ipc.on("getThemeOverride", (e, arg) => {
        e.sender.send("getThemeOverride", themeOverride);
    });
    ipc.on("getKbOverride", (e, arg) => {
        e.sender.send("getKbOverride", kbOverride);
    });
    ipc.on("setThemeOverride", (e, arg) => {
        themeOverride = arg;
    });
    ipc.on("setKbOverride", (e, arg) => {
        kbOverride = arg;
    });
});

app.on('web-contents-created', (e, contents) => {
    // Prevent creating more than one window
    contents.on('new-window', (e, url) => {
        e.preventDefault();
        shell.openExternal(url);
    });

    // Prevent loading something else than the UI
    contents.on('will-navigate', (e, url) => {
        if (url !== contents.getURL()) e.preventDefault();
    });
});

app.on('window-all-closed', () => {
    signale.info("All windows closed");
    app.quit();
});

app.on('before-quit', () => {
    if (claudeStateManager) {
        claudeStateManager.stop();
    }
    if (tty) {
        tty.close();
    }
    if (extraTtys) {
        Object.keys(extraTtys).forEach(key => {
            if (extraTtys[key] !== null) {
                extraTtys[key].close();
            }
        });
    }
    signale.complete("Shutting down...");
});
