/**
 * Playwright + CDP hybrid interaction script for Son of Anton.
 *
 * Uses a separate userData dir so it can run alongside the main app.
 * Copies and patches settings for windowed mode + unique port.
 *
 * Usage:
 *   node test/interact.mjs                  — launch, screenshot, DOM dump
 *   node test/interact.mjs --eval "code"    — evaluate JS in renderer
 *   node test/interact.mjs --screenshot out.png
 *   node test/interact.mjs --dom-dump
 *   node test/interact.mjs --click "selector"
 *   node test/interact.mjs --type "selector" "text"
 *   node test/interact.mjs --wait ms
 *   node test/interact.mjs --cdp            — raw CDP session
 */

import { _electron as electron } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import os from 'os';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);

function flag(name) { return args.includes(name); }
function flagVal(name) {
  const i = args.indexOf(name);
  return i !== -1 && i + 1 < args.length ? args[i + 1] : null;
}

const TIMEOUT = parseInt(flagVal('--wait') || '12000', 10);
const TEST_PORT = 3200;

// Real userData dir (where the running instance reads from)
const realUserData = path.join(os.homedir(), 'Library',
  'Application Support', 'edex-ui');
// Isolated userData dir for our test instance
const testUserData = path.join(os.tmpdir(), 'soa-playwright-test');

function setupTestUserData() {
  // Create the test userData dir and populate it with patched settings
  fs.mkdirSync(testUserData, { recursive: true });

  // Copy and patch settings
  let settings;
  const realSettings = path.join(realUserData, 'settings.json');
  if (fs.existsSync(realSettings)) {
    settings = JSON.parse(fs.readFileSync(realSettings, 'utf-8'));
  } else {
    settings = { shell: 'bash', cwd: os.homedir(), keyboard: 'en-US',
      theme: 'tron', termFontSize: 15, audio: false, port: 3000 };
  }
  settings.forceFullscreen = false;
  settings.allowWindowed = true;
  settings.nointro = true;
  settings.port = TEST_PORT;
  settings.audio = false;
  fs.writeFileSync(path.join(testUserData, 'settings.json'),
    JSON.stringify(settings, null, 4));

  // Window state — no fullscreen
  fs.writeFileSync(path.join(testUserData, 'lastWindowState.json'),
    JSON.stringify({ useFullscreen: false }, null, 4));

  // Copy shortcuts if they exist
  const realShortcuts = path.join(realUserData, 'shortcuts.json');
  if (fs.existsSync(realShortcuts)) {
    fs.copyFileSync(realShortcuts, path.join(testUserData, 'shortcuts.json'));
  }

  // Copy themes/keyboards/fonts dirs
  for (const dir of ['themes', 'keyboards', 'fonts']) {
    const src = path.join(realUserData, dir);
    const dst = path.join(testUserData, dir);
    if (fs.existsSync(src)) {
      fs.mkdirSync(dst, { recursive: true });
      for (const f of fs.readdirSync(src)) {
        fs.copyFileSync(path.join(src, f), path.join(dst, f));
      }
    }
  }

  console.log(`[interact] Test userData ready at ${testUserData}`);
  console.log(`[interact] Settings: windowed, port ${TEST_PORT}, no intro, no audio`);
}

async function main() {
  setupTestUserData();

  console.log('[interact] Launching Son of Anton via Playwright + Electron...');

  const app = await electron.launch({
    args: [
      path.join(ROOT, 'src', '_boot.js'),
      '--user-data-dir=' + testUserData,
    ],
    cwd: ROOT,
    timeout: 45000,
    env: { ...process.env },
  });

  // Capture main process output
  app.process().stdout.on('data', (d) => {
    const l = d.toString().trim();
    if (l) console.log(`[main] ${l}`);
  });
  app.process().stderr.on('data', (d) => {
    const l = d.toString().trim();
    if (l) console.log(`[main-err] ${l}`);
  });

  console.log('[interact] App launched. Waiting for first window...');

  let window;
  try {
    window = await app.firstWindow();
  } catch (e) {
    console.error('[interact] Failed to get window:', e.message);
    await app.close().catch(() => {});
    process.exit(1);
  }

  console.log(`[interact] Window ready — title: "${await window.title()}"`);

  // Capture renderer console
  window.on('console', msg => {
    const t = msg.type();
    if (t === 'error' || t === 'warning') {
      console.log(`[renderer-${t}] ${msg.text()}`);
    }
  });
  window.on('crash', () => console.error('[interact] RENDERER CRASHED'));
  window.on('close', () => console.log('[interact] Window closed'));

  console.log(`[interact] Waiting ${TIMEOUT}ms for renderer to boot...`);
  await window.waitForTimeout(TIMEOUT);

  // ── CDP session ──
  let cdp;
  try {
    cdp = await window.context().newCDPSession(window);
    console.log('[interact] CDP session established.');
  } catch (e) {
    console.error('[interact] CDP failed:', e.message);
  }

  // ── Screenshot ──
  const screenshotPath = flagVal('--screenshot') || 'test/screenshot.png';
  if (flag('--screenshot') || args.length === 0) {
    try {
      await window.screenshot({ path: screenshotPath, fullPage: true });
      console.log(`[interact] Screenshot → ${screenshotPath}`);
    } catch (e) {
      console.error(`[interact] Screenshot failed: ${e.message}`);
    }
  }

  // ── Eval ──
  const evalCode = flagVal('--eval');
  if (evalCode) {
    try {
      const result = await window.evaluate(evalCode);
      console.log('[interact] eval:', JSON.stringify(result, null, 2));
    } catch (e) {
      console.error('[interact] eval failed:', e.message);
    }
  }

  // ── DOM dump ──
  if (flag('--dom-dump') || args.length === 0) {
    try {
      const info = await window.evaluate(() => ({
        title: document.title,
        url: location.href,
        bodyChildren: document.body.children.length,
        totalElements: document.querySelectorAll('*').length,
        scripts: [...document.querySelectorAll('script')]
          .map(s => s.src || '(inline)').slice(0, 20),
        ids: [...document.querySelectorAll('[id]')]
          .map(el => `${el.tagName.toLowerCase()}#${el.id}`).slice(0, 50),
        visibleText: document.body.innerText.slice(0, 500),
      }));
      console.log('[interact] DOM summary:');
      console.log(JSON.stringify(info, null, 2));
    } catch (e) {
      console.error('[interact] DOM dump failed:', e.message);
    }
  }

  // ── Click ──
  const clickSel = flagVal('--click');
  if (clickSel) {
    try {
      await window.click(clickSel);
      console.log(`[interact] Clicked: ${clickSel}`);
    } catch (e) {
      console.error(`[interact] Click failed: ${e.message}`);
    }
  }

  // ── Type ──
  if (flag('--type')) {
    const sel = args[args.indexOf('--type') + 1];
    const text = args[args.indexOf('--type') + 2];
    try {
      await window.fill(sel, text);
      console.log(`[interact] Typed "${text}" into ${sel}`);
    } catch (e) {
      console.error(`[interact] Type failed: ${e.message}`);
    }
  }

  // ── CDP commands ──
  if (flag('--cdp') && cdp) {
    try {
      const { root } = await cdp.send('DOM.getDocument');
      console.log('[CDP] Root nodeId:', root.nodeId);
      const metrics = await cdp.send('Performance.getMetrics');
      console.log('[CDP] Metrics:');
      metrics.metrics.forEach(m => console.log(`  ${m.name}: ${m.value}`));
    } catch (e) {
      console.error('[CDP] Failed:', e.message);
    }
  }

  await window.waitForTimeout(1000).catch(() => {});
  console.log('[interact] Closing...');
  await app.close().catch(() => {});
  console.log('[interact] Done.');
}

main().catch(err => {
  console.error('[interact] Fatal:', err.message);
  process.exit(1);
});
