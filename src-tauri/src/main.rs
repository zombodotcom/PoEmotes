#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod config;
mod emotes;
mod parser;
mod tailer;
mod win;

use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WindowEvent};
use tauri_plugin_global_shortcut::{Code, Modifiers, ShortcutState};

struct St {
    config: config::Config,
    emotes: Value,
    status: String,
    hwnd: isize,
    locked: bool,
    user_hidden: bool, // Ctrl+Shift+H
    revealed: bool,    // hover-to-reveal: hidden so PoE's chat underneath gets the mouse
    poe_focused: bool,
    overlay_focused: bool,
    shown: bool,
    hover_since: Option<Instant>,
    tailer_gen: u64,
}

type Shared = Arc<Mutex<St>>;

fn st(app: &AppHandle) -> &Shared {
    app.state::<Shared>().inner()
}

fn set_status(app: &AppHandle, s: String) {
    st(app).lock().unwrap().status = s.clone();
    let _ = app.emit("status", s);
}

// Never hold the state lock while calling into the window: those calls may wait on
// the UI thread, which may itself be waiting on the lock.
fn update_visibility(app: &AppHandle) {
    let (hwnd, want) = {
        let mut s = st(app).lock().unwrap();
        let want = !s.user_hidden
            && !s.revealed
            && (!s.locked || !s.config.only_when_poe_focused || s.poe_focused || s.overlay_focused);
        if want == s.shown || s.hwnd == 0 {
            return;
        }
        s.shown = want;
        (s.hwnd, want)
    };
    let _ = app.run_on_main_thread(move || win::set_visible(hwnd, want));
}

// Click-through and focusability go through Tauri, because it keeps its own copy of
// the window's styles and re-applies them (including "visible") whenever one changes.
// Hiding for hover-reveal is done directly, so after a re-apply the window is shown
// again and update_visibility re-hides it if needed.
fn apply_lock(app: &AppHandle) {
    let locked = st(app).lock().unwrap().locked;
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.set_ignore_cursor_events(locked);
        let _ = w.set_focusable(!locked);
        if !locked {
            let _ = w.set_focus();
        }
    }
    st(app).lock().unwrap().shown = true;
    let _ = app.emit("lock", locked);
    update_visibility(app);
}

fn toggle_lock_inner(app: &AppHandle) {
    {
        let mut s = st(app).lock().unwrap();
        s.locked = !s.locked;
    }
    apply_lock(app);
}

struct UpdateItem(tauri::menu::MenuItem<tauri::Wry>);

/// Post a line into the overlay's chat as if PoEmotes said it.
fn notice(app: &AppHandle, text: String) {
    let msg = json!({ "id": 0, "time": "", "channel": "system", "guild": null, "name": "PoEmotes", "text": text });
    let _ = app.emit("messages", json!({ "messages": [msg], "backfill": false }));
}

/// Startup check only tells you; the tray item (or `install`) downloads and installs.
fn check_updates(app: &AppHandle, install: bool) {
    use tauri_plugin_updater::UpdaterExt;
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let updater = match app.updater() {
            Ok(u) => u,
            Err(e) => return set_status(&app, format!("Updater unavailable: {e}")),
        };
        match updater.check().await {
            Ok(Some(update)) if install => {
                notice(&app, format!("Installing PoEmotes {}...", update.version));
                match update.download_and_install(|_, _| {}, || {}).await {
                    Ok(()) => app.restart(),
                    Err(e) => notice(&app, format!("Update failed: {e}")),
                }
            }
            Ok(Some(update)) => {
                if let Some(item) = app.try_state::<UpdateItem>() {
                    let _ = item.0.set_text(format!("Install update {}", update.version));
                }
                notice(&app, format!("PoEmotes {} is out. Right-click the tray icon and choose Install update.", update.version));
            }
            Ok(None) if install => notice(&app, "PoEmotes is up to date.".into()),
            Ok(None) => {}
            Err(e) if install => notice(&app, format!("Update check failed: {e}")),
            Err(e) => set_status(&app, format!("Update check failed: {e}")),
        }
    });
}

fn toggle_hidden(app: &AppHandle) {
    {
        let mut s = st(app).lock().unwrap();
        s.user_hidden = !s.user_hidden;
    }
    update_visibility(app);
}

fn build_tray(app: &tauri::App) -> tauri::Result<()> {
    use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
    use tauri::tray::TrayIconBuilder;
    let item = |id: &str, label: &str| MenuItem::with_id(app, id, label, true, None::<&str>);
    let settings = item("settings", "Settings")?;
    let edit = item("edit", "Move / resize	Ctrl+Shift+L")?;
    let hide = item("hide", "Hide / show	Ctrl+Shift+H")?;
    let reload = item("reload", "Reload emotes")?;
    let update = item("update", "Check for updates")?;
    let sep = PredefinedMenuItem::separator(app)?;
    let quit = item("quit", "Quit PoEmotes")?;
    let menu = Menu::with_items(app, &[&settings, &edit, &hide, &reload, &update, &sep, &quit])?;
    app.manage(UpdateItem(update.clone()));
    let mut tray = TrayIconBuilder::with_id("main").tooltip("PoEmotes").menu(&menu).on_menu_event(|app, e| {
        match e.id.as_ref() {
            "settings" => {
                if st(app).lock().unwrap().user_hidden {
                    toggle_hidden(app);
                }
                if st(app).lock().unwrap().locked {
                    toggle_lock_inner(app);
                }
                let _ = app.emit("open-settings", ());
            }
            "edit" => toggle_lock_inner(app),
            "hide" => toggle_hidden(app),
            "reload" => refresh_emotes_inner(app),
            "update" => check_updates(app, true),
            "quit" => app.exit(0),
            _ => {}
        }
    });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}

fn save_bounds(app: &AppHandle) {
    let Some(w) = app.get_webview_window("main") else { return };
    let (Ok(p), Ok(sz)) = (w.outer_position(), w.outer_size()) else { return };
    let mut s = st(app).lock().unwrap();
    s.config.bounds = Some(config::Bounds { x: p.x, y: p.y, width: sz.width, height: sz.height });
    config::save(&s.config);
}

fn start_tailer(app: &AppHandle) {
    let (gen, cfg) = {
        let mut s = st(app).lock().unwrap();
        s.tailer_gen += 1;
        (s.tailer_gen, s.config.clone())
    };
    let path: Option<PathBuf> = if cfg.log_path.is_empty() {
        config::detect_log_path()
    } else {
        Some(PathBuf::from(&cfg.log_path))
    };
    let Some(path) = path else {
        set_status(app, "Could not find Client.txt. Set the path in settings (Ctrl+Shift+L).".into());
        return;
    };
    set_status(app, format!("Reading {}", path.display()));

    let shared = st(app).clone();
    let alive = {
        let shared = shared.clone();
        move || shared.lock().unwrap().tailer_gen == gen
    };
    let app2 = app.clone();
    tailer::spawn(path, alive, move |lines, backfill| {
        let (hide_npcs, npcs) = {
            let s = shared.lock().unwrap();
            (s.config.hide_npcs, s.config.npc_names.iter().map(|n| n.to_lowercase()).collect::<Vec<_>>())
        };
        let msgs: Vec<parser::Msg> = lines
            .iter()
            .filter_map(|l| parser::parse_line(l))
            .filter(|m| !(hide_npcs && m.channel == "local" && npcs.contains(&m.name.to_lowercase())))
            .collect();
        if !msgs.is_empty() {
            let _ = app2.emit("messages", json!({ "messages": msgs, "backfill": backfill }));
        }
    });
}

fn refresh_emotes_inner(app: &AppHandle) {
    let app = app.clone();
    thread::spawn(move || {
        let channels = st(&app).lock().unwrap().config.twitch_channels.clone();
        let log_app = app.clone();
        let log = move |m: String| set_status(&log_app, m);
        let map = emotes::load(&channels, &log);
        let n = map.len();
        let v = Value::Object(map);
        let _ = std::fs::create_dir_all(config::dir());
        let _ = std::fs::write(config::emote_cache_path(), v.to_string());
        st(&app).lock().unwrap().emotes = v.clone();
        let _ = app.emit("emotes", v);
        set_status(&app, format!("Loaded {n} emotes"));
    });
}

// Cursor dwell for hover-reveal every 50ms; foreground window every 250ms.
fn watch(app: AppHandle) {
    thread::spawn(move || {
        let mut tick: u64 = 0;
        loop {
            thread::sleep(Duration::from_millis(50));
            tick += 1;
            let (hwnd, locked, hover, delay) = {
                let s = st(&app).lock().unwrap();
                (s.hwnd, s.locked, s.config.hover_reveal, s.config.reveal_delay_ms)
            };
            if hwnd == 0 {
                continue;
            }
            let fg = if tick % 5 == 0 {
                let fg = win::foreground();
                Some((win::is_poe(fg), fg == hwnd))
            } else {
                None
            };
            let inside = locked && hover && win::cursor_inside(hwnd);
            {
                let mut s = st(&app).lock().unwrap();
                if let Some((poe, ov)) = fg {
                    s.poe_focused = poe;
                    s.overlay_focused = ov;
                }
                let now = Instant::now();
                if !inside {
                    s.hover_since = None;
                } else if s.hover_since.is_none() {
                    s.hover_since = Some(now);
                }
                s.revealed = s.hover_since.is_some_and(|t| now - t >= Duration::from_millis(delay));
            }
            update_visibility(&app);
        }
    });
}

// ---------- commands (async so they never block the UI thread) ----------

#[tauri::command]
async fn init(app: AppHandle) -> Value {
    let out = {
        let s = st(&app).lock().unwrap();
        json!({ "config": s.config, "emotes": s.emotes, "locked": s.locked, "status": s.status })
    };
    apply_lock(&app);
    start_tailer(&app);
    refresh_emotes_inner(&app);
    check_updates(&app, false);
    out
}

#[tauri::command]
async fn save_config(app: AppHandle, partial: Value) {
    let (prev, next) = {
        let mut s = st(&app).lock().unwrap();
        let prev = s.config.clone();
        match config::merge(&s.config, &partial) {
            Ok(c) => s.config = c,
            Err(e) => {
                drop(s);
                set_status(&app, format!("Bad settings: {e}"));
                return;
            }
        }
        config::save(&s.config);
        (prev, s.config.clone())
    };
    let _ = app.emit("config", &next);
    update_visibility(&app);
    if prev.twitch_channels != next.twitch_channels {
        refresh_emotes_inner(&app);
    }
    if prev.log_path != next.log_path {
        start_tailer(&app);
    }
}

#[tauri::command]
async fn refresh_emotes(app: AppHandle) {
    refresh_emotes_inner(&app);
}

#[tauri::command]
async fn toggle_lock(app: AppHandle) {
    toggle_lock_inner(&app);
}

#[tauri::command]
async fn resize_by(app: AppHandle, dw: f64, dh: f64) {
    let Some(w) = app.get_webview_window("main") else { return };
    let scale = w.scale_factor().unwrap_or(1.0);
    if let Ok(sz) = w.outer_size() {
        let width = (sz.width as f64 + dw * scale).max(220.0) as u32;
        let height = (sz.height as f64 + dh * scale).max(120.0) as u32;
        let _ = w.set_size(PhysicalSize::new(width, height));
    }
    save_bounds(&app);
}

#[tauri::command]
async fn quit(app: AppHandle) {
    app.exit(0);
}

fn main() {
    let cfg = config::load();
    let cached: Value = std::fs::read_to_string(config::emote_cache_path())
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_else(|| json!({}));
    let shared: Shared = Arc::new(Mutex::new(St {
        config: cfg,
        emotes: cached,
        status: String::new(),
        hwnd: 0,
        locked: true,
        user_hidden: false,
        revealed: false,
        poe_focused: true,
        overlay_focused: false,
        shown: false,
        hover_since: None,
        tailer_gen: 0,
    }));

    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_shortcuts(["ctrl+shift+l", "ctrl+shift+h"])
                .expect("shortcuts")
                .with_handler(|app, shortcut, event| {
                    if event.state != ShortcutState::Pressed {
                        return;
                    }
                    let mods = Modifiers::CONTROL | Modifiers::SHIFT;
                    if shortcut.matches(mods, Code::KeyL) {
                        toggle_lock_inner(app);
                    } else if shortcut.matches(mods, Code::KeyH) {
                        toggle_hidden(app);
                    }
                })
                .build(),
        )
        .manage(shared)
        .invoke_handler(tauri::generate_handler![init, save_config, refresh_emotes, toggle_lock, resize_by, quit])
        .setup(|app| {
            build_tray(app)?;
            let w = app.get_webview_window("main").expect("main window");
            let handle = app.handle().clone();
            let bounds = st(&handle).lock().unwrap().config.bounds;
            if let Some(b) = bounds {
                let _ = w.set_position(PhysicalPosition::new(b.x, b.y));
                let _ = w.set_size(PhysicalSize::new(b.width.max(220), b.height.max(120)));
            } else if let Ok(Some(m)) = w.primary_monitor() {
                let (mp, ms) = (m.position(), m.size());
                let _ = w.set_position(PhysicalPosition::new(mp.x + 20, mp.y + ms.height as i32 - 380 - 300));
            }
            let hwnd = w.hwnd().map(|h| h.0 as isize).unwrap_or(0);
            let _ = w.set_focusable(false);
            let _ = w.set_ignore_cursor_events(true);
            let _ = w.show();
            {
                let mut s = st(&handle).lock().unwrap();
                s.hwnd = hwnd;
                s.shown = true;
            }
            watch(handle);
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::Moved(_) = event {
                save_bounds(window.app_handle());
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running PoEmotes");
}
