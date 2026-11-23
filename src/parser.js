// 2026/11/23 16:12:57 347618968 cffb06be [INFO Client 360580] #<GUILD> Name: message
const LINE_RE = /^(\d{4})\/(\d\d)\/(\d\d) (\d\d):(\d\d):(\d\d) \d+ \S+ \[\w+ Client \d+\] (.*)$/;

// prefix  -> channel
const PREFIXES = [
  ['@From ', 'whisper-from'],
  ['@To ', 'whisper-to'],
  ['#', 'global'],
  ['$', 'trade'],
  ['%', 'party'],
  ['&', 'guild'],
];

// Optional "<guild tag> " then a name then ": ". Guild tags can contain ':' (e.g. <:cute:>).
const BODY_RE = /^(?:<(.*?)> )?([^\s:<\[][^:]*?): ([\s\S]*)$/;
// Player names are a single token; local lines with spaces in the name are NPCs/debug output.
const PLAYER_NAME_RE = /^[\p{L}\p{N}_]+$/u;

let counter = 0;

function parseLine(line) {
  const m = LINE_RE.exec(line);
  if (!m) return null;
  let rest = m[7];
  let channel = 'local';
  for (const [prefix, ch] of PREFIXES) {
    if (rest.startsWith(prefix)) {
      channel = ch;
      rest = rest.slice(prefix.length);
      break;
    }
  }
  const b = BODY_RE.exec(rest);
  if (!b) return null;
  const [, guild, name, text] = b;
  if (!PLAYER_NAME_RE.test(name)) return null;
  return {
    id: ++counter,
    time: `${m[4]}:${m[5]}`,
    channel,
    guild: guild || null,
    name,
    text,
  };
}

module.exports = { parseLine };
