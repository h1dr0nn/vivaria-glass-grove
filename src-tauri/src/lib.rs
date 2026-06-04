use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

use tauri::Manager;

/// Serializes save writes — concurrent autosave + event-save would otherwise
/// race on the shared temp file and could corrupt the save or backup.
static SAVE_LOCK: Mutex<()> = Mutex::new(());

/// Resolve (and create) the app-data directory holding the save files.
fn save_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("cannot resolve app data dir: {e}"))?;
    fs::create_dir_all(&dir).map_err(|e| format!("cannot create app data dir: {e}"))?;
    Ok(dir.join("save.json"))
}

/// Atomic save: write to a temp file, keep one rolling backup, then rename.
/// A crash mid-write can never corrupt the existing save. Writes are
/// serialized; error details stay in the log, not in the frontend string.
#[tauri::command]
fn save_game(app: tauri::AppHandle, data: String) -> Result<(), String> {
    let _guard = SAVE_LOCK
        .lock()
        .map_err(|_| "save lock poisoned".to_string())?;
    let path = save_path(&app)?;
    let tmp = path.with_extension("json.tmp");
    let bak = path.with_extension("json.bak");

    fs::write(&tmp, data.as_bytes()).map_err(|e| {
        eprintln!("save write failed: {e}");
        "cannot write save".to_string()
    })?;
    if path.exists() {
        // best-effort backup rotation — a failed backup must not block saving
        let _ = fs::copy(&path, &bak);
    }
    fs::rename(&tmp, &path).map_err(|e| {
        eprintln!("save commit failed: {e}");
        "cannot commit save".to_string()
    })?;
    Ok(())
}

/// Load the primary save. Returns None when no save exists yet.
#[tauri::command]
fn load_game(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let path = save_path(&app)?;
    match fs::read_to_string(&path) {
        Ok(contents) => Ok(Some(contents)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => {
            eprintln!("save read failed: {e}");
            Err("cannot read save".to_string())
        }
    }
}

/// Load the rolling backup — used when the primary save fails validation.
#[tauri::command]
fn load_backup(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let path = save_path(&app)?.with_extension("json.bak");
    match fs::read_to_string(&path) {
        Ok(contents) => Ok(Some(contents)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => {
            eprintln!("backup read failed: {e}");
            Err("cannot read backup".to_string())
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // a second launch would race the save file — focus the first instead
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![save_game, load_game, load_backup])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
