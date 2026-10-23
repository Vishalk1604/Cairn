//! The folder where photos and recordings from the phone are kept.
//!
//! A note's media lives in the owner's Google Drive. To show it, the desktop
//! needs a copy on disk, in a folder the user can choose. The web view
//! downloads each file (it holds the Google token) and hands the bytes over
//! here. It also asks for files back to show them, and asks for any that no
//! note uses any more to be removed.
//!
//! The folder may be one the user also keeps other files in, so these
//! commands only ever touch files named the way Cairn names them: an
//! attachment id and a known extension.

use std::fs;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::ipc::{InvokeBody, Request, Response};
use tauri::{AppHandle, Manager, Runtime};

/// Matches the extensions the phone gives its files.
const EXTENSIONS: &[&str] = &["jpg", "png", "webp", "heic", "gif", "m4a", "aac", "bin"];

/// An attachment id (a UUID) and one of the extensions above, nothing else.
fn is_media_name(name: &str) -> bool {
    let Some((stem, extension)) = name.rsplit_once('.') else {
        return false;
    };
    (8..=64).contains(&stem.len())
        && stem.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
        && EXTENSIONS.contains(&extension)
}

fn folder(dir: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(dir);
    if !path.is_absolute() {
        return Err(format!("Not a full folder path: {dir}"));
    }
    Ok(path)
}

fn file_in(dir: &str, name: &str) -> Result<PathBuf, String> {
    if !is_media_name(name) {
        return Err(format!("Not a Cairn media file: {name}"));
    }
    Ok(folder(dir)?.join(name))
}

/// Header values travel as ASCII, so the web view percent-encodes them.
fn decode(value: &str) -> Result<String, String> {
    let bytes = value.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).map_err(|e| e.to_string())?;
            out.push(u8::from_str_radix(hex, 16).map_err(|_| format!("Bad escape in {value}"))?);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8(out).map_err(|e| e.to_string())
}

fn header(request: &Request<'_>, name: &str) -> Result<String, String> {
    let value = request
        .headers()
        .get(name)
        .ok_or_else(|| format!("Missing {name}"))?
        .to_str()
        .map_err(|e| e.to_string())?;
    decode(value)
}

#[derive(Serialize)]
pub struct MediaFile {
    name: String,
    bytes: u64,
}

/// Where media goes until the user picks somewhere else: beside Cairn's own data.
#[tauri::command]
pub fn media_default_dir<R: Runtime>(app: AppHandle<R>) -> Result<String, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("No app data directory: {e}"))?
        .join("Media");
    Ok(dir.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn media_list(dir: String) -> Result<Vec<MediaFile>, String> {
    let entries = match fs::read_dir(folder(&dir)?) {
        Ok(entries) => entries,
        // Nothing downloaded yet.
        Err(e) if e.kind() == ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(format!("Could not read {dir}: {e}")),
    };
    let mut files = Vec::new();
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        let Ok(meta) = entry.metadata() else { continue };
        if meta.is_file() && is_media_name(&name) {
            files.push(MediaFile { name, bytes: meta.len() });
        }
    }
    Ok(files)
}

/// The body is the file itself; the folder and name come as headers.
#[tauri::command]
pub fn media_write(request: Request<'_>) -> Result<(), String> {
    let dir = header(&request, "x-dir")?;
    let name = header(&request, "x-name")?;
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("Expected the file's bytes".into());
    };
    let target = file_in(&dir, &name)?;
    fs::create_dir_all(folder(&dir)?).map_err(|e| format!("Could not create {dir}: {e}"))?;
    // Written beside the target and renamed into place, so a crash halfway
    // never leaves a broken photo where a whole one is expected.
    let partial = target.with_extension("part");
    fs::write(&partial, bytes).map_err(|e| format!("Could not save {name}: {e}"))?;
    fs::rename(&partial, &target).map_err(|e| format!("Could not save {name}: {e}"))
}

#[tauri::command]
pub fn media_read(dir: String, name: String) -> Result<Response, String> {
    let bytes = fs::read(file_in(&dir, &name)?).map_err(|e| format!("Could not open {name}: {e}"))?;
    Ok(Response::new(bytes))
}

#[tauri::command]
pub fn media_remove(dir: String, name: String) -> Result<(), String> {
    match fs::remove_file(file_in(&dir, &name)?) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("Could not remove {name}: {e}")),
    }
}

/// Moves every Cairn file from one folder to another, returning how many.
/// A rename fails across drives, so that case is a copy and a delete.
#[tauri::command]
pub fn media_move(from: String, to: String) -> Result<u32, String> {
    let source = folder(&from)?;
    let target = folder(&to)?;
    if source == target {
        return Ok(0);
    }
    fs::create_dir_all(&target).map_err(|e| format!("Could not create {to}: {e}"))?;
    let mut moved = 0;
    for file in media_list(from)? {
        let (old, new) = (source.join(&file.name), target.join(&file.name));
        if fs::rename(&old, &new).is_err() {
            copy_then_remove(&old, &new).map_err(|e| format!("Could not move {}: {e}", file.name))?;
        }
        moved += 1;
    }
    Ok(moved)
}

fn copy_then_remove(old: &Path, new: &Path) -> std::io::Result<()> {
    fs::copy(old, new)?;
    fs::remove_file(old)
}

#[tauri::command]
pub fn media_open(dir: String) -> Result<(), String> {
    let path = folder(&dir)?;
    fs::create_dir_all(&path).map_err(|e| format!("Could not create {dir}: {e}"))?;
    open::that(&path).map_err(|e| format!("Could not open {dir}: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_cairn_names_are_touched() {
        assert!(is_media_name("0199a000-0000-7000-8000-000000000001.jpg"));
        assert!(is_media_name("0199a000-0000-7000-8000-000000000001.m4a"));
        assert!(!is_media_name("holiday.jpg"));
        assert!(!is_media_name("../0199a000-0000-7000-8000-000000000001.jpg"));
        assert!(!is_media_name("0199a000-0000-7000-8000-000000000001.exe"));
        assert!(!is_media_name("0199a000-0000-7000-8000-000000000001"));
    }

    #[test]
    fn decodes_percent_escapes() {
        assert_eq!(decode("C%3A%5CUsers%5CV%C3%AEshal%5CMedia").unwrap(), "C:\\Users\\Vîshal\\Media");
        assert_eq!(decode("plain").unwrap(), "plain");
    }
}
