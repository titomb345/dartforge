mod ansi;
mod connection;
mod events;
mod storage;

use std::sync::Mutex;
use tauri::{Emitter, Manager};
use tokio::sync::mpsc;

struct ConnectionState {
    cmd_tx: Mutex<Option<mpsc::Sender<String>>>,
    task_handle: Mutex<Option<tauri::async_runtime::JoinHandle<()>>>,
}

fn spawn_connection(app: &tauri::AppHandle, state: &ConnectionState, startup_delay: bool) {
    // Drop old sender to signal the old connection to stop
    {
        let mut tx = state.cmd_tx.lock().unwrap_or_else(|e| e.into_inner());
        *tx = None;
    }

    // Abort old task if still running
    {
        let mut handle = state.task_handle.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(h) = handle.take() {
            h.abort();
        }
    }

    let (tx, rx) = mpsc::channel::<String>(100);
    *state.cmd_tx.lock().unwrap_or_else(|e| e.into_inner()) = Some(tx);

    let app_handle = app.clone();
    let join = tauri::async_runtime::spawn(async move {
        if startup_delay {
            // Brief delay on first launch lets WebView2 finish initialization
            tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;
        }
        connection::connect(app_handle, rx).await;
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
async fn reconnect(app: tauri::AppHandle, state: tauri::State<'_, ConnectionState>) -> Result<(), String> {
    spawn_connection(&app, &state, false);
    Ok(())
}

#[tauri::command]
async fn disconnect(app: tauri::AppHandle, state: tauri::State<'_, ConnectionState>) -> Result<(), String> {
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
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    env_logger::init();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .manage(ConnectionState {
            cmd_tx: Mutex::new(None),
            task_handle: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![
            send_command,
            reconnect,
            disconnect,
            storage::resolve_data_dir,
            storage::get_active_data_dir,
            storage::read_data_file,
            storage::write_data_file,
            storage::read_text_file,
            storage::write_text_file,
            storage::copy_data_to_dir,
            storage::check_dir_valid,
            storage::create_backup,
            storage::list_backups,
            storage::restore_backup,
            storage::prune_backups,
            storage::append_to_log,
            storage::import_sound_file,
            storage::get_sound_base64,
            storage::remove_custom_sound,
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
