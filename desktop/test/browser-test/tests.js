// ── Debug Console ──
const consoleEl = document.getElementById('console-output');
function log(msg, type = 'log') {
    const line = document.createElement('div');
    line.className = type;
    line.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
    consoleEl.appendChild(line);
    consoleEl.scrollTop = consoleEl.scrollHeight;
}
function clearConsole() { consoleEl.innerHTML = ''; }

// ── Stats ──
let totalTests = 0, passed = 0, failed = 0;
function updateStats() {
    document.getElementById('stat-tests').textContent = totalTests;
    document.getElementById('stat-passed').textContent = passed;
    document.getElementById('stat-failed').textContent = failed;
}
function markTest(id, ok, detail) {
    totalTests++;
    if (ok) { passed++; } else { failed++; }
    const el = document.getElementById(id);
    if (el) el.textContent = ok ? '✅' : '❌';
    log(`${id.replace('test-','')} → ${ok ? 'PASS' : 'FAIL'}${detail ? ': '+detail : ''}`,
        ok ? 'pass' : 'fail');
    updateStats();
}

// ── Connection check ──
(async function checkConnection() {
    try {
        const r = await fetch('https://httpbin.org/get', { mode: 'no-cors' });
        document.getElementById('connection-status').className = 'status-dot online';
        document.getElementById('connection-text').textContent = 'Online';
        log('Network: online', 'info');
    } catch {
        document.getElementById('connection-status').className = 'status-dot offline';
        document.getElementById('connection-text').textContent = 'Offline';
        log('Network: offline (expected for file:// protocol)', 'warn');
    }
})();

// ── Rendering Tests (auto-run) ──
window.addEventListener('DOMContentLoaded', () => {
    // CSS Grid/Flexbox
    const flexItems = document.querySelectorAll('.flex-item');
    markTest('test-css', flexItems.length === 3, `${flexItems.length} flex items rendered`);

    // CSS Animations
    const spinner = document.querySelector('.spinner');
    const style = getComputedStyle(spinner);
    const hasAnim = style.animationName && style.animationName !== 'none';
    markTest('test-anim', hasAnim, `animation: ${style.animationName}`);

    // Canvas 2D
    try {
        const canvas = document.getElementById('canvas-test');
        const ctx = canvas.getContext('2d');
        const grad = ctx.createLinearGradient(0, 0, 200, 0);
        grad.addColorStop(0, '#00ffc8');
        grad.addColorStop(1, '#ff00ff');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, 200, 80);
        ctx.fillStyle = '#0a0e17';
        ctx.font = 'bold 16px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('Canvas OK', 100, 46);
        markTest('test-canvas', true, '2D context working');
    } catch (e) {
        markTest('test-canvas', false, e.message);
    }

    // SVG
    const svg = document.querySelector('svg');
    markTest('test-svg', svg && svg.getBBox().width > 0, 'SVG rendered');

    log('Rendering tests complete', 'info');
});

// ── Permission Tests ──
async function testGeolocation() {
    const out = document.getElementById('geo-output');
    out.textContent = 'Requesting...';
    try {
        const pos = await new Promise((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 8000 });
        });
        const { latitude, longitude } = pos.coords;
        out.textContent = `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`;
        markTest('test-geo', true, `lat=${latitude.toFixed(2)}`);
    } catch (e) {
        out.textContent = e.message;
        markTest('test-geo', false, e.message);
    }
}

async function testNotifications() {
    const out = document.getElementById('notif-output');
    out.textContent = 'Requesting...';
    try {
        const perm = await Notification.requestPermission();
        if (perm === 'granted') {
            new Notification('Son of Anton', { body: 'Browser test notification' });
            out.textContent = 'Permission: granted';
            markTest('test-notif', true, 'granted');
        } else {
            out.textContent = `Permission: ${perm}`;
            markTest('test-notif', false, perm);
        }
    } catch (e) {
        out.textContent = e.message;
        markTest('test-notif', false, e.message);
    }
}

async function testClipboard() {
    const out = document.getElementById('clip-output');
    out.textContent = 'Testing...';
    try {
        const testStr = 'SoA-test-' + Date.now();
        await navigator.clipboard.writeText(testStr);
        const read = await navigator.clipboard.readText();
        const ok = read === testStr;
        out.textContent = ok ? 'Read/Write OK' : `Mismatch: ${read}`;
        markTest('test-clip', ok, ok ? 'clipboard round-trip' : 'mismatch');
    } catch (e) {
        out.textContent = e.message;
        markTest('test-clip', false, e.message);
    }
}

async function testMedia() {
    const out = document.getElementById('media-output');
    out.textContent = 'Requesting...';
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach(t => t.stop());
        out.textContent = 'Mic access granted';
        markTest('test-media', true, 'audio stream OK');
    } catch (e) {
        out.textContent = e.message;
        markTest('test-media', false, e.message);
    }
}

// ── Network & API Tests ──
async function testFetch() {
    const out = document.getElementById('fetch-output');
    out.textContent = 'Fetching...';
    try {
        const r = await fetch('https://httpbin.org/get');
        const data = await r.json();
        out.textContent = `Status: ${r.status}, origin: ${data.origin}`;
        markTest('test-fetch', r.ok, `HTTP ${r.status}`);
    } catch (e) {
        out.textContent = e.message;
        markTest('test-fetch', false, e.message);
    }
}

function testWebSocket() {
    const out = document.getElementById('ws-output');
    out.textContent = 'Connecting...';
    try {
        const ws = new WebSocket('wss://echo.websocket.org');
        const timeout = setTimeout(() => {
            ws.close();
            out.textContent = 'Timeout (server may be down)';
            markTest('test-ws', false, 'timeout');
        }, 5000);
        ws.onopen = () => {
            ws.send('SoA-ping');
        };
        ws.onmessage = (e) => {
            clearTimeout(timeout);
            out.textContent = `Echo: ${e.data}`;
            markTest('test-ws', true, 'echo received');
            ws.close();
        };
        ws.onerror = () => {
            clearTimeout(timeout);
            out.textContent = 'WebSocket API available (server unreachable)';
            markTest('test-ws', true, 'API exists, server down');
        };
    } catch (e) {
        out.textContent = e.message;
        markTest('test-ws', false, e.message);
    }
}

function testStorage() {
    const out = document.getElementById('storage-output');
    out.textContent = 'Testing...';
    try {
        const key = 'soa-test';
        const val = 'browser-' + Date.now();
        localStorage.setItem(key, val);
        const read = localStorage.getItem(key);
        localStorage.removeItem(key);
        const ok = read === val;
        out.textContent = ok ? 'Read/Write/Delete OK' : 'Mismatch';
        markTest('test-storage', ok, ok ? 'localStorage round-trip' : 'mismatch');
    } catch (e) {
        out.textContent = e.message;
        markTest('test-storage', false, e.message);
    }
}

function testWorker() {
    const out = document.getElementById('worker-output');
    out.textContent = 'Spawning...';
    try {
        const blob = new Blob([`
            self.onmessage = function(e) {
                self.postMessage('echo:' + e.data);
            };
        `], { type: 'application/javascript' });
        const url = URL.createObjectURL(blob);
        const w = new Worker(url);
        const timeout = setTimeout(() => {
            w.terminate();
            out.textContent = 'Worker timeout';
            markTest('test-worker', false, 'timeout');
        }, 3000);
        w.onmessage = (e) => {
            clearTimeout(timeout);
            out.textContent = `Response: ${e.data}`;
            markTest('test-worker', true, 'blob worker OK');
            w.terminate();
            URL.revokeObjectURL(url);
        };
        w.onerror = (e) => {
            clearTimeout(timeout);
            out.textContent = e.message || 'Worker error';
            markTest('test-worker', false, e.message);
        };
        w.postMessage('SoA-test');
    } catch (e) {
        out.textContent = e.message;
        markTest('test-worker', false, e.message);
    }
}

// ── Run All ──
function runAllTests() {
    totalTests = 0; passed = 0; failed = 0;
    updateStats();
    clearConsole();
    log('Running all tests...', 'info');

    // Reset all indicators
    document.querySelectorAll('.test-result').forEach(el => el.textContent = '⏳');

    // Re-run rendering tests
    const flexItems = document.querySelectorAll('.flex-item');
    markTest('test-css', flexItems.length === 3, `${flexItems.length} flex items`);
    const spinner = document.querySelector('.spinner');
    const style = getComputedStyle(spinner);
    markTest('test-anim', style.animationName !== 'none', style.animationName);
    try {
        const c = document.getElementById('canvas-test');
        markTest('test-canvas', !!c.getContext('2d'), '2D context');
    } catch (e) { markTest('test-canvas', false, e.message); }
    const svg = document.querySelector('svg');
    markTest('test-svg', svg && svg.getBBox().width > 0, 'SVG');

    // Run async tests
    testGeolocation();
    testNotifications();
    testClipboard();
    testMedia();
    testFetch();
    testWebSocket();
    testStorage();
    testWorker();
}
