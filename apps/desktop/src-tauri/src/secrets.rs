//! Storage for refresh tokens.
//!
//! A refresh token is a long-lived key to the user's mail, so it is encrypted
//! with DPAPI before it touches the disk: Windows ties the ciphertext to this
//! user account, and another account on the same machine cannot read it even
//! with the file in hand. Plain files under the app data directory would be
//! readable by anything running as the user, which is a poor home for a token
//! that does not expire.

use std::fs;
use std::path::PathBuf;

use tauri::{AppHandle, Manager, Runtime};

fn secrets_dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("No app data directory: {e}"))?
        .join("secrets");
    fs::create_dir_all(&dir).map_err(|e| format!("Could not create {}: {e}", dir.display()))?;
    Ok(dir)
}

/// Keys come from the app, so they are restricted to a safe shape rather than
/// trusted to stay inside the directory.
fn path_for<R: Runtime>(app: &AppHandle<R>, key: &str) -> Result<PathBuf, String> {
    if key.is_empty() || !key.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.') {
        return Err(format!("Unusable secret name: {key}"));
    }
    Ok(secrets_dir(app)?.join(format!("{key}.bin")))
}

#[tauri::command]
pub fn secret_set<R: Runtime>(app: AppHandle<R>, key: String, value: String) -> Result<(), String> {
    let path = path_for(&app, &key)?;
    let sealed = seal(value.as_bytes())?;
    fs::write(&path, sealed).map_err(|e| format!("Could not save {key}: {e}"))
}

#[tauri::command]
pub fn secret_get<R: Runtime>(app: AppHandle<R>, key: String) -> Result<Option<String>, String> {
    let path = path_for(&app, &key)?;
    let Ok(sealed) = fs::read(&path) else { return Ok(None) };
    match unseal(&sealed) {
        Ok(bytes) => Ok(Some(String::from_utf8_lossy(&bytes).into_owned())),
        Err(error) => {
            // Unreadable usually means it was written by a different Windows
            // account or a restored profile. Drop it and ask to sign in again
            // rather than failing every launch from here on.
            let _ = fs::remove_file(&path);
            eprintln!("Discarded unreadable secret {key}: {error}");
            Ok(None)
        }
    }
}

#[tauri::command]
pub fn secret_delete<R: Runtime>(app: AppHandle<R>, key: String) -> Result<(), String> {
    let path = path_for(&app, &key)?;
    match fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("Could not remove {key}: {e}")),
    }
}

#[cfg(windows)]
fn seal(plain: &[u8]) -> Result<Vec<u8>, String> {
    use windows_sys::Win32::Security::Cryptography::{CryptProtectData, CRYPT_INTEGER_BLOB};

    let mut input = CRYPT_INTEGER_BLOB { cbData: plain.len() as u32, pbData: plain.as_ptr() as *mut u8 };
    let mut output = CRYPT_INTEGER_BLOB { cbData: 0, pbData: std::ptr::null_mut() };
    let ok = unsafe {
        CryptProtectData(
            &mut input,
            std::ptr::null(),
            std::ptr::null(),
            std::ptr::null(),
            std::ptr::null(),
            0,
            &mut output,
        )
    };
    if ok == 0 {
        return Err("Windows refused to encrypt the value".into());
    }
    Ok(take_blob(output))
}

#[cfg(windows)]
fn unseal(sealed: &[u8]) -> Result<Vec<u8>, String> {
    use windows_sys::Win32::Security::Cryptography::{CryptUnprotectData, CRYPT_INTEGER_BLOB};

    let mut input = CRYPT_INTEGER_BLOB { cbData: sealed.len() as u32, pbData: sealed.as_ptr() as *mut u8 };
    let mut output = CRYPT_INTEGER_BLOB { cbData: 0, pbData: std::ptr::null_mut() };
    let ok = unsafe {
        CryptUnprotectData(
            &mut input,
            std::ptr::null_mut(),
            std::ptr::null(),
            std::ptr::null(),
            std::ptr::null(),
            0,
            &mut output,
        )
    };
    if ok == 0 {
        return Err("Windows could not decrypt the value".into());
    }
    Ok(take_blob(output))
}

/// Copies a blob Windows allocated, then frees it.
#[cfg(windows)]
fn take_blob(blob: windows_sys::Win32::Security::Cryptography::CRYPT_INTEGER_BLOB) -> Vec<u8> {
    use windows_sys::Win32::Foundation::LocalFree;

    let bytes = unsafe { std::slice::from_raw_parts(blob.pbData, blob.cbData as usize) }.to_vec();
    unsafe { LocalFree(blob.pbData as *mut core::ffi::c_void) };
    bytes
}

#[cfg(not(windows))]
fn seal(plain: &[u8]) -> Result<Vec<u8>, String> {
    Ok(plain.to_vec())
}

#[cfg(not(windows))]
fn unseal(sealed: &[u8]) -> Result<Vec<u8>, String> {
    Ok(sealed.to_vec())
}

#[cfg(all(test, windows))]
mod tests {
    use super::{seal, unseal};

    #[test]
    fn a_sealed_value_comes_back_intact() {
        let secret = b"1//0gRefreshTokenLookingThing-with_symbols.and.dots";
        let sealed = seal(secret).expect("seal");
        assert_ne!(sealed.as_slice(), secret.as_slice(), "the token was written in the clear");
        assert_eq!(unseal(&sealed).expect("unseal"), secret);
    }

    #[test]
    fn tampering_is_rejected_rather_than_returning_rubbish() {
        let mut sealed = seal(b"token").expect("seal");
        let last = sealed.len() - 1;
        sealed[last] ^= 0xff;
        assert!(unseal(&sealed).is_err());
    }

    #[test]
    fn an_empty_value_round_trips() {
        assert_eq!(unseal(&seal(b"").expect("seal")).expect("unseal"), b"");
    }
}
