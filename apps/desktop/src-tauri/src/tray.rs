//! Tray icon: shows the most urgent reminder at a glance and keeps Cairn
//! reachable while the window is closed.

use tauri::{
    menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Runtime,
};
use tauri_plugin_autostart::ManagerExt;

use crate::{icon, urgency};

pub const TRAY_ID: &str = "cairn";

pub fn create<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Open Cairn", true, None::<&str>)?;
    let capture = MenuItem::with_id(app, "capture", "Quick capture\tCtrl+Shift+Space", true, None::<&str>)?;
    let autostart = CheckMenuItem::with_id(
        app,
        "autostart",
        "Start with Windows",
        true,
        app.autolaunch().is_enabled().unwrap_or(false),
        None::<&str>,
    )?;
    let quit = MenuItem::with_id(app, "quit", "Quit Cairn", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[
            &open,
            &capture,
            &PredefinedMenuItem::separator(app)?,
            &autostart,
            &PredefinedMenuItem::separator(app)?,
            &quit,
        ],
    )?;

    let toggle = autostart.clone();
    TrayIconBuilder::with_id(TRAY_ID)
        .icon(icon::tray_icon(urgency::IDLE))
        .tooltip("Cairn")
        .menu(&menu)
        // Left click opens the window; the menu belongs on right click.
        .show_menu_on_left_click(false)
        .on_menu_event(move |app, event| match event.id().as_ref() {
            "open" => crate::show_main_window(app),
            "capture" => {
                crate::show_main_window(app);
                let _ = app.emit(crate::QUICK_CAPTURE_EVENT, ());
            }
            "autostart" => {
                let launcher = app.autolaunch();
                let enabled = launcher.is_enabled().unwrap_or(false);
                let result = if enabled { launcher.disable() } else { launcher.enable() };
                if let Err(error) = result {
                    eprintln!("Could not change the start-with-Windows setting: {error}");
                }
                // Reflect what actually happened, not what was asked for.
                let _ = toggle.set_checked(launcher.is_enabled().unwrap_or(false));
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                crate::show_main_window(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}

/// Recolours the tray icon and updates its tooltip. `level` is an urgency
/// level from the shared scale, or none when nothing is pending.
#[tauri::command]
pub fn set_tray_state<R: Runtime>(app: AppHandle<R>, level: Option<String>, tooltip: String) -> Result<(), String> {
    let Some(tray) = app.tray_by_id(TRAY_ID) else { return Ok(()) };
    let color = level.as_deref().map_or(urgency::IDLE, urgency::color_for);
    tray.set_icon(Some(icon::tray_icon(color))).map_err(|e| e.to_string())?;
    tray.set_tooltip(Some(&tooltip)).map_err(|e| e.to_string())?;
    Ok(())
}
