mod ansi;
mod companion;
mod connection;
mod events;
mod storage;

use std::sync::Mutex;
use tauri::{Emitter, Manager};
use tokio::sync::{broadcast, mpsc};

use companion::CompanionState;

struct ConnectionState {
    cmd_tx: Mutex<Option<mpsc::Sender<String>>>,
    task_handle: Mutex<Option<tauri::async_runtime::JoinHandle<()>>>,
}

fn spawn_connection(
    app: &tauri::AppHandle,
    state: &ConnectionState,
    companion_state: &CompanionState,
    startup_delay: bool,
) {
    // Drop old sender and abort old task
    {
        let mut tx = state.cmd_tx.lock().unwrap_or_else(|e| e.into_inner());
        *tx = None;
        let mut handle = state.task_handle.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(h) = handle.take() {
            h.abort();
        }
    }

    let (tx, rx) = mpsc::channel::<String>(100);
    *state.cmd_tx.lock().unwrap_or_else(|e| e.into_inner()) = Some(tx);

    let app_handle = app.clone();
    let broadcast_tx = companion_state.broadcast_tx.clone();
    let last_status = companion_state.last_status.clone();
    let join = tauri::async_runtime::spawn(async move {
        if startup_delay {
            // Brief delay on first launch lets WebView2 finish initialization
            tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;
        }
        connection::connect(app_handle, rx, broadcast_tx, last_status).await;
    });

    *state.task_handle.lock().unwrap_or_else(|e| e.into_inner()) = Some(join);
}

#[tauri::command]
async fn send_command(
    state: tauri::State<'_, ConnectionState>,
    command: String,
) -> Result<(), String> {
    let tx = {
        let guard = state.cmd_tx.lock().map_err(|e| e.to_string())?;
        guard.clone()
    };
    if let Some(tx) = tx {
        tx.send(command).await.map_err(|e| e.to_string())?;
        Ok(())
    } else {
        Err("Not connected".to_string())
    }
}

#[tauri::command]
async fn reconnect(
    app: tauri::AppHandle,
    state: tauri::State<'_, ConnectionState>,
    companion_state: tauri::State<'_, CompanionState>,
) -> Result<(), String> {
    spawn_connection(&app, &state, &companion_state, false);
    Ok(())
}

#[tauri::command]
async fn disconnect(
    app: tauri::AppHandle,
    state: tauri::State<'_, ConnectionState>,
    companion_state: tauri::State<'_, CompanionState>,
) -> Result<(), String> {
    {
        let mut tx = state.cmd_tx.lock().map_err(|e| e.to_string())?;
        *tx = None;
    }
    {
        let mut handle = state.task_handle.lock().map_err(|e| e.to_string())?;
        if let Some(h) = handle.take() {
            h.abort();
        }
    }
    let _ = app.emit(
        crate::events::CONNECTION_STATUS_EVENT,
        crate::events::ConnectionStatusPayload {
            connected: false,
            message: "Disconnected".to_string(),
        },
    );
    let _ = companion_state.broadcast_tx.send(companion::CompanionMessage::ConnectionStatus {
        connected: false,
        message: "Disconnected".to_string(),
    });
    *companion_state.last_status.lock().await = Some((false, "Disconnected".to_string()));
    Ok(())
}

#[tauri::command]
fn read_system_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read {path}: {e}"))
}

#[tauri::command]
fn write_system_file(path: String, content: String) -> Result<(), String> {
    // Ensure parent directory exists
    if let Some(parent) = std::path::Path::new(&path).parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create directory for {path}: {e}"))?;
    }
    std::fs::write(&path, &content)
        .map_err(|e| format!("Failed to write {path}: {e}"))
}

const KEYRING_SERVICE: &str = "dartforge";

#[tauri::command]
fn store_credential(account: String, password: String) -> Result<(), String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, &account)
        .map_err(|e| format!("Keyring error: {e}"))?;
    entry.set_password(&password)
        .map_err(|e| format!("Failed to store credential: {e}"))?;
    Ok(())
}

#[tauri::command]
fn get_credential(account: String) -> Result<Option<String>, String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, &account)
        .map_err(|e| format!("Keyring error: {e}"))?;
    match entry.get_password() {
        Ok(password) => Ok(Some(password)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!("Failed to get credential: {e}")),
    }
}

#[tauri::command]
fn delete_credential(account: String) -> Result<(), String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, &account)
        .map_err(|e| format!("Keyring error: {e}"))?;
    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()), // Already gone
        Err(e) => Err(format!("Failed to delete credential: {e}")),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    env_logger::init();

    // Create a long-lived broadcast channel for companion WebSocket clients
    let (broadcast_tx, _) = broadcast::channel::<companion::CompanionMessage>(256);

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(ConnectionState {
            cmd_tx: Mutex::new(None),
            task_handle: Mutex::new(None),
        })
        .manage(CompanionState::new(broadcast_tx))
        .invoke_handler(tauri::generate_handler![
            send_command,
            reconnect,
            disconnect,
            companion::start_companion,
            companion::stop_companion,
            companion::get_companion_info,
            companion::broadcast_companion_output,
            storage::resolve_data_dir,
            storage::get_active_data_dir,
            storage::read_data_file,
            storage::write_data_file,
            storage::read_text_file,
            storage::write_text_file,
            storage::delete_text_file,
            storage::copy_data_to_dir,
            storage::check_dir_valid,
            storage::create_backup,
            storage::list_backups,
            storage::restore_backup,
            storage::prune_backups,
            storage::append_to_log,
            storage::list_session_logs,
            storage::read_session_log,
            storage::search_session_logs,
            storage::delete_session_log,
            storage::import_sound_file,
            storage::get_sound_base64,
            storage::remove_custom_sound,
            storage::list_custom_sounds,
            read_system_file,
            write_system_file,
            store_credential,
            get_credential,
            delete_credential,
        ])
        .setup(|app| {
            // Initialize storage state with default app data dir
            let data_dir = app.path().app_data_dir()
                .map_err(|e| format!("Failed to get app data dir: {e}"))?;
            if let Err(e) = std::fs::create_dir_all(&data_dir) {
                log::warn!("Failed to create data dir {}: {e}", data_dir.display());
            }
            app.manage(storage::StorageState::new(data_dir));
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
