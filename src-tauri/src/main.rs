// src-tauri/src/main.rs
// =====================
// Pedimap 2.0 — Tauri 2 application entry point.
//
// Responsibilities:
//   1. Spawn the Python FastAPI backend as a sidecar on startup
//   2. Expose Tauri commands for native OS operations
//   3. Stop the sidecar cleanly when the app exits, and around update installs

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

/// Open a native save dialog suggesting `default_name` (default
/// "pedigree.json"); the filter matching its extension is listed first so it
/// is the one preselected. Returns the chosen destination path or "".
#[tauri::command]
async fn save_file_dialog(app: AppHandle, default_name: Option<String>) -> Result<String, String> {
    let name = default_name.unwrap_or_else(|| "pedigree.json".to_string());
    let dialog = app.dialog().file();
    let dialog = if name.to_lowercase().ends_with(".dat") {
        dialog.add_filter("Pedimap Data", &["dat"]).add_filter("Pedigree JSON", &["json"])
    } else {
        dialog.add_filter("Pedigree JSON", &["json"]).add_filter("Pedimap Data", &["dat"])
    };
    let path = dialog.set_file_name(name).blocking_save_file();
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
