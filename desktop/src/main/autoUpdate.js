// Auto-update wiring (GitHub releases, publish provider: github).
//
// Only runs in packaged builds. When running from source (`npm start`),
// `app.isPackaged` is false and this module no-ops so dev workflows don't
// hit the live update server.
//
// Downloads install in the background and are applied on next restart.

const { app, autoUpdater: builtinAutoUpdater, dialog } = require("electron");
const signale = require("signale");

function setupAutoUpdater() {
    if (!app.isPackaged) {
        signale.info("[updater] skipped (running from source)");
        return;
    }

    if (process.env.SOA_DISABLE_AUTO_UPDATE === "1") {
        signale.info("[updater] skipped (SOA_DISABLE_AUTO_UPDATE=1)");
        return;
    }

    let autoUpdater;
    try {
        autoUpdater = require("electron-updater").autoUpdater;
    } catch (e) {
        signale.warn("[updater] electron-updater not installed — skipping");
        return;
    }

    autoUpdater.logger = signale;
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;

    autoUpdater.on("checking-for-update", () => {
        signale.info("[updater] checking for update…");
    });
    autoUpdater.on("update-available", (info) => {
        signale.success(`[updater] update available: ${info.version}`);
    });
    autoUpdater.on("update-not-available", () => {
        signale.info("[updater] already on latest version");
    });
    autoUpdater.on("download-progress", (p) => {
        signale.info(`[updater] downloading: ${p.percent.toFixed(1)}% (${p.bytesPerSecond} B/s)`);
    });
    autoUpdater.on("update-downloaded", (info) => {
        signale.success(`[updater] update downloaded: ${info.version} — will install on quit`);
    });
    autoUpdater.on("error", (err) => {
        signale.warn(`[updater] error: ${err && err.message ? err.message : err}`);
    });

    autoUpdater.checkForUpdates().catch((err) => {
        signale.warn(`[updater] initial check failed: ${err && err.message ? err.message : err}`);
    });

    const FOUR_HOURS = 4 * 60 * 60 * 1000;
    setInterval(() => {
        autoUpdater.checkForUpdates().catch(() => { /* ignore */ });
    }, FOUR_HOURS);
}

module.exports = { setupAutoUpdater };
