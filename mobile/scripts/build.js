#!/usr/bin/env node
/**
 * No-op build script.
 *
 * son-of-anton-mobile is a no-build PWA: every source file is already a
 * browser-runnable asset under ./dist. We keep this script for two reasons:
 *
 *   1. Symmetry with `npm run build` workflows.
 *   2. So future iterations (Tailwind, esbuild, etc.) can hook in without
 *      breaking callers.
 *
 * Today it just verifies that the expected files exist and reports their
 * sizes, so packagers can sanity-check the bundle.
 */

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const DIST = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..', 'dist');
const REQUIRED = [
    'index.html',
    'styles.css',
    'app.js',
    'socket.js',
    'ansi.js',
    'keyboard.js',
    'manifest.webmanifest',
    'sw.js',
    'icon.svg',
];

let total = 0;
let failed = false;
console.log(`son-of-anton-mobile build · ${DIST}\n`);
for (const name of REQUIRED) {
    const full = path.join(DIST, name);
    try {
        const stat = fs.statSync(full);
        total += stat.size;
        console.log(`  OK  ${name.padEnd(28)} ${formatBytes(stat.size)}`);
    } catch (_) {
        failed = true;
        console.log(`  ✗   ${name.padEnd(28)} MISSING`);
    }
}
console.log(`\n  total: ${formatBytes(total)}`);
if (failed) {
    console.error('\nbuild failed: some required files are missing');
    process.exit(1);
}

function formatBytes(b) {
    if (b < 1024) return `${b} B`;
    if (b < 1024 * 1024) return `${(b/1024).toFixed(1)} KB`;
    return `${(b/1024/1024).toFixed(2)} MB`;
}
