// src-tauri/src/main.rs
// =====================
// Pedimap 2.0 — Tauri 2 application entry point.
//
// Responsibilities:
//   1. Spawn the Python FastAPI backend as a sidecar on startup
//   2. Expose Tauri commands for native OS operations
//   3. Kill the sidecar cleanly when the main window is closed

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::Mutex;
use tauri::{AppHandle, Manager, RunEvent, State, WindowEvent};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_shell::process::CommandChild;
use tauri_plugin_shell::ShellExt;

// ─────────────────────────────────────────────────────────────────────────────
// Shared state — holds the child process handle for the Python sidecar
// ─────────────────────────────────────────────────────────────────────────────
struct BackendProcess(Mutex<Option<CommandChild>>);

// ─────────────────────────────────────────────────────────────────────────────
// Tauri commands
// ─────────────────────────────────────────────────────────────────────────────

/// URL that the React frontend uses to reach the FastAPI backend.
#[tauri::command]
fn get_backend_url() -> String {
    "http://127.0.0.1:8765".to_string()
}

/// Open a native file-picker. Returns the selected path or "".
#[tauri::command]
async fn open_file_dialog(app: AppHandle) -> Result<String, String> {
    let path = app
        .dialog()
        .file()
        .add_filter("Pedigree files", &["json", "dat", "pmp"])
        .add_filter("All files", &["*"])
        .blocking_pick_file();
    Ok(path.map(|p| p.to_string()).unwrap_or_default())
}

/// Open a native save dialog. Returns the chosen destination path or "".
#[tauri::command]
async fn save_file_dialog(app: AppHandle) -> Result<String, String> {
    let path = app
        .dialog()
        .file()
        .add_filter("Pedigree JSON", &["json"])
        .add_filter("Pedimap Data", &["dat"])
        .set_file_name("pedigree.json")
        .blocking_save_file();
    Ok(path.map(|p| p.to_string()).unwrap_or_default())
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
        let _ = child.kill();
        eprintln!("[pedimap] Python backend stopped.");
    }
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
            if let RunEvent::WindowEvent {
                label,
                event: WindowEvent::CloseRequested { .. },
                ..
            } = event
            {
                if label == "main" {
                    kill_backend(app_handle);
                }
            }
        });
}
