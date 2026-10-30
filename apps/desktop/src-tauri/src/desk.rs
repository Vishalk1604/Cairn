//! The third shape: Today pinned to the desktop.
//!
//! A second, small window that sits on the wallpaper, behind everything
//! else, out of the taskbar. It shows what the main window sends it (see
//! `desk.ts`), so there is still only one copy of the data, and asks the
//! main window to complete a task or open the full app.
//!
//! On Windows it is parented to the shell window that holds the desktop
//! icons, so it is part of the desktop itself: Win+D and "show desktop"
//! leave it in place, and it stays clickable above the icons. If that window
//! cannot be found (a different shell, a future Windows) it stays an
//! ordinary window kept at the bottom of the stack, which Win+D hides.

use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalSize, Runtime, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

use crate::window_mode::{self, Bounds};

pub const DESK_LABEL: &str = "desk";

/// In logical pixels: a column of tasks beside the desktop icons.
const DESK_WIDTH: f64 = 320.0;
const DESK_HEIGHT: f64 = 400.0;
const MARGIN: f64 = 24.0;

/// Top right of the main screen the first time, clear of the icons, which Windows lines up on the left.
fn first_place<R: Runtime>(app: &AppHandle<R>) -> Option<Bounds> {
    let window = app.get_webview_window("main")?;
    let monitor = window.primary_monitor().ok().flatten()?;
    let scale = monitor.scale_factor();
    let area = monitor.work_area();
    let margin = (MARGIN * scale) as i32;
    let width = (DESK_WIDTH * scale) as u32;
    let height = (DESK_HEIGHT * scale) as u32;
    Some(Bounds { x: area.position.x + area.size.width as i32 - width as i32 - margin, y: area.position.y + margin, width, height })
}

/// Opens the pinned widget, where it was last left.
pub fn open<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    if app.get_webview_window(DESK_LABEL).is_some() {
        return Ok(());
    }
    let place = window_mode::saved_desk(app).or_else(|| first_place(app));
    let window = WebviewWindowBuilder::new(app, DESK_LABEL, WebviewUrl::App("index.html".into()))
        .title("Cairn on the desktop")
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .skip_taskbar(true)
        .always_on_bottom(true)
        .resizable(true)
        .focused(false)
        .visible(false)
        .min_inner_size(240.0, 180.0)
        .build()?;
    if let Some(b) = place {
        let _ = window.set_size(PhysicalSize::new(b.width, b.height));
        let _ = window.set_position(PhysicalPosition::new(b.x, b.y));
    }
    // Shown first: showing re-applies the window's own styles, which would
    // take away the child style the desktop needs if it came after.
    window.show()?;
    onto_desktop(&window);
    Ok(())
}

pub fn close<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window(DESK_LABEL) {
        window_mode::remember_desk(&window);
        window_mode::persist(app);
        let _ = window.destroy();
    }
}

/// Settings → This computer → Pin to desktop. Async, because building a
/// window from a synchronous command deadlocks on Windows: the window was
/// made but never placed or shown.
#[tauri::command]
pub async fn desk_pin<R: Runtime>(app: AppHandle<R>, enabled: bool) -> Result<bool, String> {
    window_mode::set_pinned(&app, enabled);
    if enabled {
        open(&app).map_err(|e| format!("Could not pin Cairn to the desktop: {e}"))?;
    } else {
        close(&app);
    }
    Ok(enabled)
}

#[tauri::command]
pub fn desk_pinned<R: Runtime>(app: AppHandle<R>) -> bool {
    window_mode::pinned(&app)
}

#[cfg(not(windows))]
fn onto_desktop<R: Runtime>(_window: &WebviewWindow<R>) {}

/// Makes the window a child of the desktop's icon layer, keeping it where it is on screen.
#[cfg(windows)]
fn onto_desktop<R: Runtime>(window: &WebviewWindow<R>) {
    use windows_sys::Win32::Foundation::{HWND, POINT, RECT};
    use windows_sys::Win32::Graphics::Gdi::ScreenToClient;
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetWindowLongPtrW, GetWindowRect, SetParent, SetWindowLongPtrW, SetWindowPos, GWL_STYLE, HWND_TOP, SWP_FRAMECHANGED,
        SWP_NOACTIVATE, WS_CHILD, WS_POPUP,
    };

    let Ok(handle) = window.hwnd() else { return };
    let ours = handle.0 as HWND;
    let Some(host) = desktop_host() else {
        eprintln!("The desktop's icon layer was not found; Cairn stays at the bottom of the window stack instead.");
        return;
    };
    unsafe {
        let mut rect: RECT = std::mem::zeroed();
        if GetWindowRect(ours, &mut rect) == 0 {
            return;
        }
        let style = GetWindowLongPtrW(ours, GWL_STYLE);
        SetWindowLongPtrW(ours, GWL_STYLE, (style & !(WS_POPUP as isize)) | WS_CHILD as isize);
        if SetParent(ours, host).is_null() {
            // Refused: put the style back and stay a window at the bottom.
            SetWindowLongPtrW(ours, GWL_STYLE, style);
            eprintln!("Windows would not put Cairn on the desktop; it stays at the bottom of the window stack instead.");
            return;
        }
        // A child is placed in its parent's coordinates, which start where the
        // virtual screen does, not at the main screen's corner.
        let mut corner = POINT { x: rect.left, y: rect.top };
        ScreenToClient(host, &mut corner);
        SetWindowPos(ours, HWND_TOP, corner.x, corner.y, rect.right - rect.left, rect.bottom - rect.top, SWP_NOACTIVATE | SWP_FRAMECHANGED);
    }
}

/// The window that holds the desktop icons (SHELLDLL_DefView): Progman, or
/// the WorkerW Explorer splits off once asked to with message 0x052C, which
/// is what wallpaper tools use to reach this layer.
#[cfg(windows)]
fn desktop_host() -> Option<windows_sys::Win32::Foundation::HWND> {
    use windows_sys::Win32::Foundation::{HWND, LPARAM};
    use windows_sys::Win32::UI::WindowsAndMessaging::{EnumWindows, FindWindowExW, FindWindowW, SendMessageTimeoutW, SMTO_NORMAL};

    fn wide(text: &str) -> Vec<u16> {
        text.encode_utf16().chain(std::iter::once(0)).collect()
    }

    unsafe extern "system" fn find(top: HWND, found: LPARAM) -> i32 {
        let view = wide("SHELLDLL_DefView");
        if !FindWindowExW(top, std::ptr::null_mut(), view.as_ptr(), std::ptr::null()).is_null() {
            *(found as *mut HWND) = top;
            return 0;
        }
        1
    }

    unsafe {
        let progman = FindWindowW(wide("Progman").as_ptr(), std::ptr::null());
        if progman.is_null() {
            return None;
        }
        let mut result = 0usize;
        SendMessageTimeoutW(progman, 0x052C, 0, 0, SMTO_NORMAL, 1000, &mut result);
        let mut host: HWND = std::ptr::null_mut();
        EnumWindows(Some(find), &mut host as *mut HWND as LPARAM);
        (!host.is_null()).then_some(host)
    }
}
