use regex::Regex;
use serde::Serialize;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::OnceLock;

#[derive(Serialize, Clone, Debug)]
pub struct Msg {
    pub id: u64,
    pub time: String,
    pub channel: &'static str,
    pub guild: Option<String>,
    pub name: String,
    pub text: String,
}

struct Res {
    line: Regex,
    body: Regex,
    name: Regex,
}

fn res() -> &'static Res {
    static R: OnceLock<Res> = OnceLock::new();
    R.get_or_init(|| Res {
        // 2026/11/23 16:12:57 347618968 cffb06be [INFO Client 360580] #<GUILD> Name: message
        line: Regex::new(r"^(\d{4})/(\d\d)/(\d\d) (\d\d):(\d\d):(\d\d) \d+ \S+ \[\w+ Client \d+\] (.*)$").unwrap(),
        // Optional "<guild tag> " then a name then ": ". Guild tags can contain ':'.
        body: Regex::new(r"^(?:<(.*?)> )?([^\s:<\[][^:]*?): ((?s:.*))$").unwrap(),
        // Player names are one token; local lines with spaces in the name are NPCs/debug output.
        name: Regex::new(r"^[\p{L}\p{N}_]+$").unwrap(),
    })
}

const PREFIXES: &[(&str, &str)] = &[
    ("@From ", "whisper-from"),
    ("@To ", "whisper-to"),
    ("#", "global"),
    ("$", "trade"),
    ("%", "party"),
    ("&", "guild"),
];

static COUNTER: AtomicU64 = AtomicU64::new(0);

pub fn parse_line(line: &str) -> Option<Msg> {
    let r = res();
    let m = r.line.captures(line)?;
    let mut rest = m.get(7)?.as_str();
    let mut channel = "local";
    for (prefix, ch) in PREFIXES {
        if let Some(s) = rest.strip_prefix(prefix) {
            channel = ch;
            rest = s;
            break;
        }
    }
    let b = r.body.captures(rest)?;
    let name = b.get(2)?.as_str();
    if !r.name.is_match(name) {
        return None;
    }
    Some(Msg {
        id: COUNTER.fetch_add(1, Ordering::Relaxed) + 1,
        time: format!("{}:{}", &m[4], &m[5]),
        channel,
        guild: b.get(1).map(|g| g.as_str().to_string()).filter(|g| !g.is_empty()),
        name: name.to_string(),
        text: b.get(3).map_or("", |t| t.as_str()).to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_channels() {
        let g = parse_line("2026/11/23 16:12:57 347618968 cffb06be [INFO Client 360580] #<:cute:> Bob_1: hi KEKW").unwrap();
        assert_eq!((g.channel, g.guild.as_deref(), g.name.as_str(), g.text.as_str()), ("global", Some(":cute:"), "Bob_1", "hi KEKW"));
        let w = parse_line("2026/11/23 16:12:57 1 a [INFO Client 1] @From Alice: wtb: thing").unwrap();
        assert_eq!((w.channel, w.name.as_str(), w.text.as_str()), ("whisper-from", "Alice", "wtb: thing"));
        let l = parse_line("2026/11/23 16:12:57 1 a [INFO Client 1] Zé: oi").unwrap();
        assert_eq!(l.channel, "local");
        assert!(parse_line("2026/11/23 16:12:57 1 a [INFO Client 1] Lady Dialla: words").is_none());
        assert!(parse_line("2026/11/23 16:12:57 1 a [INFO Client 1] : You have entered Oriath.").is_none());
    }
}
