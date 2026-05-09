# Son of Anton - Quick Start Guide

## 🚀 Starting the Application

Two ways to run Son of Anton.

### Option 1: Installed app (macOS)
Grab the latest DMG from
[Releases](https://github.com/SimonSaysGiveMeSmile/SoA-Prod/releases/latest),
drag **Son of Anton** into `/Applications`, and launch it like any other Mac
app. Updates arrive in-app via `electron-updater`.

### Option 2: From source (macOS / Linux / Windows)
From the **SoA-Prod** monorepo root:

```bash
npm run install:all      # macOS       (use install:linux / install:windows elsewhere)
npm start                # launches the Electron app
```

See the root [`README.md`](../../README.md) for the full source setup.

## 📖 Using Son of Anton

### Basic Features
- **Terminal**: Full-featured terminal with bash/zsh support
- **File Browser**: Navigate your filesystem (left panel)
- **System Monitor**: CPU, RAM, Network stats (right panels)
- **Claude Code Integration**: Run `claude` in the terminal

### Keyboard Shortcuts
- `Cmd+Q` - **Quit application**
- `F11` - Toggle fullscreen
- `Ctrl+Shift+T` - New terminal tab
- `Ctrl+Shift+W` - Close tab
- `Ctrl+Shift+C` - Copy
- `Ctrl+Shift+V` - Paste

### Using with Claude Code
1. Open Son of Anton
2. In the terminal, run: `claude`
3. The side panels will show:
   - Context usage
   - Active agents
   - Todo list
   - Session state

## 🔧 Configuration

Settings are stored in:
```
~/Library/Application Support/Son of Anton/settings.json
```

### Change Theme
Edit `settings.json` and set:
```json
{
  "theme": "tron"
}
```

Available themes: `tron`, `blade`, `matrix`, `nord`, `navy`, `red`, `apollo`, `cyborg`, `interstellar`, `chalkboard`

## 🐛 Troubleshooting

### App Won't Start
```bash
# Kill any stray Electron processes
pkill -f "Son of Anton"

# Then launch again (installed app: reopen from /Applications.
# From source: `npm start` at the repo root.)
```

### Black Screen
- Quit the app
- Delete: `~/Library/Application Support/Son of Anton`
- Launch again

### Port 7330 Already in Use
The mobile bridge binds to `7330+`. If something else already holds it:
```bash
lsof -ti:7330 | xargs kill -9
```

## 📚 Documentation

For detailed setup instructions and technical details, see:
- `MACOS_SETUP.md` - Complete setup guide
- `MOBILE_BRIDGE.md` - Mobile bridge protocol + pairing flow
- `../README.md` - Desktop feature list and keyboard shortcuts
- `../../README.md` - Repo overview (desktop + mobile)

## 🎨 Customization

### Custom Shell
Edit `~/Library/Application Support/Son of Anton/settings.json`:
```json
{
  "shell": "/bin/zsh"
}
```

### Custom Working Directory
```json
{
  "cwd": "/Users/test/Projects"
}
```

## ⚡ Performance Tips

- Startup time: ~11 seconds (normal)
- Memory usage: ~160MB
- For best performance, close unused terminal tabs
- Disable animations in settings if needed

## 🆘 Getting Help

- GitHub Issues: https://github.com/SimonSaysGiveMeSmile/SoA-Prod/issues
- Original eDEX-UI: https://github.com/GitSquared/edex-ui

---

**Enjoy your sci-fi terminal experience!** 🚀
