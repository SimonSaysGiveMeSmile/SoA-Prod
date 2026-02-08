# Post-Phase-1&2 Bugfix Handoff

**Date:** 2026-02-08
**Branch:** `main`
**Context:** After executing Phase 1 (fix network traffic UI) and Phase 2 (profile UI load time), regressions were introduced. Two rounds of fixes have been applied.

---

## Issue 1: Gray Layer Over Terminal Screen

### Symptom
- Gray grid-pattern overlay covers the terminal area below rendered text
- Terminal renders only ~35 rows on 1080p display, leaving ~400px of empty space
- Only disappeared when pressing Ctrl+Shift+I (DevTools toggle, which fires resize → refit)

### Root Cause (CORRECTED)
The **original diagnosis was wrong**. The problem was NOT timing of `fit()` calls. The real issue:

1. The xterm `fit()` addon calculates rows based on container dimensions divided by character cell size
2. On this system, `proposeDimensions()` returns 35 rows — this leaves empty space below the terminal text
3. The `<pre>` and `<div#main_shell_innercontainer>` elements had **no background-color set** (transparent)
4. The body CSS uses a dark gray grid pattern: `background: linear-gradient(...) var(--color_grey)`
5. The gray body background bled through the transparent container into the unfilled terminal area

The xterm `.xterm-viewport` has `background-color: #000` but it only covers the rendered rows area (35 rows × ~17px = ~595px). The remaining ~400px of the `<pre>` container was transparent.

**Why `fit()` returns 35 rows on a 1080p screen is a separate issue** — the fitAddon may be miscalculating due to the stacked `<pre>` layout (5 pre elements each at `height: 100%` in a flex column), but this is cosmetic since the terminal is fully functional.

### First Fix (FAILED — commit bcab2a4)
```javascript
// setTimeout refit at 200ms — did NOT solve the issue
// ResizeObserver + 500ms/1500ms fallback — also did NOT solve it
// The problem was never timing — it was the missing background color
```

### Second Fix (APPLIED — current)
**File:** `src/assets/css/main_shell.css` (line 115)
```css
div#main_shell_innercontainer,
div#main_shell_innercontainer pre {
    height: 100%;
    width: 100%;
    margin: 0vh;
    overflow: hidden;
    background-color: #000;  /* <-- ADDED: prevents body gray grid from bleeding through */
}
```

**File:** `src/_renderer.js` — Simplified the refit logic to a single 500ms fallback timeout (removed ResizeObserver + multiple timeouts that were trying to solve the wrong problem).

### If Still Broken
- If the background color doesn't match the terminal theme, set it dynamically:
  ```javascript
  document.getElementById("main_shell_innercontainer").style.backgroundColor = window.theme.terminal.background;
  ```
- The **35-row limit** is a separate fit calculation issue. To investigate:
  - Check `fitAddon.proposeDimensions()` return value in DevTools console
  - The stacked `<pre>` layout (5 pre elements × `height: 100%` in flex column with `overflow: hidden`) may confuse the measurement
  - Try: `document.getElementById("terminal0").getBoundingClientRect()` to see actual height
  - Compare with `document.getElementById("main_shell_innercontainer").getBoundingClientRect()`
  - If pre height < innercontainer height, the CSS stacking strategy is the cause

---

## Issue 2: Network Traffic Graph Not Rendering (RESOLVED in bcab2a4)

### Symptom
- UP/DOWN bandwidth text values update correctly
- The chart/graph area is blank — no line/area visualization

### Root Cause
Deferred widgets (`todoWidget` and `agentList`) used `this.parent.innerHTML += ...` which destroys all sibling DOM nodes. The SmoothieChart was rendering to the old (destroyed) canvas.

### Fix Applied (bcab2a4)
- `todoWidget.class.js`: `innerHTML +=` → `createElement` + `appendChild`
- `agentList.class.js`: `innerHTML +=` → `createElement` + `appendChild`

**Status: RESOLVED** — Chart renders correctly.

---

## Issue 3: PANIC Error Modals on UI Load

### Symptom
- Multiple PANIC modals pop up: "Error: read ECONNRESET at node:events 495:7"
- Appears 3 times on startup

### Root Cause (CORRECTED)
The **original diagnosis identified 5 error sources** but missed the primary one. The first round of fixes (bcab2a4) addressed widget null guards and WebSocket error handling, but the ECONNRESET PANICs persisted because:

1. **`updateChecker.class.js`**: `https.get()` had `.on('error')` on the request but **NO `res.on('error')`** on the response stream. When the response stream gets ECONNRESET, Node.js EventEmitter throws at `node:events 495:7`.

2. **`geolite2-redist` library** (used by `netstat.class.js`): Downloads GeoIP databases via HTTPS internally. If any download gets ECONNRESET, the library's internal response streams may lack error handlers — we can't control this.

3. **`window.onerror` handler**: Treated ALL uncaught exceptions as PANIC-worthy, including transient network errors that are expected in any network-dependent application.

### First Fix (PARTIALLY EFFECTIVE — commit bcab2a4)
- Added null guards to prevent widget init errors
- Changed WebSocket onerror from `throw` to `console.error`
- Added `res.on('error')` to `netstat.class.js` HTTPS response
- **Did NOT fix**: updateChecker response stream, window.onerror filtering

### Second Fix (APPLIED — current)

**File: `src/classes/updateChecker.class.js`** — Added `res.on('error')` handler:
```javascript
}, res => {
    res.on('error', e => {
        this._fail(e);
    });
    // ... rest of response handling
```

**File: `src/_renderer.js` `initGraphicalErrorHandling()`** — Two changes:

1. Added `process.on('uncaughtException')` in renderer to catch Node.js EventEmitter errors from third-party libs (geolite2-redist):
```javascript
process.on('uncaughtException', (error) => {
    if (error && isNetworkError(error.message || '', error.code || '')) {
        console.warn('[Renderer] Network error (suppressed):', error.message);
        return;
    }
    throw error;  // Re-throw non-network errors for window.onerror
});
```

2. Modified `window.onerror` to filter network error codes:
```javascript
const NETWORK_ERROR_CODES = ['ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'EPIPE', 'EAI_AGAIN'];
// If error matches, log as warning instead of showing PANIC modal
```

**Verified output:**
```
*  note      Suppressed network error: Uncaught Error: read ECONNRESET  (×3)
*  note      UpdateChecker: Could not fetch latest release from GitHub's API.
```
No PANIC modals appear.

### If Still Broken
- If non-network PANIC modals appear, the `isNetworkError()` filter may be too aggressive — check if it's suppressing real errors
- If ECONNRESET PANICs return, a new HTTPS caller was added without `res.on('error')` — search: `grep -rn "https.get\|http.get" src/classes/` and verify each has both request AND response error handlers
- The `geolite2-redist` library does internal HTTPS downloads that we can't add error handlers to — the `process.on('uncaughtException')` catch is the safety net for this
- Check if `window.onunhandledrejection` is needed for promise-based network errors

---

## Files Modified (total across both rounds)

| File | Round 1 (bcab2a4) | Round 2 (current) |
|------|-------------------|-------------------|
| `src/assets/css/main_shell.css` | — | Added `background-color: #000` to terminal containers |
| `src/_renderer.js` | try/catch wrap, debug logging, profiler marks, terminal refit setTimeout | Network error filter in `window.onerror`, `process.on('uncaughtException')`, simplified refit |
| `src/classes/updateChecker.class.js` | — | Added `res.on('error')` on HTTPS response stream |
| `src/classes/netstat.class.js` | Proper .catch() for GeoIP init | Added `res.on('error')` on HTTPS response stream |
| `src/classes/conninfo.class.js` | Null guard + single chart refactor | — |
| `src/classes/agentList.class.js` | innerHTML += → createElement+appendChild | — |
| `src/classes/todoWidget.class.js` | innerHTML += → createElement+appendChild | — |
| `src/classes/terminal.class.js` | WebSocket onerror: throw → console.error | — |
| `src/classes/locationGlobe.class.js` | Null guards for netstat/globe | — |
| `src/classes/toplist.class.js` | Null guard for window.keyboard | — |
| `src/classes/fuzzyFinder.class.js` | Null guard for window.keyboard | — |
| `src/_boot.js` | Re-enabled remoteMain.enable, profiler marks | — |
| `src/_multithread.js` | Route stateful SI to main process | — |
| `src/classes/widgetLoader.class.js` | widgetDataReady tracking (dead code) | — |

---

## Known Remaining Issues

1. **Terminal fits to 35 rows on 1080p** — The xterm fitAddon's `proposeDimensions()` returns too few rows. Likely caused by the stacked `<pre>` layout (5 elements at `height: 100%`). The `background-color: #000` fix makes this cosmetic-only (black space instead of gray).

2. **`widgetDataReady()` is dead code** — Phase 2 added `WidgetLoader.widgetDataReady()` expecting 8 widgets to call `window._widgetDataReady(name)`, but no widget was modified to call it. The `onStartupComplete` callback and `startup-complete` profiler mark never fire.

3. **CWD tracking on Windows** — `Error: Waiting for prompt-based CWD detection` and `Error: Unsupported OS` appear in logs. Pre-existing; not related to Phase 1/2.

4. **Renderer wrapped in try/catch** — Phase 2 wrapped the entire `_renderer.js` in a try/catch that silently logs errors to `renderer_debug.log`. This can mask real initialization failures.

---

## Planning Context

- **Project:** Son of Anton (Electron terminal/system monitor)
- **Planning dir:** `.planning/`
- **Roadmap:** `.planning/ROADMAP.md`
- **State:** `.planning/STATE.md`
- **Phase 1 plans:** `.planning/phases/01-fix-network-traffic-ui/`
- **Phase 2 plans:** `.planning/phases/02-profile-ui-load-time/`
- **Code audit:** `.planning/CODE_ISSUES_AUDIT.md`
- **Remediation plan:** `.planning/REMEDIATION_GAMEPLAN.md`
