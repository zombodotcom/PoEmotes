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

The overlay is an add-on and never touches your keyboard. PoE's own chat keeps working exactly as before: Enter, item links, hovering items, everything.

- By default the overlay shows **only messages that contain emotes**, as a small feed. Place it wherever you like (next to or above PoE's chat). You can switch this off in Settings to mirror all of chat.
- Type emotes as plain words in PoE chat (`KEKW`, `catJAM`, …). Anyone running the overlay sees them as images, and everyone else sees the text.
- Hiding a channel in PoE's chat display doesn't stop it being logged, so you can hide global in PoE and still get its emotes in the overlay. Leaving a channel does stop it.
- The overlay hides itself when PoE isn't the active window. You can change that in Settings.

## Use

- **Ctrl+Shift+L**: switch edit mode on or off. In edit mode you can drag the title bar to move the overlay, drag the corner grip to resize it, open Settings, or quit. Locked mode is click-through.
- **Ctrl+Shift+H**: hide or show the overlay.
- Run PoE in **Windowed Fullscreen** (or Windowed). Exclusive fullscreen draws over every overlay.

## Settings

- **Twitch channels**: add streamers (e.g. `zizaran, ghazzy`) to load their BTTV, FFZ and 7TV channel emotes on top of the global sets.
- **Client.txt path**: leave blank to auto-detect Steam or standalone installs of PoE 1 and PoE 2.
- Font size, fade time, background opacity, timestamps, per-channel filters, and hiding NPC dialogue.

Config and the emote cache are stored in `%APPDATA%\poechat\`.
