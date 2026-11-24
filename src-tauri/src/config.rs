use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;
use std::path::PathBuf;

const DEFAULT_NPCS: &[&str] = &[
    "Faustus", "Izaro", "Oshabi", "Vesper", "Sin", "Valdo", "Zana", "Treasurer", "Venarius",
    "Navali", "Helena", "Tasuni", "Kirac", "Alva", "Jun", "Niko", "Einhar", "Tane", "Lilly",
    "Dannig", "Rog", "Tujen", "Gwennen", "Ange", "Kalguur", "Hargan", "Kaom", "Daresso",
    "Piety", "Dominus", "Malachai", "Kitava", "Innocence", "Doedre", "Maligaro", "Shavronne",
    "Atziri", "Trialmaster", "Sirus", "Catarina", "Aisling", "Elreon", "Haku", "Leo", "Vorici",
    "Guff", "Gravicius", "Hillock", "Tarkleigh", "Nessa", "Bestel", "Greust", "Yeena", "Silk",
    "Eramir", "Clarissa", "Maramoa", "Grigor", "Petarus", "Vanja", "Lani", "Irasha", "Oyun",
    "Utula", "Hinekora", "Doryani", "Jamanra", "Zolin", "Una", "Renly", "Finn", "Dialla",
    "Merveil", "Bannon", "Avarius", "Lycia", "Kauri", "Brutus", "Weylam", "Fairgraves", "Vagan",
];

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(default)]
pub struct Channels {
    pub global: bool,
    pub trade: bool,
    pub party: bool,
    pub guild: bool,
    pub whisper: bool,
    pub local: bool,
}

impl Default for Channels {
    fn default() -> Self {
        Self { global: true, trade: true, party: true, guild: true, whisper: true, local: true }
    }
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug)]
pub struct Bounds {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(default, rename_all = "camelCase")]
pub struct Config {
    pub log_path: String,
    pub twitch_channels: Vec<String>,
    pub font_size: f64,
    pub font_family: String,
    pub emote_size: f64,
    pub fade_seconds: f64,
    pub max_messages: u32,
    pub background_opacity: f64,
    pub show_timestamps: bool,
    pub channels: Channels,
    pub hide_npcs: bool,
    pub npc_names: Vec<String>,
    pub emote_only: bool,
    pub only_when_poe_focused: bool,
    pub hover_reveal: bool,
    pub reveal_delay_ms: u64,
    pub bounds: Option<Bounds>,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            log_path: String::new(),
            twitch_channels: ["xqc", "forsen", "zizaran", "quin69", "sodapoppin", "moonmoon", "mathil1"]
                .iter()
                .map(|s| s.to_string())
                .collect(),
            font_size: 15.0,
            font_family: "Segoe UI".into(),
            emote_size: 1.9,
            fade_seconds: 10.0,
            max_messages: 150,
            background_opacity: 0.8,
            show_timestamps: false,
            channels: Channels::default(),
            hide_npcs: true,
            npc_names: DEFAULT_NPCS.iter().map(|s| s.to_string()).collect(),
            emote_only: false,
            only_when_poe_focused: false,
            hover_reveal: true,
            reveal_delay_ms: 350,
            bounds: None,
        }
    }
}

fn appdata() -> PathBuf {
    PathBuf::from(std::env::var("APPDATA").unwrap_or_else(|_| ".".into()))
}

pub fn dir() -> PathBuf {
    appdata().join("PoEmotes")
}

pub fn config_path() -> PathBuf {
    dir().join("config.json")
}

pub fn emote_cache_path() -> PathBuf {
    dir().join("emote-cache.json")
}

pub fn load() -> Config {
    let mut path = config_path();
    if !path.exists() {
        // carry settings over from the old Electron build
        let old = appdata().join("poechat").join("config.json");
        if old.exists() {
            path = old;
        }
    }
    fs::read_to_string(path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

pub fn save(c: &Config) {
    let _ = fs::create_dir_all(dir());
    if let Ok(s) = serde_json::to_string_pretty(c) {
        let _ = fs::write(config_path(), s);
    }
}

/// Apply a partial config from the settings form; `channels` is merged key by key.
pub fn merge(c: &Config, partial: &Value) -> Result<Config, String> {
    let mut v = serde_json::to_value(c).map_err(|e| e.to_string())?;
    if let (Some(dst), Some(src)) = (v.as_object_mut(), partial.as_object()) {
        for (k, val) in src {
            if k == "channels" {
                if let (Some(dc), Some(sc)) = (dst.get_mut("channels").and_then(|x| x.as_object_mut()), val.as_object()) {
                    for (ck, cv) in sc {
                        dc.insert(ck.clone(), cv.clone());
                    }
                    continue;
                }
            }
            dst.insert(k.clone(), val.clone());
        }
    }
    serde_json::from_value(v).map_err(|e| e.to_string())
}

pub fn detect_log_path() -> Option<PathBuf> {
    let mut best: Option<(PathBuf, std::time::SystemTime)> = None;
    for d in "CDEFGH".chars() {
        let roots = [
            format!("{d}:\\Program Files (x86)\\Steam\\steamapps\\common"),
            format!("{d}:\\Program Files\\Steam\\steamapps\\common"),
            format!("{d}:\\SteamLibrary\\steamapps\\common"),
            format!("{d}:\\Steam\\steamapps\\common"),
            format!("{d}:\\Program Files (x86)\\Grinding Gear Games"),
            format!("{d}:\\Program Files\\Grinding Gear Games"),
            format!("{d}:\\Games"),
        ];
        for root in roots {
            for game in ["Path of Exile", "Path of Exile 2"] {
                let p = PathBuf::from(&root).join(game).join("logs").join("Client.txt");
                if let Ok(m) = fs::metadata(&p).and_then(|m| m.modified()) {
                    if best.as_ref().map_or(true, |(_, t)| m > *t) {
                        best = Some((p, m));
                    }
                }
            }
        }
    }
    best.map(|(p, _)| p)
}
