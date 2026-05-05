# Session: Terminal Limit & Sleep/Wake Reconnection

**Date:** 2026-04-07
**Commit:** `f4ea9c4` on `main`
**Pushed to:** `origin/main` (SimonSaysGiveMeSmile/son-of-anton-public)

---

## Problem

Two user-reported issues:

1. **Terminal limit too low** — Hard cap of 10 tabs (5 pre-created + 5 addable). Users wanted more.
2. **Sleep/wake crash** — macOS sleep drops WebSocket connections. Client `socket.onclose` fires and destroys the terminal UI (disposes xterm, removes tab). Server-side PTY processes survive but are unreachable. On wake, terminals are gone.

### Root Causes

- `maxTerminals = 10` in `_boot.js:554`, tab loops capped at `< 10` in `_renderer.js`
- No reconnection logic in `terminal.class.js` client — WebSocket close = terminal death
- No `powerMonitor` suspend/resume handling in main process
- `verifyClient` uses `.length` on a Set (always `undefined`), accidentally allowing reconnections but uncontrolled

---

## Changes Made

### Files Modified (3 core + 1 meta)

| File | Changes |
|------|---------|
| `src/_boot.js` | maxTerminals 10→20, powerMonitor suspend/resume IPC |
| `src/_renderer.js` | 7 tab limit locations updated, suspend/resume IPC handlers, DISCONNECTED label, closeShellTab uses terminal.close() |
| `src/classes/terminal.class.js` | WebSocket reconnection with backoff, verifyClient fix, close() method |
| `.claude/mistakes.md` | Added entry about dropped closing brace |

### Change 1: Increase terminal limit to 20 (`_boot.js`)

```js
// Line 554: was 10
const maxTerminals = 20;
```

### Change 2: Increase tab slot limits to 20 (`_renderer.js`)

Seven locations updated:

| Location | Old | New |
|----------|-----|-----|
| Terminal names init loop (line ~97) | `i < 10` | `i < 20` |
| enableTabRename loop (line ~967) | `i < 10` | `i < 20` |
| focusShellTab spawn condition (line ~1958) | `number <= 9` | `number <= 19` |
| addShellTab loop (line ~2058) | `i < 10` | `i < 20` |
| addShellTab hide buttons (line ~2098) | `nextTab >= 9` | `nextTab >= 19` |
| addBrowserShellTab loop (line ~2184) | `i < 10` | `i < 20` |
| addBrowserShellTab hide buttons (line ~2240) | `nextTab >= 9` | `nextTab >= 19` |

Warning messages updated from "10 tabs" to "20 tabs".

### Change 3: WebSocket reconnection (`terminal.class.js` client role)

Extracted WebSocket setup into reusable methods:

- **`_connectWebSocket()`** — Creates WebSocket, sets up onopen (attach addon, fit, send IPC), onclose (triggers reconnect if not intentional), onerror (warn only)
- **`_attachSocketMessageHandler()`** — Reusable message handler for sound FX and globe IP detection (re-attached on reconnect)
- **`_reconnect()`** — Exponential backoff: 500ms → 1s → 2s → 4s... max 30s, up to 60 retries. Shows yellow warning in terminal, green success on reconnect, red failure after exhaustion. Only calls `onclose` after all retries fail.
- **`close()`** — Sets `_intentionallyClosed = true`, clears reconnect timer, closes socket cleanly

Key design decisions:
- `this.term` (xterm instance) stays alive throughout — only WebSocket and AttachAddon change
- Old AttachAddon is disposed before attaching new one on reconnect
- `_intentionallyClosed` flag prevents reconnection when user explicitly closes a tab
- `closeShellTab` in `_renderer.js` updated to call `terminal.close()` instead of `socket.close()` directly

### Change 4: Fix `verifyClient` (`terminal.class.js` server role)

```js
// Before: BUG — Set has .size not .length, so this was always undefined >= 1 = false
if (this.wss.clients.length >= 1) { return false; }

// After: Clean stale connections, count active ones properly
for (const client of this.wss.clients) {
    if (client.readyState !== 1) client.terminate();
}
let activeClients = 0;
for (const client of this.wss.clients) {
    if (client.readyState === 1) activeClients++;
}
return activeClients < 1;
```

### Change 5: powerMonitor suspend/resume (`_boot.js`)

After `createWindow(settings)`:

```js
const { powerMonitor } = electron;
powerMonitor.on('suspend', () => { win.webContents.send('system-suspend'); });
powerMonitor.on('resume', () => { win.webContents.send('system-resume'); });
```

### Change 6: Suspend/resume IPC handlers (`_renderer.js`)

- `system-suspend`: Sets `window._systemSuspended = true`, writes yellow warning to all active terminals
- `system-resume`: Sets flag false, waits 1s for network stack, then calls `_reconnect()` on all terminals that have it

### Change 7: DISCONNECTED label (`_renderer.js`)

Terminal `onclose` handler (fires only after all reconnection retries exhausted) now shows "DISCONNECTED" instead of "EMPTY" so users know what happened.

---

## Bug Found & Fixed During Implementation

**Issue:** My edit to `addShellTab` accidentally dropped the closing `}` and `return;` from the `if (nextTab === -1)` block, leaving an unmatched brace that broke the file's syntax.

**Detection:** `node -c src/_renderer.js` caught it. Used brace-balance analysis and `git diff` hunk inspection to isolate the exact location.

**Fix:** Added back the missing `return;` and `}`.

**Logged in:** `.claude/mistakes.md`

---

## Pre-existing Working Tree Changes (also committed)

The commit also included pre-existing modifications that were already in the working tree:

- `package.json` / `package-lock.json` — dependency changes
- `src/assets/css/main_shell.css` — styling updates
- `src/assets/vendor/encom-globe.js` — globe widget changes
- `src/classes/browserTab.class.js` — browser tab class
- `src/classes/textEditor.class.js` — text editor class

These were from prior sessions and included features like browser tabs, power menu, Claude permission settings, etc.

---

## Verification Steps

1. All 3 modified files pass `node -c` syntax check
2. Brace balance verified (0 net difference)
3. Commit `f4ea9c4` pushed to `origin/main`

## Testing Checklist (manual)

- [ ] `npm start` — app launches normally
- [ ] Open 6+ terminal tabs beyond initial 5
- [ ] Open 15+ tabs to verify increased limit
- [ ] Put Mac to sleep, wake — terminals reconnect automatically
- [ ] Check DevTools console for reconnection messages
- [ ] Terminal content remains intact after reconnection
- [ ] Close tabs — clean up properly (no orphaned PTYs)
- [ ] Kill a terminal backend manually (`kill <pid>`) — shows DISCONNECTED after retries
