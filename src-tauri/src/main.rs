// src-tauri/src/main.rs
// =====================
// Pedimap 2.0 — Tauri 2 application entry point.
//
// Responsibilities:
//   1. Spawn the Python FastAPI backend as a sidecar on startup
//   2. Expose Tauri commands for native OS operations
//   3. Stop the sidecar cleanly when the app exits, and around update installs

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::ipc::{InvokeBody, Request};
use tauri::{AppHandle, Manager, RunEvent, State, WindowEvent};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_shell::process::CommandChild;
use tauri_plugin_shell::ShellExt;

// ─────────────────────────────────────────────────────────────────────────────
// Shared state — holds the child process handle for the Python sidecar
// ─────────────────────────────────────────────────────────────────────────────
struct BackendProcess(Mutex<Option<CommandChild>>);

/// Destinations the user picked in save_file_dialog during this session. The
/// write commands refuse every other path, so the webview can only write
/// where the user explicitly chose to save.
#[derive(Default)]
struct SaveGrants(Mutex<HashSet<PathBuf>>);

impl SaveGrants {
    fn grant(&self, path: &str) {
        self.0.lock().unwrap().insert(PathBuf::from(path));
    }

    /// Write `bytes` to `path` only if the save dialog returned that path.
    fn write(&self, path: &str, bytes: &[u8]) -> Result<(), String> {
        let path = PathBuf::from(path);
        if !self.0.lock().unwrap().contains(&path) {
            return Err(format!(
                "Refusing to write {}: it was not chosen in a save dialog",
                path.display()
            ));
        }
        std::fs::write(&path, bytes).map_err(|e| e.to_string())
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Tauri commands
// ─────────────────────────────────────────────────────────────────────────────

/// URL that the React frontend uses to reach the FastAPI backend.
#[tauri::command]
fn get_backend_url() -> String {
    "http://127.0.0.1:8765".to_string()
}

/// Open a native file-picker that allows several files, so a .dat can be
/// selected together with its .pmp. Returns the selected paths (empty if the
/// user cancelled).
#[tauri::command]
async fn open_file_dialog(app: AppHandle) -> Result<Vec<String>, String> {
    let paths = app
        .dialog()
        .file()
        .add_filter("Pedigree files (.dat, .pmp, .json)", &["dat", "pmp", "json"])
        .blocking_pick_files();
    Ok(paths
        .map(|ps| ps.into_iter().map(|p| p.to_string()).collect())
        .unwrap_or_default())
}

/// Save-dialog filters, grouped so that an image export offers only image
/// formats and a data export only data formats.
const SAVE_FILTERS: [(&str, &str, u8); 5] = [
    ("dat", "Pedimap Data", 0),
    ("json", "Pedigree JSON", 0),
    ("png", "PNG image", 1),
    ("svg", "SVG image", 1),
    ("pdf", "PDF document", 1),
];

/// Filters for a suggested file name: the one matching its extension first
/// (so it is preselected), then the rest of its group.
fn save_filters_for(name: &str) -> Vec<(&'static str, &'static str)> {
    let ext = name.rsplit('.').next().unwrap_or("").to_lowercase();
    let group = SAVE_FILTERS.iter().find(|f| f.0 == ext).map_or(0, |f| f.2);
    let mut filters: Vec<_> = SAVE_FILTERS.iter().filter(|f| f.2 == group).collect();
    filters.sort_by_key(|f| f.0 != ext);
    filters.into_iter().map(|f| (f.0, f.1)).collect()
}

/// Open a native save dialog suggesting `default_name` (default
/// "pedigree.json"). Returns the chosen destination path or "", and grants
/// that path to write_file / write_binary_file for the rest of the session.
#[tauri::command]
async fn save_file_dialog(
    app: AppHandle,
    grants: State<'_, SaveGrants>,
    default_name: Option<String>,
) -> Result<String, String> {
    let name = default_name.unwrap_or_else(|| "pedigree.json".to_string());
    let mut dialog = app.dialog().file();
    for (ext, label) in save_filters_for(&name) {
        dialog = dialog.add_filter(label, &[ext]);
    }
    let Some(path) = dialog.set_file_name(name).blocking_save_file() else {
        return Ok(String::new());
    };
    let path = path.to_string();
    grants.grant(&path);
    Ok(path)
}

/// A decoded text file and the encoding that was used ("utf-8" or
/// "windows-1252"), so the UI can say when a legacy file was converted.
#[derive(serde::Serialize)]
struct TextFile {
    text: String,
    encoding: &'static str,
}

/// Windows-1252 differs from Latin-1 only in 0x80-0x9F. The five bytes it
/// leaves undefined keep their own code point, so every byte is preserved.
const WINDOWS_1252_80_9F: [char; 32] = [
    '\u{20AC}', '\u{0081}', '\u{201A}', '\u{0192}', '\u{201E}', '\u{2026}', '\u{2020}', '\u{2021}',
    '\u{02C6}', '\u{2030}', '\u{0160}', '\u{2039}', '\u{0152}', '\u{008D}', '\u{017D}', '\u{008F}',
    '\u{0090}', '\u{2018}', '\u{2019}', '\u{201C}', '\u{201D}', '\u{2022}', '\u{2013}', '\u{2014}',
    '\u{02DC}', '\u{2122}', '\u{0161}', '\u{203A}', '\u{0153}', '\u{009D}', '\u{017E}', '\u{0178}',
];

/// Strip a UTF-8 BOM, try strict UTF-8, otherwise decode as Windows-1252 —
/// legacy Pedimap 1.x files come from Windows. Same rules as the backend's
/// text_decoding.py; keep them in step.
fn decode_text(bytes: &[u8]) -> TextFile {
    let bytes = bytes.strip_prefix(b"\xEF\xBB\xBF").unwrap_or(bytes);
    match std::str::from_utf8(bytes) {
        Ok(text) => TextFile { text: text.to_owned(), encoding: "utf-8" },
        Err(_) => TextFile {
            text: bytes
                .iter()
                .map(|&b| match b {
                    0x80..=0x9F => WINDOWS_1252_80_9F[(b - 0x80) as usize],
                    _ => b as char, // ASCII and 0xA0-0xFF match Latin-1
                })
                .collect(),
            encoding: "windows-1252",
        },
    }
}

/// Read a text file from disk (see decode_text for the encoding rules).
#[tauri::command]
fn read_file(path: String) -> Result<TextFile, String> {
    let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
    Ok(decode_text(&bytes))
}

/// Write UTF-8 content to a path returned by save_file_dialog.
#[tauri::command]
fn write_file(grants: State<'_, SaveGrants>, path: String, content: String) -> Result<(), String> {
    grants.write(&path, content.as_bytes())
}

/// Write binary content (PNG, PDF) to a path returned by save_file_dialog.
/// The bytes are the raw request body, so they are not JSON-encoded; the path
/// travels percent-encoded in the `x-path` header (headers must be ASCII).
#[tauri::command]
fn write_binary_file(grants: State<'_, SaveGrants>, request: Request<'_>) -> Result<(), String> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("write_binary_file expects raw bytes".to_string());
    };
    let path = request
        .headers()
        .get("x-path")
        .and_then(|v| v.to_str().ok())
        .ok_or("write_binary_file needs an x-path header")?;
    grants.write(&percent_decode(path)?, bytes)
}

/// Decode a JavaScript encodeURIComponent string.
fn percent_decode(s: &str) -> Result<String, String> {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            let hex = s.get(i + 1..i + 3).ok_or("truncated percent escape")?;
            out.push(u8::from_str_radix(hex, 16).map_err(|e| e.to_string())?);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8(out).map_err(|e| e.to_string())
}

/// Return the application version string from Cargo.toml.
#[tauri::command]
fn app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

/// Stop the sidecar before an update is installed. On Windows the installer
/// must overwrite pedimap-backend.exe, which is locked while it runs; on
/// macOS/Linux the relaunched app must not find the old backend still
/// holding port 8765. Async so the wait in stop_child runs off the main thread.
#[tauri::command]
async fn stop_backend(app: AppHandle) {
    kill_backend(&app);
}

/// Restart the sidecar if installing an update failed after stop_backend.
#[tauri::command]
async fn start_backend(app: AppHandle) {
    let running = app.state::<BackendProcess>().0.lock().unwrap().is_some();
    if !running {
        spawn_backend(&app);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Sidecar helpers
// ─────────────────────────────────────────────────────────────────────────────

fn spawn_backend(app: &AppHandle) {
    match app.shell().sidecar("pedimap-backend") {
        Err(e) => eprintln!("[pedimap] Failed to locate sidecar: {e}"),
        Ok(cmd) => match cmd.spawn() {
            Err(e) => eprintln!("[pedimap] Failed to spawn sidecar: {e}"),
            Ok((_rx, child)) => {
                let state: State<BackendProcess> = app.state();
                *state.0.lock().unwrap() = Some(child);
                eprintln!("[pedimap] Python backend started on port 8765");
            }
        },
    }
}

fn kill_backend(app: &AppHandle) {
    let state: State<BackendProcess> = app.state();
    // Extract the child before dropping the MutexGuard so the borrow of
    // `state` ends before `state` itself is released.
    let child = state.0.lock().unwrap().take();
    if let Some(child) = child {
        stop_child(child);
        eprintln!("[pedimap] Python backend stopped.");
    }
}

/// The sidecar is a PyInstaller onefile binary: a bootloader process that
/// runs the Python server as its child. SIGKILL on the bootloader orphans
/// that child, which keeps serving port 8765 after the app has quit. SIGTERM
/// is forwarded to the child and both exit; SIGKILL is only the fallback.
#[cfg(unix)]
fn stop_child(child: CommandChild) {
    use std::time::{Duration, Instant};

    let pid = child.pid() as libc::pid_t;
    // SAFETY: plain kill(2) on a pid we spawned and still own.
    unsafe { libc::kill(pid, libc::SIGTERM) };

    // The bootloader exits only after its child has, so once its pid is gone
    // (reaped by the shell plugin's wait thread) port 8765 is free.
    let deadline = Instant::now() + Duration::from_secs(3);
    while Instant::now() < deadline {
        // SAFETY: signal 0 only checks that the process exists.
        if unsafe { libc::kill(pid, 0) } != 0 {
            return;
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    eprintln!("[pedimap] Backend ignored SIGTERM; killing it.");
    let _ = child.kill();
}

/// Windows has no SIGTERM; terminate the bootloader. Whether its Python child
/// always exits with it has not been verified on Windows yet (see
/// CONTRIBUTING.md release checks: no pedimap-backend.exe left after quitting).
#[cfg(not(unix))]
fn stop_child(child: CommandChild) {
    let _ = child.kill();
}

// ─────────────────────────────────────────────────────────────────────────────
// main
// ─────────────────────────────────────────────────────────────────────────────

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(BackendProcess(Mutex::new(None)))
        .manage(SaveGrants::default())
        .setup(|app| {
            spawn_backend(&app.handle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_backend_url,
            open_file_dialog,
            save_file_dialog,
            read_file,
            write_file,
            write_binary_file,
            app_version,
            stop_backend,
            start_backend,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| match event {
            RunEvent::WindowEvent {
                label,
                event: WindowEvent::CloseRequested { .. },
                ..
            } if label == "main" => kill_backend(app_handle),
            // Quitting from the macOS app menu (Cmd+Q) or AppHandle::exit
            // skips CloseRequested; stop the sidecar here too. A no-op if it
            // was already stopped.
            RunEvent::Exit => kill_backend(app_handle),
            _ => {}
        });
}

#[cfg(test)]
mod tests {
    use super::{decode_text, percent_decode, read_file, save_filters_for, SaveGrants};

    fn read_bytes(name: &str, bytes: &[u8]) -> super::TextFile {
        let path = std::env::temp_dir().join(name);
        std::fs::write(&path, bytes).unwrap();
        let file = read_file(path.to_string_lossy().into_owned()).unwrap();
        let _ = std::fs::remove_file(&path);
        file
    }

    #[test]
    fn read_file_decodes_windows_1252_instead_of_failing() {
        // "Élise" (0xC9) and an en dash (0x96), as a Windows program saves them.
        let file = read_bytes("pedimap2-read-file-1252.dat", b"NAME \xC9lise sweet\x96tart\n");
        assert_eq!(file.encoding, "windows-1252");
        assert_eq!(file.text, "NAME \u{C9}lise sweet\u{2013}tart\n");
        assert!(!file.text.contains('\u{FFFD}'));
    }

    #[test]
    fn read_file_uses_utf8_and_strips_a_bom() {
        let file = read_bytes("pedimap2-read-file-utf8.dat", "\u{FEFF}NAME Élise\n".as_bytes());
        assert_eq!(file.encoding, "utf-8");
        assert_eq!(file.text, "NAME Élise\n");
    }

    #[test]
    fn every_windows_1252_byte_maps_to_a_character() {
        let all: Vec<u8> = (0x80..=0xFF).collect();
        let file = decode_text(&all);
        assert_eq!(file.encoding, "windows-1252");
        assert_eq!(file.text.chars().count(), all.len());
        assert!(!file.text.contains('\u{FFFD}'));
        assert_eq!(file.text.chars().next(), Some('\u{20AC}')); // 0x80 is the euro sign
    }

    #[test]
    fn writes_only_to_paths_granted_by_the_save_dialog() {
        let dir = std::env::temp_dir();
        let granted = dir.join("pedimap2-granted.png").to_string_lossy().into_owned();
        let other = dir.join("pedimap2-not-granted.png").to_string_lossy().into_owned();
        let _ = std::fs::remove_file(&other);

        let grants = SaveGrants::default();
        assert!(grants.write(&granted, b"x").is_err()); // nothing granted yet
        grants.grant(&granted);
        grants.write(&granted, b"\x89PNG").unwrap();
        assert_eq!(std::fs::read(&granted).unwrap(), b"\x89PNG");
        let err = grants.write(&other, b"x").unwrap_err();
        assert!(err.contains("not chosen in a save dialog"));
        assert!(!std::path::Path::new(&other).exists());
        let _ = std::fs::remove_file(&granted);
    }

    #[test]
    fn percent_decode_round_trips_encode_uri_component() {
        // encodeURIComponent("/Users/a b/Šampion.pdf")
        assert_eq!(
            percent_decode("%2FUsers%2Fa%20b%2F%C5%A0ampion.pdf").unwrap(),
            "/Users/a b/Šampion.pdf"
        );
        assert!(percent_decode("%2").is_err());
    }

    #[test]
    fn save_filters_offer_the_matching_group_first() {
        let exts = |n| save_filters_for(n).into_iter().map(|f| f.0).collect::<Vec<_>>();
        assert_eq!(exts("tree.svg"), ["svg", "png", "pdf"]);
        assert_eq!(exts("pop.dat"), ["dat", "json"]);
        assert_eq!(exts("pedigree.json"), ["json", "dat"]);
    }
}
