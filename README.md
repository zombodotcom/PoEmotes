# PoE Chat Overlay

A transparent, click-through overlay that mirrors Path of Exile (1 & 2) chat with Twitch, BTTV, FFZ and 7TV emotes, including animated ones.

It reads the game's `logs/Client.txt` as new lines arrive, so it never touches the game client.

## Run

```
npm install
npm start
```

Or double-click `start.bat`.

## How it works with PoE chat

The overlay never touches your keyboard. PoE's own chat keeps working exactly as before: Enter, typing, item links.

**Recommended setup: cover PoE's chat.**
1. Press Ctrl+Shift+L, then drag and resize the overlay so it sits exactly over PoE's chat box. Press Ctrl+Shift+L again to lock it.
2. The overlay's dark see-through background (Settings → Background opacity) hides PoE's chat text underneath while you still see the game.
3. **Hover the overlay** for a moment and it fades out, showing PoE's real chat underneath, so you can hover or click item links natively. Move the mouse away and it comes back.

Other notes:
- Type emotes as plain words in PoE chat (`KEKW`, `catJAM`, …). Anyone running the overlay sees them as images, and everyone else sees the text.
- Keep the channels you care about visible in PoE, since item links can only be hovered in PoE's own chat. Leaving a channel stops it being logged; hiding it in the chat filter doesn't.
- Settings has "Only show messages with emotes" if you'd rather use the overlay as a small emote feed next to PoE's chat.
- The overlay hides itself when PoE isn't the active window.

## Use

- **Ctrl+Shift+L**: switch edit mode on or off. In edit mode you can drag the title bar to move the overlay, drag the corner grip to resize it, open Settings, or quit. Locked mode is click-through.
- **Ctrl+Shift+H**: hide or show the overlay.
- Run PoE in **Windowed Fullscreen** (or Windowed). Exclusive fullscreen draws over every overlay.

## Settings

- **Twitch channels**: add streamers (e.g. `zizaran, ghazzy`) to load their BTTV, FFZ and 7TV channel emotes on top of the global sets.
- **Client.txt path**: leave blank to auto-detect Steam or standalone installs of PoE 1 and PoE 2.
- Font size, fade time, background opacity, timestamps, per-channel filters, and hiding NPC dialogue.

Config and the emote cache are stored in `%APPDATA%\poechat\`.
