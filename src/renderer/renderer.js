/* global poechat */
const chatEl = document.getElementById('chat');
const statusEl = document.getElementById('status');
const settingsEl = document.getElementById('settings');
const emoteCountEl = document.getElementById('emote-count');

let config = null;
let emotes = {};
let locked = true;
const messages = []; // { msg, el, shownAt }

const PREFIX = {
  global: '#', trade: '$', party: '%', guild: '&',
  'whisper-from': '@From ', 'whisper-to': '@To ', local: '',
};
const FILTER_KEY = {
  global: 'global', trade: 'trade', party: 'party', guild: 'guild',
  'whisper-from': 'whisper', 'whisper-to': 'whisper', local: 'local',
};

function span(cls, text) {
  const s = document.createElement('span');
  if (cls) s.className = cls;
  if (text != null) s.textContent = text;
  return s;
}

function emoteImg(code, e) {
  const img = document.createElement('img');
  img.src = e.url;
  img.alt = code;
  img.title = `${code} (${e.src})`;
  img.draggable = false;
  img.onerror = () => { img.replaceWith(document.createTextNode(code)); };
  return img;
}

function renderText(text) {
  const out = span('text');
  let lastEmote = null; // the emote wrapper zero-width emotes stack onto
  let pendingSpace = null;
  for (const tok of text.split(/(\s+)/)) {
    if (!tok) continue;
    if (/^\s+$/.test(tok)) {
      pendingSpace = document.createTextNode(tok);
      out.appendChild(pendingSpace);
      continue;
    }
    const e = Object.prototype.hasOwnProperty.call(emotes, tok) ? emotes[tok] : null;
    if (e && e.zw && lastEmote) {
      if (pendingSpace) pendingSpace.remove();
      lastEmote.appendChild(emoteImg(tok, e));
    } else if (e) {
      const wrap = span('emote');
      wrap.appendChild(emoteImg(tok, e));
      out.appendChild(wrap);
      lastEmote = wrap;
    } else {
      out.appendChild(document.createTextNode(tok));
      lastEmote = null;
    }
    pendingSpace = null;
  }
  return out;
}

function renderMessage(m) {
  const el = document.createElement('div');
  el.className = `msg ${m.channel}`;
  if (config && config.showTimestamps) el.appendChild(span('ts', m.time));
  if (PREFIX[m.channel]) el.appendChild(span('prefix', PREFIX[m.channel]));
  if (m.guild) el.appendChild(span('guild', `<${m.guild}>`));
  el.appendChild(span('name', m.name));
  el.appendChild(document.createTextNode(': '));
  el.appendChild(renderText(m.text));
  return el;
}

function hasEmote(text) {
  return text.split(/\s+/).some((t) => Object.prototype.hasOwnProperty.call(emotes, t));
}

function isVisible(m) {
  if (!config) return true;
  if (config.channels[FILTER_KEY[m.channel]] === false) return false;
  return !config.emoteOnly || hasEmote(m.text);
}

function updateFade(entry, now = Date.now()) {
  const fade = config ? Number(config.fadeSeconds) : 30;
  const faded = (fade > 0 && now - entry.shownAt > fade * 1000);
  entry.el.classList.toggle('faded', faded);
}

function atBottom() {
  return chatEl.scrollHeight - chatEl.scrollTop - chatEl.clientHeight < 30;
}

function addMessages(list, backfill) {
  const stick = atBottom();
  const now = Date.now();
  for (const msg of list) {
    const entry = { msg, el: renderMessage(msg), shownAt: now, backfill };
    entry.el.hidden = !isVisible(msg);
    updateFade(entry, now);
    messages.push(entry);
    chatEl.appendChild(entry.el);
  }
  const max = (config && config.maxMessages) || 150;
  while (messages.length > max) messages.shift().el.remove();
  if (stick || locked) chatEl.scrollTop = chatEl.scrollHeight;
}

function rerenderAll() {
  for (const entry of messages) {
    const el = renderMessage(entry.msg);
    el.hidden = !isVisible(entry.msg);
    entry.el.replaceWith(el);
    entry.el = el;
    updateFade(entry);
  }
  chatEl.scrollTop = chatEl.scrollHeight;
}

function applyConfig() {
  document.documentElement.style.setProperty('--font-size', `${config.fontSize}px`);
  document.documentElement.style.setProperty('--bg-opacity', config.backgroundOpacity);
  const f = settingsEl.elements;
  f.twitchChannels.value = (config.twitchChannels || []).join(', ');
  f.logPath.value = config.logPath || '';
  f.fontSize.value = config.fontSize;
  f.fadeSeconds.value = config.fadeSeconds;
  f.backgroundOpacity.value = config.backgroundOpacity;
  f.showTimestamps.checked = !!config.showTimestamps;
  f.hideNpcs.checked = !!config.hideNpcs;
  f.emoteOnly.checked = !!config.emoteOnly;
  f.onlyWhenPoeFocused.checked = !!config.onlyWhenPoeFocused;
  for (const k of Object.keys(config.channels)) f[`ch-${k}`].checked = config.channels[k];
  rerenderAll();
}

// ---------- IPC ----------
poechat.on('config', (c) => { config = c; applyConfig(); });
poechat.on('emotes', (e) => {
  emotes = e || {};
  emoteCountEl.textContent = `${Object.keys(emotes).length} emotes loaded`;
  rerenderAll();
});
poechat.on('messages', ({ messages: list, backfill }) => addMessages(list, backfill));
poechat.on('status', (s) => { statusEl.textContent = s; });
poechat.on('lock', (l) => {
  locked = l;
  document.body.classList.toggle('locked', l);
  document.body.classList.toggle('unlocked', !l);
  if (l) settingsEl.hidden = true;
  chatEl.scrollTop = chatEl.scrollHeight;
});

setInterval(() => { const now = Date.now(); for (const e of messages) updateFade(e, now); }, 1000);

// ---------- edit-mode UI ----------
document.getElementById('btn-settings').onclick = () => { settingsEl.hidden = !settingsEl.hidden; };
document.getElementById('btn-lock').onclick = () => poechat.toggleLock();
document.getElementById('btn-quit').onclick = () => poechat.quit();
document.getElementById('btn-refresh').onclick = () => poechat.refreshEmotes();

settingsEl.addEventListener('submit', (ev) => {
  ev.preventDefault();
  const f = settingsEl.elements;
  const channels = {};
  for (const k of ['global', 'trade', 'party', 'guild', 'whisper', 'local']) channels[k] = f[`ch-${k}`].checked;
  poechat.saveConfig({
    twitchChannels: f.twitchChannels.value.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean),
    logPath: f.logPath.value.trim().replace(/^"|"$/g, ''),
    fontSize: Math.min(40, Math.max(9, Number(f.fontSize.value) || 15)),
    fadeSeconds: Math.max(0, Number(f.fadeSeconds.value) || 0),
    backgroundOpacity: Number(f.backgroundOpacity.value),
    showTimestamps: f.showTimestamps.checked,
    hideNpcs: f.hideNpcs.checked,
    emoteOnly: f.emoteOnly.checked,
    onlyWhenPoeFocused: f.onlyWhenPoeFocused.checked,
    channels,
  });
});

// custom resize grip (transparent windows can't use native resize on Windows)
const grip = document.getElementById('grip');
grip.addEventListener('pointerdown', (ev) => {
  grip.setPointerCapture(ev.pointerId);
  let lastX = ev.screenX;
  let lastY = ev.screenY;
  const move = (e) => {
    const dw = e.screenX - lastX;
    const dh = e.screenY - lastY;
    if (dw || dh) { poechat.resizeBy(dw, dh); lastX = e.screenX; lastY = e.screenY; }
  };
  const up = () => { grip.removeEventListener('pointermove', move); grip.removeEventListener('pointerup', up); };
  grip.addEventListener('pointermove', move);
  grip.addEventListener('pointerup', up);
});
