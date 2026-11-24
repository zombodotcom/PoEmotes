// Builds a { code: { url, zw, src } } map from Twitch globals, BTTV, FFZ and 7TV.
// Later layers override earlier ones: channel beats global, 7TV beats BTTV beats FFZ.
use serde_json::{json, Map, Value};
use std::time::Duration;

const TWITCH_GLOBALS: &[(&str, u64)] = &[
    ("Kappa", 25), ("Kreygasm", 41), ("4Head", 354), ("ResidentSleeper", 245), ("DansGame", 33),
    ("SwiftRage", 34), ("PJSalt", 36), ("FailFish", 360), ("SeemsGood", 64138), ("NotLikeThis", 58765),
    ("LUL", 425618), ("WutFace", 28087), ("BabyRage", 22639), ("HeyGuys", 30259), ("Jebaited", 114836),
    ("CoolStoryBob", 123171), ("KappaPride", 55338), ("Keepo", 1902), ("MingLee", 68856),
    ("cmonBruh", 84608), ("TriHard", 120232), ("EleGiggle", 4339), ("VoHiYo", 81274), ("OSFrog", 81248),
    ("BloodTrail", 69), ("CorgiDerp", 49106), ("PogChamp", 305954156), ("GivePLZ", 112291),
    ("TakeNRG", 112292), ("SMOrc", 52), ("KomodoHype", 81273), ("MrDestructoid", 28), ("BrokeBack", 4057),
];

// BTTV doesn't flag these in its API, but its own client renders them as overlays.
const BTTV_ZERO_WIDTH: &[&str] = &["SoSnowy", "IceCold", "SantaHat", "TopHat", "ReinDeer", "CandyCane", "cvMask", "cvHazmat"];

type Log<'a> = &'a (dyn Fn(String) + Sync);

struct E {
    code: String,
    url: String,
    zw: bool,
    src: &'static str,
}

fn get_json(url: &str) -> Result<Value, String> {
    ureq::get(url)
        .set("User-Agent", "poemotes-overlay")
        .timeout(Duration::from_secs(20))
        .call()
        .map_err(|e| e.to_string())?
        .into_json::<Value>()
        .map_err(|e| e.to_string())
}

fn s(v: &Value, k: &str) -> String {
    match &v[k] {
        Value::String(x) => x.clone(),
        Value::Number(n) => n.to_string(),
        _ => String::new(),
    }
}

fn arr(v: &Value) -> &[Value] {
    v.as_array().map(|a| a.as_slice()).unwrap_or(&[])
}

fn from_bttv(list: &[Value]) -> Vec<E> {
    list.iter()
        .map(|e| {
            let code = s(e, "code");
            E {
                zw: BTTV_ZERO_WIDTH.contains(&code.as_str()),
                url: format!("https://cdn.betterttv.net/emote/{}/2x.webp", s(e, "id")),
                code,
                src: "BTTV",
            }
        })
        .collect()
}

fn from_ffz(list: &[Value]) -> Vec<E> {
    list.iter()
        .filter_map(|e| {
            let img = &e["images"];
            let url = img["2x"].as_str().or(img["1x"].as_str())?.to_string();
            Some(E { code: s(e, "code"), url, zw: false, src: "FFZ" })
        })
        .collect()
}

fn from_7tv(list: &[Value]) -> Vec<E> {
    list.iter()
        .map(|e| {
            let url = match e["data"]["host"]["url"].as_str() {
                Some(h) => format!("https:{h}/2x.webp"),
                None => format!("https://cdn.7tv.app/emote/{}/2x.webp", s(e, "id")),
            };
            E { code: s(e, "name"), url, zw: e["flags"].as_u64().unwrap_or(0) & 1 == 1, src: "7TV" }
        })
        .collect()
}

fn safe(label: &str, log: Log, f: impl FnOnce() -> Result<Vec<E>, String>) -> Vec<E> {
    f().unwrap_or_else(|e| {
        log(format!("{label}: {e}"));
        Vec::new()
    })
}

fn twitch_id(login: &str) -> Result<String, String> {
    let d = get_json(&format!("https://api.ivr.fi/v2/twitch/user?login={login}"))?;
    let id = s(&d[0], "id");
    if id.is_empty() {
        Err(format!("Twitch user \"{login}\" not found"))
    } else {
        Ok(id)
    }
}

fn channel_layers(login: &str, log: Log) -> Vec<Vec<E>> {
    log(format!("Loading emotes for {login}..."));
    let id = match twitch_id(login) {
        Ok(id) => id,
        Err(e) => {
            log(e);
            return Vec::new();
        }
    };
    vec![
        safe(&format!("FFZ {login}"), log, || {
            Ok(from_ffz(arr(&get_json(&format!("https://api.betterttv.net/3/cached/frankerfacez/users/twitch/{id}"))?)))
        }),
        safe(&format!("BTTV {login}"), log, || {
            let d = get_json(&format!("https://api.betterttv.net/3/cached/users/twitch/{id}"))?;
            let mut v = from_bttv(arr(&d["channelEmotes"]));
            v.extend(from_bttv(arr(&d["sharedEmotes"])));
            Ok(v)
        }),
        safe(&format!("7TV {login}"), log, || {
            Ok(from_7tv(arr(&get_json(&format!("https://7tv.io/v3/users/twitch/{id}"))?["emote_set"]["emotes"])))
        }),
    ]
}

/// "https://twitch.tv/Zizaran/" -> "zizaran"; rejects anything that isn't a login.
fn login_of(raw: &str) -> Option<String> {
    let l = raw.trim().to_lowercase();
    let l = l.rsplit("twitch.tv/").next()?.split('/').next()?.to_string();
    (!l.is_empty() && l.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')).then_some(l)
}

pub fn load(channels: &[String], log: Log) -> Map<String, Value> {
    let mut layers: Vec<Vec<E>> = vec![TWITCH_GLOBALS
        .iter()
        .map(|(code, id)| E {
            code: code.to_string(),
            url: format!("https://static-cdn.jtvnw.net/emoticons/v2/{id}/default/dark/2.0"),
            zw: false,
            src: "Twitch",
        })
        .collect()];

    let logins: Vec<String> = channels.iter().filter_map(|c| login_of(c)).collect();

    std::thread::scope(|sc| {
        let globals = [
            sc.spawn(|| safe("FFZ global", log, || Ok(from_ffz(arr(&get_json("https://api.betterttv.net/3/cached/frankerfacez/emotes/global")?))))),
            sc.spawn(|| safe("BTTV global", log, || Ok(from_bttv(arr(&get_json("https://api.betterttv.net/3/cached/emotes/global")?))))),
            sc.spawn(|| safe("7TV global", log, || Ok(from_7tv(arr(&get_json("https://7tv.io/v3/emote-sets/global")?["emotes"]))))),
        ];
        let chans: Vec<_> = logins.iter().map(|l| sc.spawn(move || channel_layers(l, log))).collect();
        for g in globals {
            layers.push(g.join().unwrap_or_default());
        }
        for c in chans {
            layers.extend(c.join().unwrap_or_default());
        }
    });

    let mut map = Map::new();
    for layer in layers {
        for e in layer {
            if !e.code.is_empty() {
                map.insert(e.code, json!({ "url": e.url, "zw": e.zw, "src": e.src }));
            }
        }
    }
    map
}
