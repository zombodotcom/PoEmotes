/* global poechat */
const chatEl = document.getElementById('chat');
const statusEl = document.getElementById('status');
const settingsEl = document.getElementById('settings');
const emoteCountEl = document.getElementById('emote-count');

let config = null;
let friends = new Set(); // lowercased names
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

// ---------- currency icons ----------
const CUR_BASE = 'https://web.poecdn.com/image/Art/2DItems/Currency/';
const CURRENCY = {};
// [icon file, name, words that always count, words that only count next to a number]
for (const [file, name, always, numOnly] of [
  ['CurrencyModValues', 'Divine Orb', ['div', 'divs', 'divine', 'divines'], ['d']],
  ['CurrencyRerollRare', 'Chaos Orb', ['chaos'], ['c']],
  ['CurrencyAddModToRare', 'Exalted Orb', ['exalt', 'exalts', 'exalted', 'exa'], ['ex']],
  ['CurrencyDuplicate', 'Mirror of Kalandra', ['mirror', 'mirrors'], ['mirr']],
  ['CurrencyUpgradeToRare', 'Orb of Alchemy', ['alch', 'alchs', 'alchemy'], []],
  ['CurrencyRerollSocketLinks', 'Orb of Fusing', ['fusing', 'fusings', 'fuses'], ['fuse', 'fus']],
  ['CurrencyRerollSocketNumbers', "Jeweller's Orb", ['jewellers', 'jeweller', "jeweller's"], ['jew', 'jews']],
  ['CurrencyRerollSocketColours', 'Chromatic Orb', ['chrome', 'chromes', 'chromatic', 'chromatics'], ['chrom']],
  ['CurrencyUpgradeMagicToRare', 'Regal Orb', ['regal', 'regals'], []],
  ['CurrencyVaal', 'Vaal Orb', [], ['vaal', 'vaals']],
  ['CurrencyConvertToNormal', 'Orb of Scouring', ['scour', 'scours', 'scouring'], []],
  ['AnnullOrb', 'Orb of Annulment', ['annul', 'annuls', 'annulment', 'annulments'], []],
  ['CurrencyRerollMagic', 'Orb of Alteration', ['alts', 'alteration', 'alterations'], ['alt']],
  ['CurrencyGemQuality', "Gemcutter's Prism", ['gcp', 'gcps'], []],
  ['CurrencyPassiveSkillRefund', 'Orb of Regret', ['regrets'], ['regret']],
  ['CurrencyUpgradeToMagic', 'Orb of Transmutation', ['transmute', 'transmutes'], ['trans']],
  ['CurrencyIdentification', 'Scroll of Wisdom', [], ['wisdom', 'wisdoms', 'wis']],
]) {
  for (const w of always) CURRENCY[w] = { url: `${CUR_BASE}${file}.png`, name, num: false };
  for (const w of numOnly) CURRENCY[w] = { url: `${CUR_BASE}${file}.png`, name, num: true };
}
const NUM_RE = /^\d+(?:[.,]\d+)?[kx]?$/i;
const CUR_RE = /^(\d+(?:[.,]\d+)?)?([a-z']+)([.,!?;:)]*)$/i;

// "150c" -> 150 + icon, "div" -> icon. Short words like "c" only count next to a number.
function currencyNodes(tok, prevNumeric) {
  const m = CUR_RE.exec(tok);
  if (!m) return null;
  const [, num, word, punct] = m;
  const c = CURRENCY[word.toLowerCase()];
  if (!c) return null;
  if (c.num && !num && !prevNumeric) return null;
  const nodes = [];
  if (num) nodes.push(document.createTextNode(num));
  const wrap = span('currency');
  const img = document.createElement('img');
  img.src = c.url;
  img.alt = word;
  img.title = c.name;
  img.draggable = false;
  img.onerror = () => { wrap.replaceWith(document.createTextNode(word)); };
  wrap.appendChild(img);
  nodes.push(wrap);
  if (punct) nodes.push(document.createTextNode(punct));
  return nodes;
}

function renderText(text) {
  const out = span('text');
  let lastEmote = null; // the emote wrapper zero-width emotes stack onto
  let pendingSpace = null;
  let prevNumeric = false;
  const currency = !config || config.currencyIcons !== false;
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
      const cur = currency && currencyNodes(tok, prevNumeric);
      if (cur) cur.forEach((n) => out.appendChild(n));
      else out.appendChild(document.createTextNode(tok));
      lastEmote = null;
    }
    prevNumeric = NUM_RE.test(tok);
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
  el.appendChild(span(friends.has(m.name.toLowerCase()) ? 'name friend' : 'name', m.name));
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

// Follow new messages unless the user scrolled up to read. Emote images finish
// loading after a message is added and make it taller, so re-stick on image load too.
let userScrolledUp = false;
function stickToBottom() {
  if (!userScrolledUp) chatEl.scrollTop = chatEl.scrollHeight;
}
chatEl.addEventListener('wheel', () => { setTimeout(() => { userScrolledUp = !atBottom(); }, 50); });
chatEl.addEventListener('scroll', () => { if (atBottom()) userScrolledUp = false; });
chatEl.addEventListener('load', stickToBottom, true);

function addMessages(list, backfill) {
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
  stickToBottom();
  updateIdle();
}

function rerenderAll() {
  for (const entry of messages) {
    const el = renderMessage(entry.msg);
    el.hidden = !isVisible(entry.msg);
    entry.el.replaceWith(el);
    entry.el = el;
    updateFade(entry);
  }
  userScrolledUp = false;
  stickToBottom();
}

function applyConfig() {
  document.documentElement.style.setProperty('--font-size', `${config.fontSize}px`);
  document.documentElement.style.setProperty('--bg-opacity', config.backgroundOpacity);
  const family = String(config.fontFamily || 'Segoe UI').replace(/["\\;{}]/g, '');
  document.documentElement.style.setProperty('--font-family', `"${family}"`);
  friends = new Set((config.friends || []).map((n) => String(n).trim().toLowerCase()).filter(Boolean));
  if (/^#[0-9a-f]{6}$/i.test(config.friendColor || '')) document.documentElement.style.setProperty('--friend-color', config.friendColor);
  document.documentElement.style.setProperty('--emote-size', `${Number(config.emoteSize) || 1.9}em`);
  const f = settingsEl.elements;
  f.twitchChannels.value = (config.twitchChannels || []).join(', ');
  f.logPath.value = config.logPath || '';
  f.fontSize.value = config.fontSize;
  f.fontFamily.value = config.fontFamily || '';
  f.emoteSize.value = config.emoteSize;
  f.fadeSeconds.value = config.fadeSeconds;
  f.backgroundOpacity.value = config.backgroundOpacity;
  f.showTimestamps.checked = !!config.showTimestamps;
  f.hideNpcs.checked = !!config.hideNpcs;
  f.emoteOnly.checked = !!config.emoteOnly;
  f.currencyIcons.checked = config.currencyIcons !== false;
  f.friends.value = (config.friends || []).join(', ');
  f.friendColor.value = config.friendColor || '#ffd75e';
  f.onlyWhenPoeFocused.checked = !!config.onlyWhenPoeFocused;
  f.hoverReveal.checked = !!config.hoverReveal;
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
poechat.on('open-settings', () => { settingsEl.hidden = false; });
poechat.on('reveal', (on) => document.body.classList.toggle('revealed', on));
poechat.on('lock', (l) => {
  locked = l;
  document.body.classList.toggle('locked', l);
  document.body.classList.toggle('unlocked', !l);
  if (l) settingsEl.hidden = true;
  userScrolledUp = false;
  stickToBottom();
});

// When every visible message has faded, fade the background too so the overlay
// disappears completely, like PoE's own chat does.
function updateIdle() {
  const active = messages.some((e) => !e.el.hidden && !e.el.classList.contains('faded'));
  document.body.classList.toggle('idle', !active);
}

setInterval(() => {
  const now = Date.now();
  for (const e of messages) updateFade(e, now);
  updateIdle();
}, 500);

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
    fontFamily: f.fontFamily.value.trim() || 'Segoe UI',
    emoteSize: Math.min(4, Math.max(1, Number(f.emoteSize.value) || 1.9)),
    fadeSeconds: Math.max(0, Number(f.fadeSeconds.value) || 0),
    backgroundOpacity: Number(f.backgroundOpacity.value),
    showTimestamps: f.showTimestamps.checked,
    hideNpcs: f.hideNpcs.checked,
    emoteOnly: f.emoteOnly.checked,
    currencyIcons: f.currencyIcons.checked,
    friends: f.friends.value.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean),
    friendColor: f.friendColor.value,
    onlyWhenPoeFocused: f.onlyWhenPoeFocused.checked,
    hoverReveal: f.hoverReveal.checked,
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

poechat.ready();
