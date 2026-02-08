# Post-Phase-1&2 Bugfix Handoff

**Date:** 2026-02-08
**Branch:** `main`
**Commit:** (see git log for `fix: resolve gray overlay, chart rendering, and panic alerts`)
**Context:** After executing Phase 1 (fix network traffic UI) and Phase 2 (profile UI load time), three regressions were introduced.

---

## Issue 1: Gray Layer Over Terminal Screen

### Symptom
- Gray overlay covers the terminal area (middle of UI)
- Only disappears when pressing Ctrl+Shift+I (DevTools toggle)

### Root Cause
The xterm WebGL addon canvas isn't properly sized on first render. The terminal's `fit()` call happens inside `socket.onopen` before the WebGL context finishes initializing. The body's dark gray CSS grid background (`--color_grey: #262828`) shows through the un-filled canvas area. DevTools toggle fires a window resize event which re-calls `fit()` — at that point WebGL is ready, so it sizes correctly.

### Fix Applied
**File:** `src/_renderer.js` (lines 829-837)
```javascript
// Force terminal refit after WebGL canvas initialization settles.
setTimeout(() => {
    if (window.term && window.term[window.currentTerm]) {
        window.term[window.currentTerm].fit();
    }
}, 200);
```

### If Still Broken
- Increase the timeout from 200ms to 500ms or 1000ms
- Or hook into a WebGL `oncontextready` event if available
- Or add a `ResizeObserver` on the terminal container to auto-fit on dimension changes
- Check that `pre#terminal0.active` has proper `width: 100%; height: 100%` in CSS
- Check xterm.css is loaded before terminal init

---

## Issue 2: Network Traffic Graph Not Rendering

### Symptom
- UP/DOWN bandwidth text values update correctly
- The chart/graph area is blank — no line/area visualization

### Root Cause
Deferred widgets (`todoWidget` and `agentList`) used `this.parent.innerHTML += ...` to append their DOM. This operation serializes the entire parent element, destroys all existing child DOM nodes, and re-parses from HTML. The SmoothieChart instance in `conninfo` was still referencing the **old, destroyed `<canvas>` element** and rendering to it invisibly. The new canvas in the DOM received no rendering.

**Loading order (right column):**
```
Heavy (sequential): netstat -> globe -> conninfo  (conninfo binds SmoothieChart to canvas)
Deferred (after all heavy): todoWidget  <-- innerHTML += destroys conninfo's canvas
```

### Fix Applied
**File:** `src/classes/todoWidget.class.js` (lines 11-20)
```javascript
// Before (destructive): this.parent.innerHTML += `<div id="mod_todoWidget">...`;
// After (safe):
let wrapper = document.createElement("div");
wrapper.setAttribute("id", "mod_todoWidget");
wrapper.innerHTML = `<div id="mod_todoWidget_innercontainer">...`;
this.parent.appendChild(wrapper);
```

**File:** `src/classes/agentList.class.js` (lines 5-12)
Same pattern: `innerHTML +=` replaced with `createElement` + `appendChild`.

### If Still Broken
- Check that `SmoothieChart.streamTo()` is called with the correct canvas element
- Verify `<canvas id="mod_conninfo_canvas">` exists in DOM after all widgets load
- Check that any OTHER widget in the same column doesn't also use `innerHTML +=`
- Run `document.getElementById("mod_conninfo_canvas")` in DevTools to confirm it's not null
- The `SmoothieChart` library (`smoothie.js`) must be loaded before `conninfo.class.js`

---

## Issue 3: Panic Alerts on UI Load

### Symptom
- Multiple PANIC error modals pop up when UI first loads

### Root Cause
The global `window.onerror` handler (set in `initGraphicalErrorHandling()` at `_renderer.js:330`) catches uncaught exceptions and creates `Modal({ type: "error" })` which renders as "PANIC". Five categories of uncaught exceptions were identified:

| # | File | Line | Problem |
|---|------|------|---------|
| 1 | `terminal.class.js` | 187 | `this.socket.onerror = e => { throw JSON.stringify(e) }` — WebSocket errors thrown as uncaught exceptions |
| 2 | `conninfo.class.js` | 97 | `window.mods.netstat.offline` accessed without null check |
| 3 | `locationGlobe.class.js` | 142,173,269 | `window.mods.netstat.*` and `window.mods.globe.*` accessed without null checks |
| 4 | `netstat.class.js` | 50-57 | `.catch(e => { throw e })` re-throws promise rejection in GeoIP init |
| 5 | `toplist.class.js` / `fuzzyFinder.class.js` | various | `window.keyboard.detach()/attach()` called on undefined |

### Fixes Applied

**`terminal.class.js:187`** — Replaced `throw` with `console.error()` + non-blocking warning Modal

**`conninfo.class.js:97`** — Added `if (!window.mods.netstat) { return; }` guard

**`locationGlobe.class.js`** — Added null guards in `updateLoc()`, `updateConns()`, `addTemporaryConnectedMarker()`

**`netstat.class.js:50-57`** — Replaced `.catch(e => { throw e })` with proper `.catch()` handlers that log and set `lastconn.finished = true`

**`toplist.class.js` + `fuzzyFinder.class.js`** — Added `if (window.keyboard && window.keyboard.detach)` guards

### If Still Broken
- Open DevTools Console (Ctrl+Shift+I) BEFORE the app loads to see the actual error messages
- Search for other `throw` statements in `src/classes/*.class.js` that might fire during init
- Check that `window.mods` is initialized as `{}` before any widget constructor runs
- Check the widget loading order in `src/classes/widgetLoader.class.js` — dependent widgets must load after their dependencies
- Look for `window.onerror` or `window.onunhandledrejection` handlers in `_renderer.js`

---

## Other Change: `_boot.js` line 222

Re-enabled `remoteMain.enable(win.webContents)` — was previously disabled with comment "not supported in @electron/remote 1.x". This is functionally neutral since `enableRemoteModule: true` in webPreferences already enables it.

---

## Files Modified (10 total)

| File | Change |
|------|--------|
| `src/_boot.js` | Re-enabled remoteMain.enable |
| `src/_renderer.js` | Delayed terminal fit() + debug logging wrapper + profiling |
| `src/classes/agentList.class.js` | innerHTML += → createElement + appendChild |
| `src/classes/todoWidget.class.js` | innerHTML += → createElement + appendChild |
| `src/classes/terminal.class.js` | WebSocket onerror: throw → console.error |
| `src/classes/conninfo.class.js` | Null guard for window.mods.netstat |
| `src/classes/locationGlobe.class.js` | Null guards for netstat/globe dependencies |
| `src/classes/netstat.class.js` | Proper .catch() for GeoIP init |
| `src/classes/toplist.class.js` | Null guard for window.keyboard |
| `src/classes/fuzzyFinder.class.js` | Null guard for window.keyboard |

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
