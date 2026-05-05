# Mobile Bridge Feature

Allows a phone to mirror and control the current Son of Anton desktop session by scanning a QR code.

## Architecture

```
Desktop (Electron main process)
  src/main/mobileBridge/
    server.js          HTTP + WebSocket server (port 7330+)
    sessionStore.js    Auth token, last snapshot, connected clients
    protocol.js        Shared message schema (MSG constants, frame/parse helpers)
    tunnel.js          Optional localtunnel for public URL (best-effort)
  src/main/ipc/
    mobileBridgeHandlers.js   IPC: mobile:start / mobile:stop / mobile:status / mobile:qr + push-* events

Desktop (Electron renderer)
  src/classes/
    mobileBridge.class.js     Snapshots UI state, streams terminal output, inbound input
    mobileQRWidget.class.js   MOBILE LINK tile — PAIR, LAN/PUB, QR as <img> from data URL
  src/assets/css/mod_mobileQR.css

Mobile (sibling repo: son-of-anton-mobile/dist/)
  index.html / app.js  PWA shell + app
  socket.js              BridgeSocket (reconnect + heartbeat)
  ansi.js / keyboard.js
```

## How it starts

1. User clicks **PAIR** in **`// MOBILE LINK`**.
2. Renderer: `ipcRenderer.invoke('mobile:start', { withTunnel: true })`.
3. Main builds `MobileBridgeServer`: free port from **7330**, LAN IPv4 from `os.networkInterfaces()` (accepts `family === 'IPv4'` or **`4`**), rotates token in `sessionStore`, HTTP **`0.0.0.0`**, **`/ws?t=`** upgrades, serves **`../son-of-anton-mobile/dist/`** when that path exists else fallback HTML.
4. Optionally **`localtunnel`**; when ready, **`onStatusChanged`** pushes **`mobile:status-changed`** so **`publicUrl`** and QR refresh.
5. QR: **`invoke('mobile:qr', { text: url })`** in main (**`qrcode.toDataURL`**). Renderer draws **`<img src="data:image/png;…">`**. Failures → URL text fallback. **`mobile:start`** failures set **`bridgeError`** on renderer status.

6. Phone: load **`/?t=`** → open **`ws`/`wss`** **`/ws?t=`** → **`hello`** + snapshot replay.

## Snapshot loop

- Runs only while **`running && clients > 0`** (**250 ms**, `SNAPSHOT_THROTTLE_MS`).
- Payload: tabs, active terminal (**~16 KiB** ring buffer in renderer), coarse widget telemetry; plus **`mobile:push-term-data`** for streaming chunks.

## Inbound input (phone → desktop)

Handled in **`MobileBridge._handleInput()`**:

| `kind` | Action |
|---|---|
| `term-keys` | Text to active terminal socket |
| `shell-command` | Line + `\n` |
| `switch-tab` | `focusShellTab(index)` |
| `new-tab` | `addShellTab()` |
| `close-tab` | `closeShellTab(index)` |
| `move-tab` | Reorder the `#shell_tab*` `<li>` nodes (`{ index, before }`; `before === -1` appends)  |
| `hotkey` | Combo → control bytes → socket |
| `voice-toggle` | `toggleMic()` |

## Renderer script-tag constraints

**No top-level `require()`** in files loaded via **`<script src>`** in **`ui.html`** (Electron can black-screen).

- **`mobileBridge.class.js`** uses **`require('electron')`** only inside the **`constructor`**; registers **`ipcRenderer`** listeners there.
- **`globalThis.MobileBridge`** is exported from **`mobileBridge.class.js`** after the class declaration.
- **`mobileQRWidget.class.js`** picks **`MobileBridge`** from **`globalThis`** first; else resolves **`mobileBridge.class.js`** via **`__dirname`** with **`classes/`** and non-**`classes`** fallbacks (**`path` + `fs.existsSync`**), all inside **`_resolveMobileBridge()`**.
- **`qrcode`** is **main-only**; never **`require('qrcode')`** in those widget scripts.

## Dependencies (`src/package.json`)

```json
"ws": "7.5.5",
"localtunnel": "^2.0.2",
"qrcode": "^1.5.4"
```

## Cross-reference

- Mobile PWA specifics: **`son-of-anton-mobile/README.md`**.
- Pitfalls logged: **`.claude/mistakes.md`** (renderer **`require`** / **`qrcode`** / paths).
