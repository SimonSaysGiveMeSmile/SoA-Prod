# Release Notes - v2.2.8-mac

## macOS Fixes and Improvements

This release focuses on macOS-specific fixes and improvements to provide a better user experience.

### ✨ New Features

- **Auto-fix Grey Zone**: Automatically toggles DevTools at startup to eliminate the grey zone issue in the terminal canvas
- **Cleaner Startup**: Suppressed System Check modal that appeared on every launch
- **Silent Updates**: Update notifications no longer show pop-up modals (logged to console instead)
- **Universal Binary Support**: Built for both Intel (x64) and Apple Silicon (arm64) architectures

### 🐛 Bug Fixes

- Fixed terminal canvas grey zone appearing when DevTools are toggled quickly (Option+Command+I)
- Fixed DevTools not closing properly on rapid toggle
- Improved terminal resize handling when DevTools state changes
- Auto-hide boot screen after animation completes

### 📦 Distribution

Two DMG packages are available:

- **Son of Anton-macOS-x64.dmg** (118 MB) - For Intel-based Macs
- **Son of Anton-macOS-arm64.dmg** (111 MB) - For Apple Silicon Macs (M1, M2, M3, etc.)

Both packages are compatible with macOS 10.12 (Sierra) and later.

### 🔧 Technical Details

- **Electron**: 28.3.3
- **Format**: APFS DMG
- **Architectures**: x64 (Intel) and arm64 (Apple Silicon)
- **Code Signed**: Yes
- **Minimum macOS**: 10.12 (Sierra)

### 📝 Changes

#### Modified Files
- `src/_renderer.js` - Added DevTools auto-toggle at startup, disabled UI test modal
- `src/_boot.js` - Added DevTools state change handlers
- `src/classes/updateChecker.class.js` - Disabled update notification modal
- `src/assets/css/boot_screen.css` - Added auto-hide animation
- `package.json` - Added arm64 architecture support for macOS builds
- `README.md` - Updated download links to v2.2.8-mac

### 🙏 Credits

Based on [eDEX-UI v2.2.8](https://github.com/GitSquared/edex-ui) by Gabriel 'Squared' SAILLARD

---

**Full Changelog**: https://github.com/yifu001/son-of-anton-public/compare/v2.0.1-mac...v2.2.8-mac
