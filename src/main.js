const { app, BrowserWindow, globalShortcut, ipcMain, screen } = require('electron');
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
  backgroundOpacity: 0.8,
  showTimestamps: false,
  channels: { global: true, trade: true, party: true, guild: true, whisper: true, local: true },
  hideNpcs: true,
  npcNames: DEFAULT_NPCS,
  emoteOnly: false,
  onlyWhenPoeFocused: true,
  hoverReveal: true,
  revealDelayMs: 350,
  bounds: null,
};

let config = loadConfig();
let win = null;
let locked = true;
let tailer = null;
let emotes = loadEmoteCache();

let userHidden = false;    // Ctrl+Shift+H
let poeFocused = true;
let overlayFocused = false;

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
  win.setIgnoreMouseEvents(locked, { forward: true });
  win.setFocusable(!locked);
  if (!locked) win.focus();
  send('lock', locked);
  updateVisibility();
}

// Show the overlay only while PoE (or the overlay itself, in edit mode) is in front,
// so it doesn't float over your browser or Discord.
function updateVisibility() {
  if (!win) return;
  const want = !userHidden && (!locked || !config.onlyWhenPoeFocused || poeFocused || overlayFocused);
  if (want && !win.isVisible()) win.showInactive();
  else if (!want && win.isVisible()) win.hide();
}

// Hover-to-reveal: when the cursor rests on the overlay, fade it out so PoE's real
// chat underneath (with hoverable/clickable item links) shows through. The overlay
// stays click-through the whole time, so the mouse is already talking to PoE.
let hoverSince = 0;
let revealed = false;

function watchCursor() {
  setInterval(() => {
    if (!win || !win.isVisible()) return;
    let inside = false;
    if (locked && config.hoverReveal) {
      const p = screen.getCursorScreenPoint();
      const b = win.getBounds();
      inside = p.x >= b.x && p.x < b.x + b.width && p.y >= b.y && p.y < b.y + b.height;
    }
    const now = Date.now();
    if (inside && !hoverSince) hoverSince = now;
    if (!inside) hoverSince = 0;
    // reveal after a short dwell; come back quickly once the cursor leaves
    const want = inside && now - hoverSince >= (Number(config.revealDelayMs) || 0);
    if (want !== revealed) { revealed = want; send('reveal', revealed); }
  }, 50);
}

function watchForeground() {
  setInterval(() => {
    try {
      const fg = win32.foregroundWindow();
      poeFocused = win32.isPoeWindow(fg);
      overlayFocused = !!win && win.isFocused();
    } catch { poeFocused = true; }
    updateVisibility();
  }, 250);
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
  win.once('ready-to-show', () => updateVisibility());

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
  config = { ...config, ...partial, channels: { ...config.channels, ...(partial.channels || {}) } };
  saveConfig();
  send('config', config);
  updateVisibility();
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
app.whenReady().then(() => {
  createWindow();
  watchForeground();
  watchCursor();
  globalShortcut.register('CommandOrControl+Shift+L', () => { locked = !locked; applyLock(); });
  globalShortcut.register('CommandOrControl+Shift+H', () => { userHidden = !userHidden; updateVisibility(); });
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  if (tailer) tailer.stop();
});
app.on('window-all-closed', () => app.quit());
