# PoE Chat Overlay

A transparent, click-through overlay that mirrors Path of Exile (1 & 2) chat with Twitch, BTTV, FFZ and 7TV emotes, including animated ones.

It reads the game's `logs/Client.txt` as new lines arrive, so it never touches the game client.

## Run

```
npm install
npm start
```

Or double-click `start.bat`.

## Talking

PoE's own chat window pops back up whenever you open it to type, so you type in the overlay instead:

1. In game, press **Enter**. The overlay's input box opens instead of PoE's. Enter is only taken over while PoE is the focused window.
2. Type normally. Use the usual prefixes to pick a channel: `#global`, `$trade`, `%party`, `&guild`, `@name whisper`.
3. Press **Tab** to autocomplete emote names, and press Tab again to cycle through the matches. **Up/Down** browses what you sent before.
4. Press **Enter** to send. The overlay focuses PoE and pastes your message into its chat (your clipboard is restored afterwards). **Esc** cancels.

**Ctrl+Enter** opens the box pre-filled with `@<last person who whispered you>`.

You can change both hotkeys in Settings. Clear the chat hotkey to give Enter back to PoE.

Recommended PoE setup: run in Windowed Fullscreen, stay joined to the channels you want (leaving a channel stops it being logged), and hide or shrink PoE's chat window so the overlay is the one you read.

## Use

- **Ctrl+Shift+L**: switch edit mode on or off. In edit mode you can drag the title bar to move the overlay, drag the corner grip to resize it, open Settings, or quit. Locked mode is click-through.
- **Ctrl+Shift+H**: hide or show the overlay.
- Run PoE in **Windowed Fullscreen** (or Windowed). Exclusive fullscreen draws over every overlay.
- Emotes are sent as plain words (`KEKW`, `catJAM`, …). Anyone running this overlay sees them as images, and everyone else sees the text.

## Settings

- **Twitch channels**: add streamers (e.g. `zizaran, ghazzy`) to load their BTTV, FFZ and 7TV channel emotes on top of the global sets.
- **Client.txt path**: leave blank to auto-detect Steam or standalone installs of PoE 1 and PoE 2.
- Font size, fade time, background opacity, timestamps, per-channel filters, and hiding NPC dialogue.

Config and the emote cache are stored in `%APPDATA%\poechat\`.
