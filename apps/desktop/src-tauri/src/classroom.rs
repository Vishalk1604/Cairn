//! The folder where files from Google Classroom are saved.
//!
//! Teachers attach notes, slides and worksheets to their posts. The web view
//! downloads each one (it holds the Google token) and hands the bytes over
//! here, with the course folder and file name it should go under.
//!
//! The folder is the user's own, likely full of their own work, so nothing
//! here ever overwrites or deletes: a name already taken gets " (2)" and so
//! on, and a path can only ever point inside the folder.

use std::fs;
use std::path::{Path, PathBuf};

use tauri::ipc::{InvokeBody, Request};
use tauri::{AppHandle, Manager, Runtime};

use crate::media::header;

/// Names Windows keeps for devices, whatever the extension.
const RESERVED: &[&str] = &[
    "con", "prn", "aux", "nul", "com1", "com2", "com3", "com4", "com5", "com6", "com7", "com8", "com9", "lpt1", "lpt2",
    "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9",
];

/// One folder or file name: nothing that could climb out, name a drive, or
/// that Windows would refuse.
fn is_plain_name(name: &str) -> bool {
    let stem = name.split('.').next().unwrap_or("").to_ascii_lowercase();
    !name.is_empty()
        && name.len() <= 150
        && name != "."
        && name != ".."
        && !name.ends_with('.')
        && !name.ends_with(' ')
        && !name.chars().any(|c| c.is_control() || "<>:\"/\\|?*".contains(c))
        && !RESERVED.contains(&stem.as_str())
}

/// A course folder and a file name, joined with "/", as the web view sends them.
fn relative(path: &str) -> Result<Vec<&str>, String> {
    let parts: Vec<&str> = path.split('/').collect();
    if parts.is_empty() || parts.len() > 2 || !parts.iter().all(|p| is_plain_name(p)) {
        return Err(format!("Not a Classroom file path: {path}"));
    }
    Ok(parts)
}

/// "Notes.pdf" if it is free, else "Notes (2).pdf", "Notes (3).pdf" and so on.
fn free_name(dir: &Path, name: &str) -> Result<String, String> {
    if !dir.join(name).exists() {
        return Ok(name.to_string());
    }
    let (stem, extension) = match name.rsplit_once('.') {
        Some((stem, extension)) if !stem.is_empty() => (stem, format!(".{extension}")),
        _ => (name, String::new()),
    };
    (2..1000)
        .map(|n| format!("{stem} ({n}){extension}"))
        .find(|candidate| !dir.join(candidate).exists())
        .ok_or_else(|| format!("No free name left for {name}"))
}

/// Documents\Cairn Classroom, where people look for files first.
#[tauri::command]
pub fn classroom_default_dir<R: Runtime>(app: AppHandle<R>) -> Result<String, String> {
    let base = match app.path().document_dir() {
        Ok(documents) => documents,
        Err(_) => app.path().app_data_dir().map_err(|e| format!("No folder to save in: {e}"))?,
    };
    Ok(base.join("Cairn Classroom").to_string_lossy().into_owned())
}

/// The body is the file; the folder and the path inside it come as headers.
/// Returns the path it was saved under, which may have gained a number.
#[tauri::command]
pub fn classroom_write(request: Request<'_>) -> Result<String, String> {
    let root = PathBuf::from(header(&request, "x-dir")?);
    if !root.is_absolute() {
        return Err(format!("Not a full folder path: {}", root.display()));
    }
    let path = header(&request, "x-path")?;
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("Expected the file's bytes".into());
    };
    let parts = relative(&path)?;
    let (name, folders) = parts.split_last().ok_or("No file name")?;
    let dir = folders.iter().fold(root, |dir, part| dir.join(part));
    fs::create_dir_all(&dir).map_err(|e| format!("Could not create {}: {e}", dir.display()))?;
    let name = free_name(&dir, name)?;
    let target = dir.join(&name);
    // Written beside the target and renamed into place, so a crash halfway
    // never leaves half a PDF where a whole one is expected.
    let partial = dir.join(format!("{name}.part"));
    fs::write(&partial, bytes).map_err(|e| format!("Could not save {name}: {e}"))?;
    fs::rename(&partial, &target).map_err(|e| format!("Could not save {name}: {e}"))?;
    let mut saved: Vec<&str> = folders.to_vec();
    saved.push(&name);
    Ok(saved.join("/"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_plain_paths_inside_the_folder() {
        assert!(relative("CS301 DBMS/Lab 5.pdf").is_ok());
        assert!(relative("Lab 5.pdf").is_ok());
        assert!(relative("../Lab 5.pdf").is_err());
        assert!(relative("CS301/../../x.pdf").is_err());
        assert!(relative("C:/x.pdf").is_err());
        assert!(relative("a/b/c.pdf").is_err());
        assert!(relative("CON/x.pdf").is_err());
        assert!(relative("Course/nul.txt").is_err());
        assert!(relative("Course/x.pdf.").is_err());
        assert!(relative("").is_err());
    }

    #[test]
    fn never_overwrites() {
        let dir = std::env::temp_dir().join(format!("cairn-classroom-test-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        assert_eq!(free_name(&dir, "Notes.pdf").unwrap(), "Notes.pdf");
        fs::write(dir.join("Notes.pdf"), b"x").unwrap();
        assert_eq!(free_name(&dir, "Notes.pdf").unwrap(), "Notes (2).pdf");
        fs::write(dir.join("Notes (2).pdf"), b"x").unwrap();
        assert_eq!(free_name(&dir, "Notes.pdf").unwrap(), "Notes (3).pdf");
        fs::write(dir.join("README"), b"x").unwrap();
        assert_eq!(free_name(&dir, "README").unwrap(), "README (2)");
        fs::remove_dir_all(&dir).unwrap();
    }
}
