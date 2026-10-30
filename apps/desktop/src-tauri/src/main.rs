// Release builds are GUI-only; without this Windows opens a console window too.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod classroom;
mod desk;
mod focus;
mod icon;
mod media;
mod oauth;
mod secrets;
mod tray;
mod urgency;
mod window_mode;

use tauri::{AppHandle, Emitter, Manager, Runtime, WindowEvent};
use tauri_plugin_autostart::MacosLauncher;
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

/// Passed by the autostart entry so a login launch goes straight to the tray.
const AUTOSTART_FLAG: &str = "--autostart";

/// Tells the window to put the caret in the capture box.
pub const QUICK_CAPTURE_EVENT: &str = "cairn://quick-capture";

fn quick_capture_shortcut() -> Shortcut {
    Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::Space)
}

pub fn show_main_window<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
        focus::force_foreground(&window);
    }
}

/// The tray icon's click: shows Cairn, or minimizes it to its taskbar button
/// again if it was in front. Buried under other windows, it is brought
/// forward instead. It keeps its taskbar button in both shapes, so Alt+Tab,
/// Snap and tiling tools treat it like any other window.
pub fn toggle_main_window<R: Runtime>(app: &AppHandle<R>) {
    let Some(window) = app.get_webview_window("main") else { return };
    let showing = window.is_visible().unwrap_or(false) && !window.is_minimized().unwrap_or(false);
    if showing && window_mode::was_in_front(&window) {
        window_mode::remember(&window);
        window_mode::persist(app);
        let _ = window.minimize();
    } else {
        show_main_window(app);
    }
}

/// Raises the window and asks it to focus the capture box.
fn quick_capture<R: Runtime>(app: &AppHandle<R>) {
    show_main_window(app);
    let _ = app.emit(QUICK_CAPTURE_EVENT, ());
}

#[tauri::command]
fn show_window<R: Runtime>(app: AppHandle<R>) {
    show_main_window(&app);
}

/// Opens a web page in the default browser. Only web addresses: anything
/// else handed to the shell could run a program.
#[tauri::command]
fn open_link(url: String) -> Result<(), String> {
    if !url.starts_with("https://") {
        return Err(format!("Not a web address: {url}"));
    }
    open::that(&url).map_err(|e| format!("Could not open {url}: {e}"))
}

fn main() {
    tauri::Builder::default()
        // Must be first: a second launch should surface the running window.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_main_window(app);
        }))
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        // Checks the latest GitHub release's latest.json, signed with the release key (docs/release.md).
        .plugin(tauri_plugin_updater::Builder::new().build())
        // The hotkey is handled here rather than in the web view: Windows only
        // lets a process take the foreground in the moment it receives the
        // hotkey, and a round trip through JavaScript arrives too late, leaving
        // the window raised but unfocused.
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    if event.state() == ShortcutState::Pressed && shortcut == &quick_capture_shortcut() {
                        quick_capture(app);
                    }
                })
                .build(),
        )
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec![AUTOSTART_FLAG]),
        ))
        .manage(oauth::Listener::default())
        .manage(window_mode::WidgetPlace::default())
        .invoke_handler(tauri::generate_handler![
            show_window,
            open_link,
            tray::set_tray_state,
            tray::autostart_enabled,
            tray::set_autostart,
            window_mode::window_full,
            window_mode::window_widget,
            window_mode::window_minimize,
            window_mode::window_hide,
            oauth::oauth_listen,
            oauth::oauth_await,
            oauth::oauth_cancel,
            secrets::secret_set,
            secrets::secret_get,
            secrets::secret_delete,
            media::media_default_dir,
            media::media_list,
            media::media_write,
            media::media_read,
            media::media_remove,
            media::media_move,
            media::media_open,
            classroom::classroom_default_dir,
            classroom::classroom_write,
            desk::desk_pin,
            desk::desk_pinned,
        ])
        .setup(|app| {
            tray::create(app.handle())?;
            if let Err(error) = app.global_shortcut().register(quick_capture_shortcut()) {
                // Another app owns the combination; the tray menu still works.
                eprintln!("Could not claim Ctrl+Shift+Space: {error}");
            }
            // Placed before it is ever shown, so it never jumps into position.
            if let Some(window) = app.get_webview_window("main") {
                window_mode::to_widget(&window);
            }
            // The window starts hidden so a login launch never flashes on screen.
            if !std::env::args().any(|arg| arg == AUTOSTART_FLAG) {
                show_main_window(app.handle());
            }
            // Pinned to the desktop: there from the start, login launches included.
            if window_mode::pinned(app.handle()) {
                if let Err(error) = desk::open(app.handle()) {
                    eprintln!("Could not pin Cairn to the desktop: {error}");
                }
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            let Some(webview) = window.app_handle().get_webview_window(window.label()) else { return };
            if window.label() == desk::DESK_LABEL {
                match event {
                    WindowEvent::Moved(_) | WindowEvent::Resized(_) => window_mode::remember_desk(&webview),
                    WindowEvent::Focused(false) => window_mode::persist(window.app_handle()),
                    // Alt+F4 on the desktop: it stays; unpinning is in Settings.
                    WindowEvent::CloseRequested { api, .. } => api.prevent_close(),
                    _ => {}
                }
                return;
            }
            match event {
                WindowEvent::Moved(_) | WindowEvent::Resized(_) => window_mode::remember(&webview),
                WindowEvent::Focused(focused) => {
                    window_mode::focus_changed(&webview, *focused);
                    if !focused {
                        window_mode::persist(window.app_handle());
                    }
                }
                WindowEvent::CloseRequested { api, .. } => {
                    // Closing hides to the tray; Quit in the tray menu really
                    // exits, so reminders keep firing while it is out of the way.
                    api.prevent_close();
                    window_mode::remember(&webview);
                    window_mode::persist(window.app_handle());
                    let _ = window.hide();
                }
                _ => {}
            }
        })
        .run(tauri::generate_context!())
        .expect("Cairn failed to start");
}
