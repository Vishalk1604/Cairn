//! Taking the foreground on Windows.
//!
//! Windows refuses `SetForegroundWindow` from a process that did not just
//! receive input, so a window raised from a hotkey can end up visible but
//! behind the app the user was in, with the caret still over there.
//! Attaching the foreground window's input queue to our own window's thread
//! lifts that restriction for as long as they share a queue, which is what
//! launcher-style apps do.

#[cfg(not(windows))]
pub fn force_foreground<R: tauri::Runtime>(_window: &tauri::WebviewWindow<R>) {}

#[cfg(windows)]
pub fn force_foreground<R: tauri::Runtime>(window: &tauri::WebviewWindow<R>) {
    use windows_sys::Win32::Foundation::HWND;
    use windows_sys::Win32::System::Threading::AttachThreadInput;
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{SetActiveWindow, SetFocus};
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetForegroundWindow, GetWindowThreadProcessId, SetForegroundWindow,
    };

    let Ok(handle) = window.hwnd() else { return };
    let target = handle.0 as HWND;

    unsafe {
        let foreground = GetForegroundWindow();
        if foreground == target {
            return;
        }
        // The threads that matter are the one owning the window we want to
        // raise and the one owning the window currently in front, not whichever
        // thread happens to be handling the hotkey.
        let ours = GetWindowThreadProcessId(target, std::ptr::null_mut());
        let theirs = GetWindowThreadProcessId(foreground, std::ptr::null_mut());
        let attached = theirs != 0 && ours != 0 && theirs != ours && AttachThreadInput(theirs, ours, 1) != 0;

        SetForegroundWindow(target);
        SetActiveWindow(target);
        SetFocus(target);

        if attached {
            AttachThreadInput(theirs, ours, 0);
        }
    }
}
