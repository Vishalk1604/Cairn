//! The browser half of signing in with Google.
//!
//! Google will not redirect back into a desktop app, so the app listens on a
//! loopback port and hands Google that address. Sign-in happens in the real
//! browser, where the user can see the address bar and any passwords already
//! saved — which is both safer and far less alarming than a window inside the
//! app asking for a Google password.

use std::io::{BufRead, BufReader, Write};
use std::net::{Ipv4Addr, SocketAddr, TcpListener, TcpStream};
use std::sync::Mutex;
use std::time::{Duration, Instant};

/// Long enough to find a password and pick an account, short enough that a
/// forgotten window does not hold the port forever.
const WAIT_LIMIT: Duration = Duration::from_secs(300);

#[derive(Default)]
pub struct Listener(Mutex<Option<TcpListener>>);

/// Opens a loopback port and reports it, so the caller can build a redirect
/// URI that points back here.
#[tauri::command]
pub fn oauth_listen(listener: tauri::State<'_, Listener>) -> Result<u16, String> {
    // Port 0 asks the OS for a free one; loopback only, so nothing off this
    // machine can reach it.
    let socket = TcpListener::bind(SocketAddr::from((Ipv4Addr::LOCALHOST, 0)))
        .map_err(|e| format!("Could not open a local port for sign-in: {e}"))?;
    socket
        .set_nonblocking(true)
        .map_err(|e| format!("Could not prepare the local port: {e}"))?;
    let port = socket.local_addr().map_err(|e| e.to_string())?.port();
    *listener.0.lock().map_err(|_| "sign-in state is poisoned")? = Some(socket);
    Ok(port)
}

/// Opens the sign-in page in the browser and waits for Google to redirect
/// back, returning the full redirect URL for the caller to verify.
#[tauri::command]
pub async fn oauth_await(listener: tauri::State<'_, Listener>, authorize_url: String) -> Result<String, String> {
    let socket = listener
        .0
        .lock()
        .map_err(|_| "sign-in state is poisoned")?
        .take()
        .ok_or("Sign-in was not started")?;

    open::that_detached(&authorize_url).map_err(|e| format!("Could not open your browser: {e}"))?;

    let deadline = Instant::now() + WAIT_LIMIT;
    loop {
        match socket.accept() {
            Ok((stream, _)) => return handle(stream),
            Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                if Instant::now() >= deadline {
                    return Err("Sign-in timed out. Try again when you are ready.".into());
                }
                std::thread::sleep(Duration::from_millis(120));
            }
            Err(e) => return Err(format!("Sign-in could not be completed: {e}")),
        }
    }
}

/// Stops listening, for when the user backs out.
#[tauri::command]
pub fn oauth_cancel(listener: tauri::State<'_, Listener>) -> Result<(), String> {
    *listener.0.lock().map_err(|_| "sign-in state is poisoned")? = None;
    Ok(())
}

fn handle(mut stream: TcpStream) -> Result<String, String> {
    stream
        .set_read_timeout(Some(Duration::from_secs(10)))
        .map_err(|e| e.to_string())?;

    let mut request = String::new();
    BufReader::new(&stream)
        .read_line(&mut request)
        .map_err(|e| format!("Could not read the sign-in response: {e}"))?;

    // "GET /?code=...&state=... HTTP/1.1"
    let target = request.split_whitespace().nth(1).unwrap_or("/").to_string();

    let body = if target.contains("error=") {
        page("Sign-in was cancelled", "Nothing has changed. You can close this tab.")
    } else {
        page("Signed in", "Cairn has what it needs. You can close this tab.")
    };
    let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        body.len(),
        body
    );
    let _ = stream.write_all(response.as_bytes());
    let _ = stream.flush();

    // The caller only needs the query, but it parses a whole URL.
    Ok(format!("http://127.0.0.1{target}"))
}

fn page(heading: &str, detail: &str) -> String {
    format!(
        "<!doctype html><meta charset=\"utf-8\"><title>Cairn</title>\
         <body style=\"font-family:system-ui,sans-serif;background:#1b1b1b;color:#ececec;\
         display:grid;place-items:center;height:100vh;margin:0\">\
         <main style=\"text-align:center\"><h1 style=\"font-weight:600\">{heading}</h1><p>{detail}</p></main>"
    )
}
