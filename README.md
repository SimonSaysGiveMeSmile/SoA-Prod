<p align="center">
  <br>
  <img alt="Logo" src="media/logo.png" width="400">
  <br><br>
  <a href="https://github.com/yifu001/son-of-anton-public/releases/latest"><img alt="Release" src="https://img.shields.io/github/release/yifu001/son-of-anton-public.svg?style=popout"></a>
  <a href="https://github.com/yifu001/son-of-anton-public/blob/main/LICENSE"><img alt="License" src="https://img.shields.io/github/license/yifu001/son-of-anton-public.svg?style=popout"></a>
</p>

# Son of Anton

A sci-fi terminal emulator and Claude Code command center. Monitor your AI coding sessions in a TRON-inspired interface.

> Fork of [eDEX-UI v2.2.8](https://github.com/GitSquared/edex-ui)

![Screenshot](media/screenshot.png)

---

## Features

### Claude Code Integration

Run Claude Code inside Son of Anton and get real-time visibility into your AI coding sessions:

- **Context Tracking** - Live display of token usage and context consumption
- **Active Agents Panel** - Monitor spawned subagents, their status, and descriptions
- **Todo Widget** - View tasks Claude is tracking during the session
- **Session State** - See current working directory, conversation state, and activity

The integration works automatically by parsing Claude Code's terminal output - no API keys or configuration required.

### Tab Status Indicator

Color-coded dot on each terminal tab showing Claude Code's current state at a glance:

- **Green (pulsing)** - Claude is actively generating or executing tools
- **Red (blinking)** - Claude needs user approval or input
- **Orange (solid)** - Execution finished successfully
- **Blue (faded)** - Session active but idle

Detected automatically by monitoring terminal output for tool use indicators, spinner characters, and permission prompts.

### Agent Permission Mode (WIP)

Universal permission control for Claude Code and other AI agents, accessible via the shield icon in the toolbar:

- **Ask Everything** - Enhanced alerts (window flash + audio) when any agent needs permission
- **Default** - Standard behavior with tab status indicator turning red
- **YOLO** - Automatically grants all permission prompts, preventing interruptions during code generation

Click the shield icon to cycle through modes, or configure in Settings > Advanced. The setting persists across sessions.

### Voice Input

Hands-free voice dictation with multiple speech recognition backends:

- **Picovoice + Whisper** - Wake word detection ("Hey Anton") followed by Whisper API transcription
- **On-Device (macOS)** - Local speech recognition using SFSpeechRecognizer (push-to-talk)
- **Direct Whisper** - Push-to-talk recording sent to OpenAI Whisper API
- **Web Speech API** - Browser-based continuous recognition as fallback

Includes a real-time waveform visualizer (32-bar frequency display), 60-second recording limit, 2-second silence auto-stop, and automatic fallback between recognition modes. Toggle with Caps Lock.

### Input Composer (Text Box)

Multi-line text editor overlay for composing complex prompts before sending:

- **Ctrl+Space** to open a bottom-docked composer bar
- Auto-activates inline at cursor position when typing starts
- **Shift+Enter** to send, **Enter** for newline, **Tab** for shell completion
- Auto-expands vertically as content grows
- Pre-populates with existing terminal line text
- Shell history navigation with Up/Down arrows

### Ad Overlay & Credits

Displays ads during AI thinking time to earn virtual credits — a gamification layer on top of Claude Code sessions:

- **Three display modes:** Fullscreen (5 credits/sec), Panel (3 credits/sec), Corner (2 credits/sec)
- Automatically triggers when Claude is processing
- Draggable corner mode with position persistence
- Credits accumulate in real-time and persist across sessions
- Credit display widget with earning rate, session history, and manual "WATCH AD" toggle

### Movable Widgets

All side panel widgets (system monitors, Claude widgets, credit display, mic monitor) are drag-and-drop reorderable:

- Drag handles on each widget for repositioning
- Cross-column support (move between left and right panels)
- Layout persists across sessions via localStorage
- Visual placeholder feedback during drag operations

### Settings Panel

Tabbed settings interface (Apple Settings style) with sidebar navigation:

- **General** - Shell, shell args, working directory, environment, username
- **Appearance** - Theme, font size, monitor selection, windowed mode, cursor visibility, intro skip
- **Audio** - Sound effects toggle, volume, feedback audio
- **Network** - Port, ping address, network interface selection
- **Files** - Dotfiles visibility, list/grid view, thread exclusion
- **Advanced** - Experimental features, context warning threshold, agent permission mode
- **Ads & Misc** - Clock format (12/24h), ad overlay settings

Includes save to disk, open in external editor, reload UI, restart app, and quit actions.

### Terminal Emulator

- Multi-tab terminal with full color and mouse support
- Works with bash, zsh, PowerShell, cmd, and curses applications
- Sci-fi sound effects for typing, commands, and events
- Directory browser that follows terminal's current working directory

### System Monitoring

- **CPU** - Real-time usage graphs and per-core breakdown
- **RAM** - Memory and swap usage visualization
- **Network** - Active connections, bandwidth, and GeoIP location globe
- **Processes** - Top processes by CPU/memory usage

### Customization

- 10 built-in themes (Tron, Blade, Matrix, Nord, etc.)
- On-screen keyboard for touch displays
- Configurable keyboard layouts
- CSS injection for advanced styling

---

## Quick Start

### 1. Download

Download the latest installer for your platform from [Releases](https://github.com/yifu001/son-of-anton-public/releases):

| Platform | File |
|----------|------|
| Windows (64-bit) | [`Son of Anton-Windows-x64.exe`](https://github.com/yifu001/son-of-anton-public/releases/download/v2.0.0/Son.of.Anton-Windows-x64.exe) |
| Windows (32-bit) | [`Son of Anton-Windows-ia32.exe`](https://github.com/yifu001/son-of-anton-public/releases/download/v2.0.0/Son.of.Anton-Windows-ia32.exe) |
| macOS (Intel) | [`Son of Anton-macOS-x64.dmg`](https://github.com/SimonSaysGiveMeSmile/son-of-anton-public/releases/download/v2.2.11-mac/Son.of.Anton-macOS-x64.dmg) |
| macOS (Apple Silicon) | [`Son of Anton-macOS-arm64.dmg`](https://github.com/SimonSaysGiveMeSmile/son-of-anton-public/releases/download/v2.2.11-mac/Son.of.Anton-macOS-arm64.dmg) |

### 2. Install & Run

**Windows:**
1. Run the `.exe` installer
2. Launch "Son of Anton" from Start Menu or Desktop

### 3. Use with Claude Code

1. Open Son of Anton
2. In the terminal, run `claude` to start Claude Code
3. The side panels will automatically display Claude's context, agents, and todos

---

## Configuration

Configuration files are stored in:
- **Windows:** `%APPDATA%\Son of Anton\`
- **macOS:** `~/Library/Application Support/Son of Anton/`
- **Linux:** `~/.config/Son of Anton/`

### Themes

Change themes from the settings panel or edit `settings.json`:

```json
{
  "theme": "tron"
}
```

Available themes: `tron`, `blade`, `matrix`, `nord`, `navy`, `red`, `apollo`, `cyborg`, `interstellar`, `chalkboard`

---

## Keyboard Shortcuts

| Action | Shortcut |
|--------|----------|
| Toggle Fullscreen | `F11` |
| New Terminal Tab | `Ctrl+Shift+T` |
| Close Tab | `Ctrl+Shift+W` |
| Next Tab | `Ctrl+Tab` |
| Copy | `Ctrl+Shift+C` |
| Paste | `Ctrl+Shift+V` |

---

## Troubleshooting

### App won't start
- Ensure you have the correct version for your OS architecture
- Try running as Administrator (Windows) or with sudo (Linux)

### Terminal shows wrong shell
Edit `settings.json` and set your preferred shell:
```json
{
  "shell": "powershell.exe"
}
```

### File browser shows "Tracking Failed" (Windows)
This is expected. Windows doesn't support terminal CWD tracking. The file browser works in "detached" mode.

### Display issues on HiDPI screens
Launch with `--force-device-scale-factor=1` flag.

---

## Credits

- **Son of Anton** - Fork by [yifu001](https://github.com/yifu001)
- **Original eDEX-UI** - Created by [Squared](https://github.com/GitSquared)
- **Sound Effects** - [IceWolf](https://soundcloud.com/iamicewolf)

Inspired by [TRON Legacy](https://web.archive.org/web/20170511000410/http://jtnimoy.com/blogs/projects/14881671) movie effects.

---

## License

[GPLv3.0](LICENSE)
