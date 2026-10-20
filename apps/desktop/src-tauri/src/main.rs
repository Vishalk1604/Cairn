// Release builds are GUI-only; without this Windows opens a console window too.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod focus;
mod icon;
mod tray;
mod urgency;

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

/// Raises the window and asks it to focus the capture box.
fn quick_capture<R: Runtime>(app: &AppHandle<R>) {
    show_main_window(app);
    let _ = app.emit(QUICK_CAPTURE_EVENT, ());
}

#[tauri::command]
fn show_window<R: Runtime>(app: AppHandle<R>) {
    show_main_window(&app);
}

fn main() {
    tauri::Builder::default()
        // Must be first: a second launch should surface the running window.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_main_window(app);
        }))
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
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
        .invoke_handler(tauri::generate_handler![show_window, tray::set_tray_state])
        .setup(|app| {
            tray::create(app.handle())?;
            if let Err(error) = app.global_shortcut().register(quick_capture_shortcut()) {
                // Another app owns the combination; the tray menu still works.
                eprintln!("Could not claim Ctrl+Shift+Space: {error}");
            }
            // The window starts hidden so a login launch never flashes on screen.
            if !std::env::args().any(|arg| arg == AUTOSTART_FLAG) {
                show_main_window(app.handle());
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                // Closing hides to the tray; Quit in the tray menu really exits,
                // so reminders keep firing while the window is out of the way.
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .run(tauri::generate_context!())
        .expect("Cairn failed to start");
}
