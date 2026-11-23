const { app, BrowserWindow, globalShortcut, ipcMain, screen, clipboard } = require('electron');
const win32 = require('./win32');
const path = require('path');
const fs = require('fs');
const { LogTailer } = require('./logTailer');
const { parseLine } = require('./parser');
const { loadEmotes } = require('./emotes');

const CONFIG_PATH = () => path.join(app.getPath('userData'), 'config.json');
const EMOTE_CACHE_PATH = () => path.join(app.getPath('userData'), 'emote-cache.json');

const DEFAULT_NPCS = [
  'Faustus', 'Izaro', 'Oshabi', 'Vesper', 'Sin', 'Valdo', 'Zana', 'Treasurer', 'Venarius',
  'Navali', 'Helena', 'Tasuni', 'Kirac', 'Alva', 'Jun', 'Niko', 'Einhar', 'Tane', 'Lilly',
  'Dannig', 'Rog', 'Tujen', 'Gwennen', 'Ange', 'Kalguur', 'Hargan', 'Kaom', 'Daresso',
  'Piety', 'Dominus', 'Malachai', 'Kitava', 'Innocence', 'Doedre', 'Maligaro', 'Shavronne',
  'Atziri', 'Trialmaster', 'Sirus', 'Catarina', 'Aisling', 'Elreon', 'Haku', 'Leo', 'Vorici',
  'Guff', 'Gravicius', 'Hillock', 'Tarkleigh', 'Nessa', 'Bestel', 'Greust', 'Yeena', 'Silk',
  'Eramir', 'Clarissa', 'Maramoa', 'Grigor', 'Petarus', 'Vanja', 'Lani', 'Irasha', 'Oyun',
  'Utula', 'Hinekora', 'Doryani', 'Jamanra', 'Zolin', 'Una', 'Renly', 'Finn', 'Dialla',
  'Merveil', 'Bannon', 'Avarius', 'Lycia', 'Kauri', 'Brutus', 'Weylam', 'Fairgraves', 'Vagan',
];

const DEFAULT_CONFIG = {
  logPath: '',
  twitchChannels: [],
  fontSize: 15,
  fadeSeconds: 30,
  maxMessages: 150,
  backgroundOpacity: 0.35,
  showTimestamps: false,
  channels: { global: true, trade: true, party: true, guild: true, whisper: true, local: true },
  hideNpcs: true,
  npcNames: DEFAULT_NPCS,
  chatHotkey: 'Enter',
  replyHotkey: 'Ctrl+Enter',
  nativeChatHotkey: 'Shift+Enter',
  bounds: null,
};

let config = loadConfig();
let win = null;
let locked = true;
let tailer = null;
let emotes = loadEmoteCache();

// ---------- compose / send-to-game state ----------
let poeHwnd = null;        // last seen PoE window
let composing = false;
let sending = false;
let chatKeysActive = false; // whether chat hotkeys are currently registered
let lastWhisperer = null;

function loadConfig() {
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_PATH(), 'utf8'));
    return { ...DEFAULT_CONFIG, ...raw, channels: { ...DEFAULT_CONFIG.channels, ...(raw.channels || {}) } };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

function saveConfig() {
  fs.mkdirSync(path.dirname(CONFIG_PATH()), { recursive: true });
  fs.writeFileSync(CONFIG_PATH(), JSON.stringify(config, null, 2));
}

function loadEmoteCache() {
  try { return JSON.parse(fs.readFileSync(EMOTE_CACHE_PATH(), 'utf8')); } catch { return {}; }
}

function detectLogPath() {
  const roots = [];
  const drives = 'CDEFGH'.split('');
  for (const d of drives) {
    roots.push(`${d}:\\Program Files (x86)\\Steam\\steamapps\\common`);
    roots.push(`${d}:\\Program Files\\Steam\\steamapps\\common`);
    roots.push(`${d}:\\SteamLibrary\\steamapps\\common`);
    roots.push(`${d}:\\Steam\\steamapps\\common`);
    roots.push(`${d}:\\Program Files (x86)\\Grinding Gear Games`);
    roots.push(`${d}:\\Program Files\\Grinding Gear Games`);
    roots.push(`${d}:\\Games`);
  }
  let best = null;
  for (const root of roots) {
    for (const game of ['Path of Exile', 'Path of Exile 2']) {
      const p = path.join(root, game, 'logs', 'Client.txt');
      try {
        const st = fs.statSync(p);
        if (!best || st.mtimeMs > best.mtime) best = { p, mtime: st.mtimeMs };
      } catch { /* not here */ }
    }
  }
  return best ? best.p : '';
}

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function isNpc(msg) {
  if (!config.hideNpcs || msg.channel !== 'local') return false;
  return config.npcNames.some((n) => n.toLowerCase() === msg.name.toLowerCase());
}

function startTailer() {
  if (tailer) tailer.stop();
  const logPath = config.logPath || detectLogPath();
  send('status', logPath ? `Reading ${logPath}` : 'Could not find Client.txt. Set the path in settings (Ctrl+Shift+L).');
  if (!logPath) return;
  tailer = new LogTailer(logPath, (lines, isBackfill) => {
    const msgs = lines.map(parseLine).filter((m) => m && !isNpc(m));
    for (const m of msgs) if (m.channel === 'whisper-from') lastWhisperer = m.name;
    if (msgs.length) send('messages', { messages: msgs, backfill: isBackfill });
  });
  tailer.start();
}

async function refreshEmotes() {
  try {
    const fresh = await loadEmotes(config.twitchChannels, (msg) => send('status', msg));
    emotes = fresh;
    fs.writeFileSync(EMOTE_CACHE_PATH(), JSON.stringify(emotes));
    send('emotes', emotes);
    send('status', `Loaded ${Object.keys(emotes).length} emotes`);
  } catch (e) {
    send('status', `Emote load failed: ${e.message}`);
  }
}

function applyLock() {
  if (!win) return;
  const interactive = !locked || composing;
  win.setIgnoreMouseEvents(!interactive, { forward: true });
  win.setFocusable(interactive);
  if (!locked) win.focus();
  send('lock', locked);
}

// Chat hotkeys are only registered while PoE is the foreground window, so Enter
// keeps working normally in every other app.
function setChatKeys(active) {
  if (active === chatKeysActive) return;
  chatKeysActive = active;
  const keys = [
    [config.chatHotkey, () => openCompose(false)],
    [config.replyHotkey, () => openCompose(true)],
    [config.nativeChatHotkey, openNativeChat],
  ];
  for (const [accel, handler] of keys) {
    if (!accel) continue;
    try {
      if (active) globalShortcut.register(accel, handler);
      else globalShortcut.unregister(accel);
    } catch (e) {
      send('status', `Bad hotkey "${accel}": ${e.message}`);
    }
  }
}

// Ctrl+Alt+click on an item makes PoE open its own chat box with the link in it.
// While that's open, Enter must reach PoE, so the chat hotkeys stand down until
// the user sends (Enter) or cancels (Esc) it.
let nativeChatOpen = false;
let nativeChatSince = 0;

// Opens PoE's real chat window (to hover/Ctrl+C linked items, or type natively).
// The hotkeys stay off until that window is closed with Enter or Esc.
function openNativeChat() {
  nativeChatOpen = true;
  nativeChatSince = Date.now();
  setChatKeys(false);
  const { VK } = win32;
  for (const m of [VK.SHIFT, VK.CONTROL, VK.MENU]) win32.release(m); // hotkey modifiers are still held
  win32.tap(VK.RETURN);
}

function watchForeground() {
  const { VK } = win32;
  setInterval(() => {
    let isPoe = false;
    try {
      const fg = win32.foregroundWindow();
      isPoe = win32.isPoeWindow(fg);
      if (isPoe) poeHwnd = fg;
      // read every tick so the "pressed since last call" bits never go stale
      const click = win32.keyState(VK.LBUTTON);
      const enter = win32.keyState(VK.RETURN);
      const esc = win32.keyState(VK.ESCAPE);
      const ctrl = win32.keyState(VK.CONTROL).down;
      const alt = win32.keyState(VK.MENU).down;
      if (isPoe && (click.pressed || click.down) && ctrl && alt) nativeChatOpen = true;
      else if (nativeChatOpen && Date.now() - nativeChatSince > 200 // ignore our own synthetic Enter
        && (enter.pressed || esc.pressed || !isPoe)) nativeChatOpen = false;
    } catch { /* ignore */ }
    setChatKeys(isPoe && !sending && !composing && !nativeChatOpen);
  }, 30);
}

function openCompose(reply) {
  if (!win || composing) return;
  composing = true;
  setChatKeys(false);
  if (!win.isVisible()) win.showInactive();
  applyLock();
  win.focus();
  send('compose', { prefill: reply && lastWhisperer ? `@${lastWhisperer} ` : '' });
}

function endCompose() {
  composing = false;
  win32.focusWindow(poeHwnd); // we're foreground right now, so Windows allows this
  applyLock();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function sendToGame(text) {
  sending = true;
  setChatKeys(false);
  endCompose();
  const prevClipboard = clipboard.readText();
  try {
    clipboard.writeText(text);
    await sleep(80);
    const { VK } = win32;
    win32.tap(VK.RETURN);               // open PoE chat
    await sleep(60);
    win32.tap(VK.A, VK.CONTROL);         // replace anything PoE prefilled
    win32.tap(VK.V, VK.CONTROL);         // paste
    await sleep(40);
    win32.tap(VK.RETURN);               // send
    await sleep(150);
  } finally {
    clipboard.writeText(prevClipboard);
    sending = false;
  }
}

function createWindow() {
  const wa = screen.getPrimaryDisplay().workArea;
  const b = config.bounds || { width: 520, height: 380, x: wa.x + 20, y: wa.y + wa.height - 380 - 260 };
  win = new BrowserWindow({
    ...b,
    transparent: true,
    frame: false,
    resizable: false, // transparent windows on Windows resize poorly; we use a custom grip
    hasShadow: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    focusable: false,
    show: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true);
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.showInactive());

  const saveBounds = () => { config.bounds = win.getBounds(); saveConfig(); };
  win.on('moved', saveBounds);

  win.webContents.on('did-finish-load', () => {
    send('config', config);
    send('emotes', emotes);
    applyLock();
    startTailer();
    refreshEmotes();
  });
}

ipcMain.handle('get-config', () => config);
ipcMain.on('save-config', (_e, partial) => {
  const prevChannels = JSON.stringify(config.twitchChannels);
  const prevLog = config.logPath;
  setChatKeys(false); // re-registered with the new accelerators on the next poll
  config = { ...config, ...partial, channels: { ...config.channels, ...(partial.channels || {}) } };
  saveConfig();
  send('config', config);
  if (JSON.stringify(config.twitchChannels) !== prevChannels) refreshEmotes();
  if (config.logPath !== prevLog) startTailer();
});
ipcMain.on('refresh-emotes', () => refreshEmotes());
ipcMain.on('toggle-lock', () => { locked = !locked; applyLock(); });
ipcMain.on('resize-by', (_e, { dw, dh }) => {
  const b = win.getBounds();
  win.setBounds({ ...b, width: Math.max(220, b.width + dw), height: Math.max(120, b.height + dh) });
  config.bounds = win.getBounds();
  saveConfig();
});
ipcMain.on('quit', () => app.quit());
ipcMain.on('send-chat', (_e, text) => {
  if (!composing) return;
  const t = String(text || '').replace(/[\r\n]+/g, ' ').trim();
  if (t) sendToGame(t); else endCompose();
});
ipcMain.on('cancel-compose', () => { if (composing) endCompose(); });

app.whenReady().then(() => {
  createWindow();
  watchForeground();
  globalShortcut.register('CommandOrControl+Shift+L', () => { locked = !locked; applyLock(); });
  globalShortcut.register('CommandOrControl+Shift+H', () => {
    if (win.isVisible()) win.hide(); else win.showInactive();
  });
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  if (tailer) tailer.stop();
});
app.on('window-all-closed', () => app.quit());
