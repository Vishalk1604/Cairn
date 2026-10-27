//! The two shapes of the one window.
//!
//! Most of the time Cairn is a widget: a small frameless panel just above
//! the tray, out of the taskbar, shown and hidden from the tray icon or the
//! hotkey.
//! Expanded, it fills the screen as an ordinary app. The widget's place and
//! size are remembered, so expanding and coming back puts it where it was.
//! The third shape, Today pinned to the desktop, is a window of its own (see
//! desk.rs); its place and whether it is on are kept in the same file.

use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalSize, Runtime, WebviewWindow};

/// In logical pixels: narrow enough to sit beside other work.
const WIDGET_WIDTH: f64 = 400.0;
const WIDGET_HEIGHT: f64 = 680.0;
const MARGIN: f64 = 24.0;
const FILE: &str = "widget.json";

#[derive(Clone, Copy, Serialize, Deserialize)]
pub struct Bounds {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

/// widget.json. The widget's place stays at the top level, where older
/// versions wrote it, so upgrading keeps it.
#[derive(Default, Serialize, Deserialize)]
struct Saved {
    #[serde(flatten, default)]
    widget: Option<Bounds>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    desk: Option<Bounds>,
    #[serde(default)]
    pinned: bool,
}

#[derive(Default)]
pub struct WidgetPlace {
    bounds: Mutex<Option<Bounds>>,
    /// The pinned widget's place, and whether it is pinned, once known this run.
    desk: Mutex<Option<Bounds>>,
    pinned: Mutex<Option<bool>>,
    full: Mutex<bool>,
    /// When the window last lost focus. Clicking the tray icon takes focus
    /// from it a moment before the click arrives, so this is how the click
    /// can tell "it was in front" from "it was buried under other windows".
    blurred_at: Mutex<Option<Instant>>,
}

/// Longer than a click takes to land after the focus moves, shorter than a person.
const JUST_NOW: Duration = Duration::from_millis(500);

pub fn focus_changed<R: Runtime>(window: &WebviewWindow<R>, focused: bool) {
    *window.state::<WidgetPlace>().blurred_at.lock().unwrap() = if focused { None } else { Some(Instant::now()) };
}

/// In front of everything a moment ago: either focused now, or only just
/// lost focus to the click that is asking.
pub fn was_in_front<R: Runtime>(window: &WebviewWindow<R>) -> bool {
    if window.is_focused().unwrap_or(false) {
        return true;
    }
    let blurred_at = *window.state::<WidgetPlace>().blurred_at.lock().unwrap();
    blurred_at.is_some_and(|at| at.elapsed() < JUST_NOW)
}

fn file<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    app.path().app_data_dir().ok().map(|dir| dir.join(FILE))
}

fn load_saved<R: Runtime>(app: &AppHandle<R>) -> Saved {
    file(app)
        .and_then(|path| fs::read_to_string(path).ok())
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

fn load<R: Runtime>(app: &AppHandle<R>) -> Option<Bounds> {
    load_saved(app).widget
}

/// Where the pinned widget was left, if a screen still shows it.
pub fn saved_desk<R: Runtime>(app: &AppHandle<R>) -> Option<Bounds> {
    let remembered = *app.state::<WidgetPlace>().desk.lock().unwrap();
    let main = app.get_webview_window("main")?;
    remembered.or_else(|| load_saved(app).desk).filter(|b| visible(&main, b))
}

pub fn pinned<R: Runtime>(app: &AppHandle<R>) -> bool {
    let known = *app.state::<WidgetPlace>().pinned.lock().unwrap();
    known.unwrap_or_else(|| load_saved(app).pinned)
}

pub fn set_pinned<R: Runtime>(app: &AppHandle<R>, on: bool) {
    *app.state::<WidgetPlace>().pinned.lock().unwrap() = Some(on);
    persist(app);
}

/// Notes where the pinned widget is now.
pub fn remember_desk<R: Runtime>(window: &WebviewWindow<R>) {
    if let (Ok(position), Ok(size)) = (window.outer_position(), window.outer_size()) {
        *window.state::<WidgetPlace>().desk.lock().unwrap() = Some(Bounds { x: position.x, y: position.y, width: size.width, height: size.height });
    }
}

/// A saved place is only used if some screen still shows most of it; a
/// monitor unplugged since would otherwise leave the widget out of reach.
fn visible<R: Runtime>(window: &WebviewWindow<R>, b: &Bounds) -> bool {
    let Ok(monitors) = window.available_monitors() else { return false };
    let (cx, cy) = (b.x + b.width as i32 / 2, b.y + b.height as i32 / 2);
    monitors.iter().any(|m| {
        let area = m.work_area();
        cx >= area.position.x
            && cy >= area.position.y
            && cx < area.position.x + area.size.width as i32
            && cy < area.position.y + area.size.height as i32
    })
}

/// The first time: the bottom right of the screen, just above the tray icon
/// that opens it.
fn first_place<R: Runtime>(window: &WebviewWindow<R>) -> Option<Bounds> {
    let monitor = window.primary_monitor().ok().flatten()?;
    let scale = monitor.scale_factor();
    let area = monitor.work_area();
    let margin = (MARGIN * scale) as i32;
    let width = (WIDGET_WIDTH * scale) as u32;
    let height = ((WIDGET_HEIGHT * scale) as u32).min(area.size.height.saturating_sub(2 * margin as u32));
    Some(Bounds {
        x: area.position.x + area.size.width as i32 - width as i32 - margin,
        y: area.position.y + area.size.height as i32 - height as i32 - margin,
        width,
        height,
    })
}

/// Shrinks the window back into the widget, where it was last left.
pub fn to_widget<R: Runtime>(window: &WebviewWindow<R>) {
    let place = window.state::<WidgetPlace>();
    *place.full.lock().unwrap() = false;
    let _ = window.unmaximize();
    let _ = window.set_skip_taskbar(true);
    let remembered = *place.bounds.lock().unwrap();
    let saved = remembered.or_else(|| load(window.app_handle())).filter(|b| visible(window, b));
    if let Some(b) = saved.or_else(|| first_place(window)) {
        let _ = window.set_size(PhysicalSize::new(b.width, b.height));
        let _ = window.set_position(PhysicalPosition::new(b.x, b.y));
        *place.bounds.lock().unwrap() = Some(b);
    }
}

/// Notes where the widget is now. Ignored while expanded, so the full
/// screen size never becomes the widget's.
pub fn remember<R: Runtime>(window: &WebviewWindow<R>) {
    let place = window.state::<WidgetPlace>();
    if *place.full.lock().unwrap() || window.is_maximized().unwrap_or(false) || window.is_minimized().unwrap_or(false) {
        return;
    }
    if let (Ok(position), Ok(size)) = (window.outer_position(), window.outer_size()) {
        *place.bounds.lock().unwrap() = Some(Bounds { x: position.x, y: position.y, width: size.width, height: size.height });
    }
}

/// Writes the widget's place to disk: on hiding, expanding and quitting,
/// rather than on every pixel of a drag. What this run has not touched is
/// kept as it was in the file.
pub fn persist<R: Runtime>(app: &AppHandle<R>) {
    let place = app.state::<WidgetPlace>();
    let mut saved = load_saved(app);
    if let Some(bounds) = *place.bounds.lock().unwrap() {
        saved.widget = Some(bounds);
    }
    if let Some(desk) = *place.desk.lock().unwrap() {
        saved.desk = Some(desk);
    }
    if let Some(pinned) = *place.pinned.lock().unwrap() {
        saved.pinned = pinned;
    }
    let (Some(path), Ok(text)) = (file(app), serde_json::to_string(&saved)) else { return };
    if let Some(dir) = path.parent() {
        let _ = fs::create_dir_all(dir);
    }
    let _ = fs::write(path, text);
}

#[tauri::command]
pub fn window_full<R: Runtime>(window: WebviewWindow<R>) {
    remember(&window);
    persist(window.app_handle());
    *window.state::<WidgetPlace>().full.lock().unwrap() = true;
    let _ = window.set_skip_taskbar(false);
    let _ = window.maximize();
    let _ = window.set_focus();
}

#[tauri::command]
pub fn window_widget<R: Runtime>(window: WebviewWindow<R>) {
    to_widget(&window);
    let _ = window.set_focus();
}

#[tauri::command]
pub fn window_minimize<R: Runtime>(window: WebviewWindow<R>) {
    let _ = window.minimize();
}

/// Out of sight, still running: reminders keep firing from the tray.
#[tauri::command]
pub fn window_hide<R: Runtime>(window: WebviewWindow<R>) {
    remember(&window);
    persist(window.app_handle());
    let _ = window.hide();
}
