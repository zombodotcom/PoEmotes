# PoEmotes

Twitch, BTTV, FFZ and 7TV emotes (including animated ones) in Path of Exile chat, for PoE 1 and PoE 2.

PoEmotes is a small transparent overlay that sits on top of PoE's chat box. It reads the game's `logs/Client.txt` as new lines arrive. It never touches the game client: no memory reading, no packet sniffing, no injected input.

## Install

Download `PoEmotes_x.y.z_x64-setup.exe` (about 2 MB) from Releases, or the standalone `poemotes.exe` (about 5 MB, no install needed). It uses Windows' built-in WebView2, which Windows 10 and 11 already have.

Run PoE in **Windowed Fullscreen** or **Windowed**. Exclusive fullscreen draws over every overlay.

## Setup

1. Right-click the tray icon and choose **Move / resize**, or press **Ctrl+Shift+L**.
2. Drag the title bar and the corner grip so the overlay sits exactly over PoE's chat box, then press Ctrl+Shift+L again to lock it.
3. The dark see-through background covers PoE's chat text underneath. Messages fade after 10 seconds, like the in-game chat.
4. **Hover the overlay** for a moment and it disappears, so you can hover and click item links in PoE's real chat. Move the mouse away and it comes back.

Type emotes as plain words in PoE chat (`KEKW`, `catJAM`, …). Anyone running PoEmotes sees them as images, and everyone else sees the text.

## Controls

- **Tray icon**: Settings, Move / resize, Hide / show, Reload emotes, Quit.
- **Ctrl+Shift+L**: edit mode (move, resize, settings). The overlay is click-through while locked.
- **Ctrl+Shift+H**: hide or show the overlay.

## Settings

- **Twitch channels**: streamers whose BTTV, FFZ and 7TV channel emotes to load on top of the global sets.
- **Client.txt path**: leave blank to auto-detect Steam and standalone installs of PoE 1 and PoE 2.
- Font, font size, emote size, fade time, background opacity, timestamps, per-channel filters, hide NPC dialogue, only show messages with emotes, hide when PoE isn't the active window.

Settings and the emote cache are stored in `%APPDATA%\PoEmotes\`.

## Notes

- Keep the channels you care about visible in PoE, because item links can only be hovered in PoE's own chat.
- Leaving a channel stops it being logged. Hiding it in PoE's chat filter doesn't.

## Build

Needs Rust and Node.

```
npm install
npm run build    # src-tauri/target/release/poemotes.exe and an NSIS installer
npm run dev      # run with live reload of the frontend
```

Built with [Tauri](https://tauri.app). Not affiliated with Grinding Gear Games.
