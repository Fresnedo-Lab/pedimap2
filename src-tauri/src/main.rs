// src-tauri/src/main.rs
// =====================
// Pedimap 2.0 — Tauri application entry point.
//
// Responsibilities:
//   1. Spawn the Python FastAPI backend as a sidecar on startup
//   2. Expose Tauri commands for native OS operations
//   3. Kill the sidecar cleanly on app exit

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::Mutex;
use tauri::{
    api::{dialog, process::Command},
    AppHandle, Manager, RunEvent, State, Window,
};

// ─────────────────────────────────────────────────────────────────────────────
// Shared state – holds the child process handle for the Python sidecar
// ─────────────────────────────────────────────────────────────────────────────
struct BackendProcess(Mutex<Option<tauri::api::process::CommandChild>>);

// ─────────────────────────────────────────────────────────────────────────────
// Tauri commands
// ─────────────────────────────────────────────────────────────────────────────

/// URL that the React frontend uses to reach the FastAPI backend.
#[tauri::command]
fn get_backend_url() -> String {
    "http://127.0.0.1:5173".to_string()
}

/// Open a native file-picker.  Returns the selected path or "".
#[tauri::command]
async fn open_file_dialog(_window: Window) -> Result<String, String> {
    let (tx, rx) = std::sync::mpsc::channel::<String>();
    dialog::FileDialogBuilder::new()
        .add_filter("Pedigree files", &["json", "dat", "pmp"])
        .add_filter("All files",      &["*"])
        .pick_file(move |path| {
            let _ = tx.send(
                path.map(|p| p.to_string_lossy().into_owned())
                    .unwrap_or_default(),
            );
        });
    rx.recv().map_err(|e| e.to_string())
}

/// Open a native save dialog.  Returns the chosen destination path or "".
#[tauri::command]
async fn save_file_dialog(_window: Window) -> Result<String, String> {
    let (tx, rx) = std::sync::mpsc::channel::<String>();
    dialog::FileDialogBuilder::new()
        .add_filter("Pedigree JSON", &["json"])
        .add_filter("Pedimap Data",  &["dat"])
        .set_file_name("pedigree.json")
        .save_file(move |path| {
            let _ = tx.send(
                path.map(|p| p.to_string_lossy().into_owned())
                    .unwrap_or_default(),
            );
        });
    rx.recv().map_err(|e| e.to_string())
}

/// Read a UTF-8 file from disk and return its contents.
#[tauri::command]
fn read_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| e.to_string())
}

/// Write UTF-8 content to a file on disk.
#[tauri::command]
fn write_file(path: String, content: String) -> Result<(), String> {
    std::fs::write(&path, content).map_err(|e| e.to_string())
}

/// Return the application version string from Cargo.toml.
#[tauri::command]
fn app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

// ─────────────────────────────────────────────────────────────────────────────
// Sidecar helpers
// ─────────────────────────────────────────────────────────────────────────────

fn spawn_backend(app: &AppHandle) {
    match Command::new_sidecar("pedimap-backend") {
        Err(e) => eprintln!("[pedimap] Failed to locate sidecar: {e}"),
        Ok(cmd) => match cmd.spawn() {
            Err(e) => eprintln!("[pedimap] Failed to spawn sidecar: {e}"),
            Ok((_rx, child)) => {
                let state: State<BackendProcess> = app.state();
                *state.0.lock().unwrap() = Some(child);
                eprintln!("[pedimap] Python backend started on port 5173");
            }
        },
    }
}

fn kill_backend(app: &AppHandle) {
    let state: State<BackendProcess> = app.state();

    // FIX for E0597: extract the Option<CommandChild> into its own binding
    // so the MutexGuard temporary is dropped at the end of this statement —
    // before `state` itself goes out of scope at the closing `}`.
    //
    // The original code:
    //   if let Some(child) = state.0.lock().unwrap().take() { ... }
    // kept the MutexGuard alive until the *end of the enclosing block*, which
    // is the same point where `state` is dropped.  Rust's borrow checker
    // requires the guard (which borrows from `state`) to be released first.
    //
    // Splitting into two statements makes the drop order explicit:
    //   1. lock() → guard created, take() extracts the child → guard dropped ✓
    //   2. if let  → uses only `child`, no borrow of `state` remaining ✓
    let child = state.0.lock().unwrap().take();
    if let Some(child) = child {
        let _ = child.kill();
        eprintln!("[pedimap] Python backend stopped.");
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// main
// ─────────────────────────────────────────────────────────────────────────────

fn main() {
    tauri::Builder::default()
        .manage(BackendProcess(Mutex::new(None)))
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
            app_version,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            if let RunEvent::ExitRequested { .. } = event {
                kill_backend(app_handle);
            }
        });
}
