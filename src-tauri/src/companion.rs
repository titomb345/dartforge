use std::collections::VecDeque;
use std::net::SocketAddr;
use std::sync::Arc;

use axum::extract::ws::{Message, WebSocket};
use axum::extract::{State, WebSocketUpgrade};
use axum::response::{Html, IntoResponse};
use axum::routing::get;
use axum::Router;
use futures_util::{SinkExt, StreamExt};
use log::{error, info, warn};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tokio::sync::{broadcast, Mutex};

// ── Events ──────────────────────────────────────────────────────────

pub const COMPANION_COMMAND_EVENT: &str = "companion:command";
pub const COMPANION_RECONNECT_EVENT: &str = "companion:reconnect";
pub const COMPANION_DISCONNECT_EVENT: &str = "companion:disconnect";

#[derive(Clone, Serialize, Deserialize)]
pub struct CompanionCommandPayload {
    pub command: String,
}

// ── Broadcast message type ──────────────────────────────────────────

#[derive(Clone, Debug)]
pub enum CompanionMessage {
    MudOutput { data: String },
    ConnectionStatus { connected: bool, message: String },
}

// ── Replay buffer ───────────────────────────────────────────────────

/// Ring buffer of recent output chunks so new/reconnecting clients
/// get scrollback instead of a blank screen.
const REPLAY_CAPACITY: usize = 500;

pub struct ReplayBuffer {
    chunks: VecDeque<String>,
}

impl ReplayBuffer {
    pub fn new() -> Self {
        Self {
            chunks: VecDeque::with_capacity(REPLAY_CAPACITY),
        }
    }

    fn push(&mut self, data: &str) {
        if self.chunks.len() >= REPLAY_CAPACITY {
            self.chunks.pop_front();
        }
        self.chunks.push_back(data.to_string());
    }

    fn snapshot(&self) -> Vec<String> {
        self.chunks.iter().cloned().collect()
    }
}

// ── Shared state ────────────────────────────────────────────────────

/// State shared between the axum server handlers.
struct AxumState {
    broadcast_tx: broadcast::Sender<CompanionMessage>,
    replay: Arc<Mutex<ReplayBuffer>>,
    last_status: Arc<Mutex<Option<(bool, String)>>>,
    app_handle: AppHandle,
}

/// Tauri-managed state for the companion feature.
pub struct CompanionState {
    pub broadcast_tx: broadcast::Sender<CompanionMessage>,
    pub replay: Arc<Mutex<ReplayBuffer>>,
    pub last_status: Arc<Mutex<Option<(bool, String)>>>,
    server_handle: Mutex<Option<tokio::task::JoinHandle<()>>>,
    running_port: Mutex<Option<u16>>,
}

impl CompanionState {
    pub fn new(broadcast_tx: broadcast::Sender<CompanionMessage>) -> Self {
        let last_status = Arc::new(Mutex::new(None));

        // Background task: track latest connection status from broadcast channel
        let status_rx = broadcast_tx.subscribe();
        let status_ref = last_status.clone();
        tokio::spawn(async move {
            let mut rx = status_rx;
            while let Ok(msg) = rx.recv().await {
                if let CompanionMessage::ConnectionStatus { connected, message } = msg {
                    *status_ref.lock().await = Some((connected, message));
                }
            }
        });

        Self {
            broadcast_tx,
            replay: Arc::new(Mutex::new(ReplayBuffer::new())),
            last_status,
            server_handle: Mutex::new(None),
            running_port: Mutex::new(None),
        }
    }
}

// ── QR code generation ──────────────────────────────────────────────

fn generate_qr_svg(url: &str) -> String {
    use qrcode::render::svg;
    use qrcode::QrCode;

    match QrCode::new(url.as_bytes()) {
        Ok(code) => code
            .render::<svg::Color>()
            .min_dimensions(200, 200)
            .max_dimensions(300, 300)
            .dark_color(svg::Color("#f8f8f2"))
            .light_color(svg::Color("#282a36"))
            .quiet_zone(false)
            .build(),
        Err(_) => String::new(),
    }
}

// ── Tauri commands ──────────────────────────────────────────────────

#[derive(Serialize)]
pub struct CompanionInfo {
    pub running: bool,
    pub port: u16,
    pub local_ip: String,
    pub url: String,
    pub qr_svg: String,
}

/// Called by the frontend to broadcast post-gag output to companion clients.
#[tauri::command]
pub async fn broadcast_companion_output(
    state: tauri::State<'_, CompanionState>,
    data: String,
) -> Result<(), String> {
    state.replay.lock().await.push(&data);
    let _ = state.broadcast_tx.send(CompanionMessage::MudOutput { data });
    Ok(())
}

#[tauri::command]
pub async fn start_companion(
    app: AppHandle,
    state: tauri::State<'_, CompanionState>,
    port: u16,
) -> Result<CompanionInfo, String> {
    // Stop existing server if running
    {
        let mut handle = state.server_handle.lock().await;
        if let Some(h) = handle.take() {
            h.abort();
        }
    }

    let local_ip = local_ip_address::local_ip()
        .map(|ip| ip.to_string())
        .unwrap_or_else(|_| "127.0.0.1".to_string());

    let url = format!("http://{local_ip}:{port}");
    let qr_svg = generate_qr_svg(&url);

    let axum_state = Arc::new(AxumState {
        broadcast_tx: state.broadcast_tx.clone(),
        replay: state.replay.clone(),
        last_status: state.last_status.clone(),
        app_handle: app,
    });

    let router = Router::new()
        .route("/", get(serve_page))
        .route("/ws", get(ws_upgrade))
        .with_state(axum_state);

    let addr = SocketAddr::from(([0, 0, 0, 0], port));

    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .map_err(|e| format!("Failed to bind port {port}: {e}"))?;

    info!("Companion server starting on {addr}");

    let handle = tokio::spawn(async move {
        if let Err(e) = axum::serve(listener, router).await {
            error!("Companion server error: {e}");
        }
    });

    *state.server_handle.lock().await = Some(handle);
    *state.running_port.lock().await = Some(port);

    Ok(CompanionInfo {
        running: true,
        port,
        local_ip,
        url,
        qr_svg,
    })
}

#[tauri::command]
pub async fn stop_companion(
    state: tauri::State<'_, CompanionState>,
) -> Result<(), String> {
    let mut handle = state.server_handle.lock().await;
    if let Some(h) = handle.take() {
        h.abort();
        info!("Companion server stopped");
    }
    *state.running_port.lock().await = None;
    Ok(())
}

#[tauri::command]
pub async fn get_companion_info(
    state: tauri::State<'_, CompanionState>,
) -> Result<CompanionInfo, String> {
    let port = state.running_port.lock().await;
    let running = port.is_some();
    let port_val = port.unwrap_or(3333);

    let local_ip = local_ip_address::local_ip()
        .map(|ip| ip.to_string())
        .unwrap_or_else(|_| "127.0.0.1".to_string());

    let url = if running {
        format!("http://{local_ip}:{port_val}")
    } else {
        String::new()
    };

    let qr_svg = if running {
        generate_qr_svg(&url)
    } else {
        String::new()
    };

    Ok(CompanionInfo {
        running,
        port: port_val,
        local_ip,
        url,
        qr_svg,
    })
}

// ── Axum handlers ───────────────────────────────────────────────────

async fn serve_page() -> impl IntoResponse {
    Html(include_str!("companion_page.html"))
}

async fn ws_upgrade(
    ws: WebSocketUpgrade,
    State(state): State<Arc<AxumState>>,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_ws(socket, state))
}

async fn handle_ws(socket: WebSocket, state: Arc<AxumState>) {
    let (mut ws_tx, mut ws_rx) = socket.split();

    // Subscribe to live broadcast BEFORE replaying so we don't miss
    // messages that arrive between the snapshot and the subscribe.
    let mut broadcast_rx = state.broadcast_tx.subscribe();

    // Replay recent output and current status so the client has context
    {
        let buffer = state.replay.lock().await;
        for chunk in buffer.snapshot() {
            let json = serde_json::json!({
                "type": "output",
                "data": chunk
            })
            .to_string();
            if ws_tx.send(Message::Text(json)).await.is_err() {
                return;
            }
        }
    }
    // Send current connection status so buttons show correctly on load
    {
        let status = state.last_status.lock().await;
        if let Some((connected, ref message)) = *status {
            let json = serde_json::json!({
                "type": "status",
                "connected": connected,
                "message": message
            })
            .to_string();
            if ws_tx.send(Message::Text(json)).await.is_err() {
                return;
            }
        }
    }

    // Task: broadcast → WebSocket client
    let send_task = tokio::spawn(async move {
        while let Ok(msg) = broadcast_rx.recv().await {
            let json = match &msg {
                CompanionMessage::MudOutput { data } => {
                    serde_json::json!({
                        "type": "output",
                        "data": data
                    })
                    .to_string()
                }
                CompanionMessage::ConnectionStatus { connected, message } => {
                    serde_json::json!({
                        "type": "status",
                        "connected": connected,
                        "message": message
                    })
                    .to_string()
                }
            };
            if ws_tx.send(Message::Text(json)).await.is_err() {
                break;
            }
        }
    });

    // Task: WebSocket client → frontend (via Tauri event for full command processing)
    let app_handle = state.app_handle.clone();
    let recv_task = tokio::spawn(async move {
        while let Some(Ok(msg)) = ws_rx.next().await {
            if let Message::Text(text) = msg {
                let text_str = text.to_string();

                // Check for special control messages (JSON with "type" field)
                if let Ok(json) = serde_json::from_str::<serde_json::Value>(&text_str) {
                    if let Some(msg_type) = json.get("type").and_then(|v| v.as_str()) {
                        match msg_type {
                            "reconnect" => {
                                if let Err(e) = app_handle.emit(COMPANION_RECONNECT_EVENT, ()) {
                                    warn!("Failed to emit companion reconnect: {e}");
                                }
                                continue;
                            }
                            "disconnect" => {
                                if let Err(e) = app_handle.emit(COMPANION_DISCONNECT_EVENT, ()) {
                                    warn!("Failed to emit companion disconnect: {e}");
                                }
                                continue;
                            }
                            _ => {}
                        }
                    }
                }

                // Regular command
                if let Err(e) = app_handle.emit(
                    COMPANION_COMMAND_EVENT,
                    CompanionCommandPayload { command: text_str },
                ) {
                    warn!("Failed to emit companion command: {e}");
                    break;
                }
            }
        }
    });

    // Wait for either task to finish, then abort the other
    tokio::select! {
        _ = send_task => {}
        _ = recv_task => {}
    }
}
