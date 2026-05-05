# Son of Anton - macOS Apple Silicon Setup Guide

This guide explains how to build and run Son of Anton on macOS with Apple Silicon (ARM64).

## The Challenge

The original Son of Anton was built with Electron 12 (from 2021), which is incompatible with modern macOS versions like Sequoia (25.2.0). Several issues needed to be resolved:

1. **Electron 12 incompatibility** - Cannot spawn processes on macOS Sequoia
2. **node-pty build failures** - Native module wouldn't compile with Node 24
3. **@electron/remote API changes** - Electron 28 requires explicit enabling

## The Solution

### 1. Updated Electron to Version 28

**Changes made to `package.json`:**
```json
{
  "dependencies": {
    "electron": "^28.0.0",           // was ^12.1.0
    "electron-builder": "^24.0.0",   // was ^22.14.5
    "@electron/rebuild": "^3.6.0",   // was electron-rebuild ^2.3.5
    "node-abi": "^3.0.0"             // was 2.30.1
  }
}
```

**Changes made to `src/package.json`:**
```json
{
  "dependencies": {
    "@electron/remote": "^2.1.2"     // was ^1.2.2
  }
}
```

### 2. Fixed @electron/remote Integration

**In `src/_boot.js`:**
- Removed deprecated `enableRemoteModule: true` from webPreferences
- Added explicit remote initialization:
```javascript
const remoteMain = require('@electron/remote/main');
remoteMain.initialize();
// ... later, after creating window:
remoteMain.enable(win.webContents);
```

**In `src/_renderer.js`:**
- Replaced all `electron.remote.*` with `remote.*` (using the imported `@electron/remote` module)

### 3. Built node-pty for Electron 28

The key was using the correct Python version and rebuilding for Electron:
```bash
cd src/node_modules/node-pty
PYTHON=/opt/homebrew/bin/python3.10 npx node-gyp rebuild \
  --target=28.3.3 \
  --arch=arm64 \
  --dist-url=https://electronjs.org/headers
```

## Prerequisites

- **Node.js 18.x** (not Node 24)
- **Python 3.10 or 3.11** (not 3.14)
- **Xcode Command Line Tools**

## Installation Steps

### 1. Install Node 18

```bash
# Install Node 18 via Homebrew
brew install node@18

# Switch to Node 18
brew unlink node
brew link node@18 --force --overwrite

# Verify
node --version  # Should show v18.x.x
```

### 2. Install Python 3.10

```bash
brew install python@3.10
```

### 3. Install Dependencies

```bash
# Install root dependencies
npm install --legacy-peer-deps

# Install src dependencies
cd src
npm install --legacy-peer-deps
cd ..

# Rebuild node-pty for Electron 28
cd src/node_modules/node-pty
PYTHON=/opt/homebrew/bin/python3.10 npx node-gyp rebuild \
  --target=28.3.3 \
  --arch=arm64 \
  --dist-url=https://electronjs.org/headers
cd ../../..
```

## Running the Application

### Using the start script:

```bash
./start.sh
```

### Or manually:

```bash
./node_modules/.bin/electron src --no-sandbox
```

## Troubleshooting

### Black Screen Issue
If you see a black screen, check the DevTools console (it should open automatically). Common issues:
- Missing `@electron/remote` - ensure it's enabled in `_boot.js`
- JavaScript errors - check for `electron.remote` references that should be just `remote`

### node-pty Build Failures
- Ensure you're using Python 3.10 or 3.11 (not 3.14)
- Ensure you're using Node 18 (not Node 24)
- Make sure Xcode Command Line Tools are installed: `xcode-select --install`

### Port Already in Use
If port 3000 is already in use:
```bash
lsof -ti:3000 | xargs kill -9
```

## Key Files Modified

- `package.json` - Updated Electron and build tools
- `src/package.json` - Updated @electron/remote
- `src/_boot.js` - Fixed @electron/remote initialization
- `src/_renderer.js` - Replaced electron.remote with remote
- `start.sh` - Created macOS-compatible launcher

## Performance Notes

- Startup time: ~11 seconds
- Memory usage: ~160MB
- Works with Claude Code integration
- All system monitoring features functional

## Credits

- Original eDEX-UI by GitSquared
- Son of Anton fork by yifu001
- macOS Apple Silicon port assistance by Claude Sonnet 4.5

---

**Last Updated:** January 30, 2026
**Tested On:** macOS Sequoia 25.2.0 (Apple Silicon M-series)
