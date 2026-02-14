mod ansi;
mod connection;
mod events;

use std::sync::Mutex;
use tauri::Manager;
use tokio::sync::mpsc;

struct CommandSender(Mutex<Option<mpsc::Sender<String>>>);

#[tauri::command]
async fn send_command(
    state: tauri::State<'_, CommandSender>,
    command: String,
) -> Result<(), String> {
    let tx = {
        let guard = state.0.lock().map_err(|e| e.to_string())?;
        guard.clone()
    };
    if let Some(tx) = tx {
        tx.send(command).await.map_err(|e| e.to_string())?;
        Ok(())
    } else {
        Err("Not connected".to_string())
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    env_logger::init();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(CommandSender(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![send_command])
        .setup(|app| {
            let app_handle = app.handle().clone();
            let (tx, rx) = mpsc::channel::<String>(100);

            // Store the sender in managed state
            let state = app.state::<CommandSender>();
            *state.0.lock().unwrap() = Some(tx);

            // Spawn the connection on Tauri's async runtime
            tauri::async_runtime::spawn(async move {
                connection::connect(app_handle, rx).await;
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
