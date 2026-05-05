# Son of Anton - Quick Start Guide

## 🚀 Starting the Application

You have three ways to launch Son of Anton:

### Option 1: Desktop App (Easiest)
Double-click the **"Son of Anton.app"** icon on your Desktop.

### Option 2: Launch Script
```bash
cd /Users/test/Desktop/Hireal/son-of-anton-public
./launch.sh
```

### Option 3: Start Script
```bash
cd /Users/test/Desktop/Hireal/son-of-anton-public
./start.sh
```

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
# Kill any existing instances
pkill -f "Electron src"

# Try launching again
./launch.sh
```

### Black Screen
- Close the app
- Delete: `~/Library/Application Support/Son of Anton`
- Launch again

### Port 3000 Already in Use
```bash
lsof -ti:3000 | xargs kill -9
```

## 📚 Documentation

For detailed setup instructions and technical details, see:
- `MACOS_SETUP.md` - Complete setup guide
- `README.md` - Original project documentation
- `TROUBLESHOOTING.md` - Common issues

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

- GitHub Issues: https://github.com/yifu001/son-of-anton-public/issues
- Original eDEX-UI: https://github.com/GitSquared/edex-ui

---

**Enjoy your sci-fi terminal experience!** 🚀
