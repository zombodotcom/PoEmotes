// Builds a { code: { url, zw, src } } map from Twitch globals, BTTV, FFZ and 7TV.
// Later sources override earlier ones, so channel emotes beat globals and 7TV beats BTTV beats FFZ.

const TWITCH_GLOBALS = {
  Kappa: 25, Kreygasm: 41, '4Head': 354, ResidentSleeper: 245, DansGame: 33, SwiftRage: 34,
  PJSalt: 36, FailFish: 360, SeemsGood: 64138, NotLikeThis: 58765, LUL: 425618, WutFace: 28087,
  BabyRage: 22639, HeyGuys: 30259, Jebaited: 114836, CoolStoryBob: 123171, KappaPride: 55338,
  Keepo: 1902, MingLee: 68856, cmonBruh: 84608, TriHard: 120232, EleGiggle: 4339, VoHiYo: 81274,
  OSFrog: 81248, BloodTrail: 69, CorgiDerp: 49106, PogChamp: 305954156, GivePLZ: 112291,
  TakeNRG: 112292, SMOrc: 52, KomodoHype: 81273, MrDestructoid: 28, BrokeBack: 4057,
};

// BTTV doesn't flag these in its API, but its own client renders them as overlays.
const BTTV_ZERO_WIDTH = new Set(['SoSnowy', 'IceCold', 'SantaHat', 'TopHat', 'ReinDeer', 'CandyCane', 'cvMask', 'cvHazmat']);

async function getJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'poechat-overlay' } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

async function safe(label, fn, log) {
  try { return await fn(); } catch (e) { log(`${label}: ${e.message}`); return []; }
}

const bttvUrl = (id) => `https://cdn.betterttv.net/emote/${id}/2x.webp`;

function fromBttv(list) {
  return list.map((e) => ({ code: e.code, url: bttvUrl(e.id), zw: BTTV_ZERO_WIDTH.has(e.code), src: 'BTTV' }));
}

function fromFfz(list) {
  return list.map((e) => ({ code: e.code, url: e.images['2x'] || e.images['1x'], zw: false, src: 'FFZ' }));
}

function from7tv(list) {
  return (list || []).map((e) => {
    const host = e.data && e.data.host;
    const url = host ? `https:${host.url}/2x.webp` : `https://cdn.7tv.app/emote/${e.id}/2x.webp`;
    return { code: e.name, url, zw: ((e.flags || 0) & 1) === 1, src: '7TV' };
  });
}

async function resolveTwitchId(login) {
  const data = await getJson(`https://api.ivr.fi/v2/twitch/user?login=${encodeURIComponent(login)}`);
  if (!Array.isArray(data) || !data[0]) throw new Error(`Twitch user "${login}" not found`);
  return data[0].id;
}

async function loadEmotes(channels, log = () => {}) {
  const layers = [];

  layers.push(Object.entries(TWITCH_GLOBALS).map(([code, id]) => ({
    code, url: `https://static-cdn.jtvnw.net/emoticons/v2/${id}/default/dark/2.0`, zw: false, src: 'Twitch',
  })));

  const [ffzG, bttvG, stvG] = await Promise.all([
    safe('FFZ global', async () => fromFfz(await getJson('https://api.betterttv.net/3/cached/frankerfacez/emotes/global')), log),
    safe('BTTV global', async () => fromBttv(await getJson('https://api.betterttv.net/3/cached/emotes/global')), log),
    safe('7TV global', async () => from7tv((await getJson('https://7tv.io/v3/emote-sets/global')).emotes), log),
  ]);
  layers.push(ffzG, bttvG, stvG);

  for (const raw of channels || []) {
    const login = String(raw).trim().toLowerCase().replace(/^.*twitch\.tv\//, '').replace(/\/.*$/, '');
    if (!login) continue;
    log(`Loading emotes for ${login}...`);
    let id;
    try { id = await resolveTwitchId(login); } catch (e) { log(e.message); continue; }
    const [ffzC, bttvC, stvC] = await Promise.all([
      safe(`FFZ ${login}`, async () => fromFfz(await getJson(`https://api.betterttv.net/3/cached/frankerfacez/users/twitch/${id}`)), log),
      safe(`BTTV ${login}`, async () => {
        const d = await getJson(`https://api.betterttv.net/3/cached/users/twitch/${id}`);
        return fromBttv([...(d.channelEmotes || []), ...(d.sharedEmotes || [])]);
      }, log),
      safe(`7TV ${login}`, async () => {
        const d = await getJson(`https://7tv.io/v3/users/twitch/${id}`);
        return from7tv(d.emote_set && d.emote_set.emotes);
      }, log),
    ]);
    layers.push(ffzC, bttvC, stvC);
  }

  const map = {};
  for (const layer of layers) for (const e of layer) map[e.code] = { url: e.url, zw: e.zw, src: e.src };
  return map;
}

module.exports = { loadEmotes };
