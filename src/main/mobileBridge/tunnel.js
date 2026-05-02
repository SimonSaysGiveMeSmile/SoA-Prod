/**
 * Mobile Bridge — Public Tunnel
 *
 * Wraps `localtunnel` so the bridge can also be reached from outside the LAN.
 * If the package isn't installed (e.g. in a stripped build) we degrade gracefully
 * and just expose the LAN URL.
 *
 * The tunnel is best-effort: failures here never prevent the local server from
 * starting. Callers receive { url, close() } or null.
 */

let localtunnel = null;
try {
    localtunnel = require('localtunnel');
} catch (_) {
    localtunnel = null;
}

async function openTunnel(port) {
    if (!localtunnel) return null;
    try {
        const t = await localtunnel({ port });
        return {
            url: t.url,
            close: () => { try { t.close(); } catch (_) { /* ignore */ } },
        };
    } catch (_) {
        return null;
    }
}

module.exports = { openTunnel, available: !!localtunnel };
