use std::collections::{HashMap, VecDeque};
use std::net::SocketAddr;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;

use axum::extract::ws::{Message, WebSocket};
use axum::extract::{State, WebSocketUpgrade};
use axum::http::header;
use axum::response::{Html, IntoResponse};
use axum::routing::get;
use axum::Router;
use futures_util::{SinkExt, StreamExt};
use log::{error, info, warn};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tokio::sync::{broadcast, oneshot, Mutex};
use tokio::time::{Instant, MissedTickBehavior};

// ── Events ──────────────────────────────────────────────────────────

pub const COMPANION_COMMAND_EVENT: &str = "companion:command";
pub const COMPANION_RECONNECT_EVENT: &str = "companion:reconnect";
pub const COMPANION_DISCONNECT_EVENT: &str = "companion:disconnect";
pub const COMPANION_QUICKBUTTON_EVENT: &str = "companion:quickbutton";
/// Emitted whenever a phone connects or disconnects, with the live count.
pub const COMPANION_CLIENTS_EVENT: &str = "companion:clients";

#[derive(Clone, Serialize, Deserialize)]
pub struct CompanionQuickButtonPayload {
    pub id: String,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct CompanionCommandPayload {
    pub command: String,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct CompanionClientsPayload {
    pub count: usize,
}

// ── Keepalive / shutdown timing ─────────────────────────────────────

/// How often the server pings each phone so a dead socket is noticed.
const PING_INTERVAL: Duration = Duration::from_secs(20);
/// A socket with no inbound traffic at all (pong, command, anything) for this
/// long is treated as dead and closed.
const LIVENESS_TIMEOUT: Duration = Duration::from_secs(45);
/// How long a closing socket gets to flush its goodbye before we give up on it.
const CLOSE_GRACE: Duration = Duration::from_secs(2);
/// How long stop/restart waits for phones to acknowledge the shutdown notice
/// before moving on regardless.
const SHUTDOWN_DRAIN: Duration = Duration::from_secs(1);

// ── Broadcast message type ──────────────────────────────────────────

#[derive(Clone, Debug)]
pub enum CompanionMessage {
    MudOutput {
        data: String,
    },
    ConnectionStatus {
        connected: bool,
        message: String,
    },
    CommandHistory {
        history: Vec<String>,
    },
    /// Parsed character status readouts (health, hunger, alignment, …) already
    /// resolved to display label + color on the desktop side. Sent as an opaque
    /// JSON array so the companion can render the status bar without re-parsing.
    Vitals {
        readouts: serde_json::Value,
    },
    /// Companion-relevant settings mirrored from the desktop client (e.g. the
    /// user's customizable numpad mappings). Opaque JSON object.
    Config {
        config: serde_json::Value,
    },
    /// Generic keyed live-state feed (e.g. "clock", "who", "counters",
    /// "quickbuttons"). The latest value per key is replayed to new clients.
    State {
        key: String,
        data: serde_json::Value,
    },
    /// The server is going away (stop or port change). Every socket forwards
    /// a `server/stopping` notice to its phone and closes itself.
    Shutdown,
}

impl CompanionMessage {
    /// The wire form sent to the page. One place for every JSON shape so the
    /// replay burst and the live stream can never drift apart.
    fn to_json(&self) -> String {
        let value = match self {
            CompanionMessage::MudOutput { data } => serde_json::json!({
                "type": "output",
                "data": data
            }),
            CompanionMessage::ConnectionStatus { connected, message } => serde_json::json!({
                "type": "status",
                "connected": connected,
                "message": message
            }),
            CompanionMessage::CommandHistory { history } => serde_json::json!({
                "type": "history",
                "history": history
            }),
            CompanionMessage::Vitals { readouts } => serde_json::json!({
                "type": "vitals",
                "readouts": readouts
            }),
            CompanionMessage::Config { config } => serde_json::json!({
                "type": "config",
                "config": config
            }),
            CompanionMessage::State { key, data } => serde_json::json!({
                "type": "state",
                "key": key,
                "data": data
            }),
            CompanionMessage::Shutdown => serde_json::json!({
                "type": "server",
                "event": "stopping"
            }),
        };
        value.to_string()
    }
}

fn replay_marker(phase: &str) -> String {
    serde_json::json!({
        "type": "replay",
        "phase": phase
    })
    .to_string()
}

fn ping_json() -> String {
    serde_json::json!({ "type": "ping" }).to_string()
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
    last_history: Arc<Mutex<Vec<String>>>,
    last_vitals: Arc<Mutex<Option<serde_json::Value>>>,
    last_config: Arc<Mutex<Option<serde_json::Value>>>,
    last_states: Arc<Mutex<HashMap<String, serde_json::Value>>>,
    clients: Arc<AtomicUsize>,
    app_handle: AppHandle,
}

/// Tauri-managed state for the companion feature.
pub struct CompanionState {
    pub broadcast_tx: broadcast::Sender<CompanionMessage>,
    pub replay: Arc<Mutex<ReplayBuffer>>,
    pub last_status: Arc<Mutex<Option<(bool, String)>>>,
    pub last_history: Arc<Mutex<Vec<String>>>,
    pub last_vitals: Arc<Mutex<Option<serde_json::Value>>>,
    pub last_config: Arc<Mutex<Option<serde_json::Value>>>,
    pub last_states: Arc<Mutex<HashMap<String, serde_json::Value>>>,
    /// Number of phones currently holding an open WebSocket.
    pub clients: Arc<AtomicUsize>,
    server_handle: Mutex<Option<tokio::task::JoinHandle<()>>>,
    running_port: Mutex<Option<u16>>,
}

impl CompanionState {
    pub fn new(broadcast_tx: broadcast::Sender<CompanionMessage>) -> Self {
        Self {
            broadcast_tx,
            replay: Arc::new(Mutex::new(ReplayBuffer::new())),
            last_status: Arc::new(Mutex::new(None)),
            last_history: Arc::new(Mutex::new(Vec::new())),
            last_vitals: Arc::new(Mutex::new(None)),
            last_config: Arc::new(Mutex::new(None)),
            last_states: Arc::new(Mutex::new(HashMap::new())),
            clients: Arc::new(AtomicUsize::new(0)),
            server_handle: Mutex::new(None),
            running_port: Mutex::new(None),
        }
    }
}

// ── Client counting ─────────────────────────────────────────────────

fn emit_client_count(app: &AppHandle, count: usize) {
    if let Err(e) = app.emit(COMPANION_CLIENTS_EVENT, CompanionClientsPayload { count }) {
        warn!("Failed to emit companion client count: {e}");
    }
}

/// Counts one connected phone for as long as it lives. Dropping it (on any
/// exit path out of `handle_ws`: hang-up, keepalive timeout, server shutdown)
/// decrements the count and tells the desktop.
struct ClientGuard {
    clients: Arc<AtomicUsize>,
    app: AppHandle,
}

impl ClientGuard {
    fn connect(state: &AxumState) -> Self {
        let count = state.clients.fetch_add(1, Ordering::SeqCst) + 1;
        info!("Companion client connected ({count} online)");
        emit_client_count(&state.app_handle, count);
        Self {
            clients: state.clients.clone(),
            app: state.app_handle.clone(),
        }
    }
}

impl Drop for ClientGuard {
    fn drop(&mut self) {
        let count = self
            .clients
            .fetch_sub(1, Ordering::SeqCst)
            .saturating_sub(1);
        info!("Companion client disconnected ({count} online)");
        emit_client_count(&self.app, count);
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
///
/// The push and the send happen under the replay lock on purpose: `handle_ws`
/// snapshots the buffer and subscribes to the stream under that same lock, so
/// a chunk ends up in exactly one of the two, never both and never neither.
#[tauri::command]
pub async fn broadcast_companion_output(
    state: tauri::State<'_, CompanionState>,
    data: String,
) -> Result<(), String> {
    let mut replay = state.replay.lock().await;
    replay.push(&data);
    let _ = state
        .broadcast_tx
        .send(CompanionMessage::MudOutput { data });
    Ok(())
}

/// Called by the frontend to sync command history to companion clients.
#[tauri::command]
pub async fn broadcast_companion_history(
    state: tauri::State<'_, CompanionState>,
    history: Vec<String>,
) -> Result<(), String> {
    *state.last_history.lock().await = history.clone();
    let _ = state
        .broadcast_tx
        .send(CompanionMessage::CommandHistory { history });
    Ok(())
}

/// Called by the frontend to push parsed character status readouts to companion
/// clients. `readouts` is an opaque JSON array built on the desktop side.
#[tauri::command]
pub async fn broadcast_companion_vitals(
    state: tauri::State<'_, CompanionState>,
    readouts: serde_json::Value,
) -> Result<(), String> {
    *state.last_vitals.lock().await = Some(readouts.clone());
    let _ = state
        .broadcast_tx
        .send(CompanionMessage::Vitals { readouts });
    Ok(())
}

/// Called by the frontend to mirror companion-relevant settings (e.g. the
/// user's numpad mappings) to companion clients. `config` is an opaque JSON
/// object.
#[tauri::command]
pub async fn broadcast_companion_config(
    state: tauri::State<'_, CompanionState>,
    config: serde_json::Value,
) -> Result<(), String> {
    *state.last_config.lock().await = Some(config.clone());
    let _ = state.broadcast_tx.send(CompanionMessage::Config { config });
    Ok(())
}

/// Called by the frontend to push a keyed live-state feed (clock, who,
/// counters, quick buttons, …) to companion clients. The latest value per key
/// is retained and replayed to new clients.
#[tauri::command]
pub async fn broadcast_companion_state(
    state: tauri::State<'_, CompanionState>,
    key: String,
    data: serde_json::Value,
) -> Result<(), String> {
    state
        .last_states
        .lock()
        .await
        .insert(key.clone(), data.clone());
    let _ = state
        .broadcast_tx
        .send(CompanionMessage::State { key, data });
    Ok(())
}

/// Tear down the running server, if any: stop accepting, tell every phone the
/// server is stopping so their sockets close, wait briefly for them to go, and
/// wait for the serve task to actually finish so the port is free again.
async fn shutdown_server(state: &CompanionState) {
    let handle = state.server_handle.lock().await.take();
    let Some(handle) = handle else {
        return;
    };

    // Stop accepting first so no new phone can slip in after the notice goes
    // out. Sockets already upgraded run in their own tasks and are unaffected.
    handle.abort();

    let _ = state.broadcast_tx.send(CompanionMessage::Shutdown);
    let deadline = Instant::now() + SHUTDOWN_DRAIN;
    while state.clients.load(Ordering::SeqCst) > 0 && Instant::now() < deadline {
        tokio::time::sleep(Duration::from_millis(25)).await;
    }

    // The abort is asynchronous; a fast port change would otherwise try to
    // bind before the old listener is actually gone and report a bogus
    // "port in use" failure.
    let _ = handle.await;
    info!("Companion server stopped");
}

#[tauri::command]
pub async fn start_companion(
    app: AppHandle,
    state: tauri::State<'_, CompanionState>,
    port: u16,
) -> Result<CompanionInfo, String> {
    shutdown_server(&state).await;

    let local_ip = local_ip_address::local_ip()
        .map(|ip| ip.to_string())
        .unwrap_or_else(|_| "127.0.0.1".to_string());

    let url = format!("http://{local_ip}:{port}");
    let qr_svg = generate_qr_svg(&url);

    let axum_state = Arc::new(AxumState {
        broadcast_tx: state.broadcast_tx.clone(),
        replay: state.replay.clone(),
        last_status: state.last_status.clone(),
        last_history: state.last_history.clone(),
        last_vitals: state.last_vitals.clone(),
        last_config: state.last_config.clone(),
        last_states: state.last_states.clone(),
        clients: state.clients.clone(),
        app_handle: app,
    });

    let router = Router::new()
        .route("/", get(serve_page))
        .route("/ws", get(ws_upgrade))
        .route("/manifest.webmanifest", get(serve_manifest))
        .route("/icon-256.png", get(serve_icon_256))
        .route("/icon-512.png", get(serve_icon_512))
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
pub async fn stop_companion(state: tauri::State<'_, CompanionState>) -> Result<(), String> {
    shutdown_server(&state).await;
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

/// Number of phones currently connected to the companion server.
#[tauri::command]
pub fn get_companion_clients(state: tauri::State<'_, CompanionState>) -> usize {
    state.clients.load(Ordering::SeqCst)
}

// ── Axum handlers ───────────────────────────────────────────────────

async fn serve_page() -> impl IntoResponse {
    Html(include_str!("companion_page.html"))
}

/// Web app manifest so Android's "Add to Home screen" installs the companion
/// as a standalone app instead of a browser bookmark.
async fn serve_manifest() -> impl IntoResponse {
    let manifest = serde_json::json!({
        "name": "DartForge Companion",
        "short_name": "DartForge",
        "start_url": "/",
        "display": "standalone",
        "background_color": "#0d0d0d",
        "theme_color": "#0d0d0d",
        "icons": [
            { "src": "/icon-256.png", "sizes": "256x256", "type": "image/png" },
            { "src": "/icon-512.png", "sizes": "512x512", "type": "image/png" }
        ]
    });
    (
        [(header::CONTENT_TYPE, "application/manifest+json")],
        manifest.to_string(),
    )
}

/// 256x256 app icon (src-tauri/icons/128x128@2x.png).
const ICON_256: &[u8] = include_bytes!("../icons/128x128@2x.png");
/// 512x512 app icon (src-tauri/icons/icon.png).
const ICON_512: &[u8] = include_bytes!("../icons/icon.png");

async fn serve_icon_256() -> impl IntoResponse {
    ([(header::CONTENT_TYPE, "image/png")], ICON_256)
}

async fn serve_icon_512() -> impl IntoResponse {
    ([(header::CONTENT_TYPE, "image/png")], ICON_512)
}

async fn ws_upgrade(
    ws: WebSocketUpgrade,
    State(state): State<Arc<AxumState>>,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_ws(socket, state))
}

async fn handle_ws(socket: WebSocket, state: Arc<AxumState>) {
    let (mut ws_tx, mut ws_rx) = socket.split();

    // Counted for the desktop until this function returns, whichever way it
    // leaves (hang-up, keepalive timeout, server shutdown, send failure).
    let _client = ClientGuard::connect(&state);

    // Snapshot the scrollback and subscribe to the live stream under the same
    // lock that broadcast_companion_output pushes + sends under, so a chunk
    // lands in exactly one of the two. Then let go of the lock: nothing is
    // ever sent while a lock is held, or one slow phone would stall every
    // broadcast for everyone.
    let (mut broadcast_rx, chunks) = {
        let buffer = state.replay.lock().await;
        (state.broadcast_tx.subscribe(), buffer.snapshot())
    };
    let status = state.last_status.lock().await.clone();
    let history = state.last_history.lock().await.clone();
    let vitals = state.last_vitals.lock().await.clone();
    let config = state.last_config.lock().await.clone();
    let states: Vec<(String, serde_json::Value)> = state
        .last_states
        .lock()
        .await
        .iter()
        .map(|(key, data)| (key.clone(), data.clone()))
        .collect();

    // The whole catch-up burst, wrapped in markers: the page wipes its stale
    // scrollback on "start" and knows it is current on "end".
    let mut replay: Vec<String> = Vec::with_capacity(chunks.len() + states.len() + 6);
    replay.push(replay_marker("start"));
    replay.extend(
        chunks
            .into_iter()
            .map(|data| CompanionMessage::MudOutput { data }.to_json()),
    );
    if let Some((connected, message)) = status {
        replay.push(CompanionMessage::ConnectionStatus { connected, message }.to_json());
    }
    if !history.is_empty() {
        replay.push(CompanionMessage::CommandHistory { history }.to_json());
    }
    if let Some(readouts) = vitals {
        replay.push(CompanionMessage::Vitals { readouts }.to_json());
    }
    if let Some(config) = config {
        replay.push(CompanionMessage::Config { config }.to_json());
    }
    replay.extend(
        states
            .into_iter()
            .map(|(key, data)| CompanionMessage::State { key, data }.to_json()),
    );
    replay.push(replay_marker("end"));

    for json in replay {
        if ws_tx.send(Message::Text(json)).await.is_err() {
            return;
        }
    }

    // The receive side fires this when it gives up on the socket so the send
    // side can say goodbye with a proper Close frame.
    let (close_tx, mut close_rx) = oneshot::channel::<()>();

    // Task: broadcast → WebSocket client, plus the 20s keepalive ping.
    let mut send_task = tokio::spawn(async move {
        let mut ping = tokio::time::interval_at(Instant::now() + PING_INTERVAL, PING_INTERVAL);
        ping.set_missed_tick_behavior(MissedTickBehavior::Delay);

        loop {
            let json = tokio::select! {
                _ = &mut close_rx => break,
                _ = ping.tick() => ping_json(),
                received = broadcast_rx.recv() => match received {
                    Ok(CompanionMessage::Shutdown) => {
                        let _ = ws_tx
                            .send(Message::Text(CompanionMessage::Shutdown.to_json()))
                            .await;
                        break;
                    }
                    Ok(msg) => msg.to_json(),
                    Err(broadcast::error::RecvError::Lagged(skipped)) => {
                        // The phone fell behind the broadcast ring. Tell it
                        // what it missed and keep going rather than leaving
                        // the socket half-alive.
                        warn!("Companion client fell {skipped} chunks behind; skipping");
                        CompanionMessage::MudOutput {
                            data: format!("\r\n[companion: skipped {skipped} chunks]\r\n"),
                        }
                        .to_json()
                    }
                    Err(broadcast::error::RecvError::Closed) => break,
                },
            };
            if ws_tx.send(Message::Text(json)).await.is_err() {
                break;
            }
        }

        // Explicit goodbye so the phone sees a clean close instead of a
        // dropped TCP connection. Bounded: a wedged socket must not hold us.
        let _ = tokio::time::timeout(CLOSE_GRACE, ws_tx.send(Message::Close(None))).await;
    });

    // Task: WebSocket client → frontend (via Tauri event for full command
    // processing). Any inbound frame, pong or otherwise, counts as liveness;
    // 45s of silence means the phone is gone.
    let app_handle = state.app_handle.clone();
    let mut recv_task = tokio::spawn(async move {
        loop {
            let msg = match tokio::time::timeout(LIVENESS_TIMEOUT, ws_rx.next()).await {
                Ok(Some(Ok(msg))) => msg,
                Ok(Some(Err(e))) => {
                    info!("Companion socket error: {e}");
                    break;
                }
                Ok(None) => break,
                Err(_) => {
                    warn!(
                        "Companion client silent for {}s; closing",
                        LIVENESS_TIMEOUT.as_secs()
                    );
                    break;
                }
            };

            let text = match msg {
                Message::Text(text) => text,
                Message::Close(_) => break,
                // Binary / protocol ping / protocol pong: liveness only.
                _ => continue,
            };

            // Check for special control messages (JSON with "type" field)
            if let Ok(json) = serde_json::from_str::<serde_json::Value>(&text) {
                if let Some(msg_type) = json.get("type").and_then(|v| v.as_str()) {
                    match msg_type {
                        "pong" => continue,
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
                        "quickbutton" => {
                            if let Some(id) = json.get("id").and_then(|v| v.as_str()) {
                                if let Err(e) = app_handle.emit(
                                    COMPANION_QUICKBUTTON_EVENT,
                                    CompanionQuickButtonPayload { id: id.to_string() },
                                ) {
                                    warn!("Failed to emit companion quickbutton: {e}");
                                }
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
                CompanionCommandPayload { command: text },
            ) {
                warn!("Failed to emit companion command: {e}");
                break;
            }
        }
    });

    // Whichever side finishes first decides the socket is done. The send side
    // always owns the goodbye: it either already sent Close on its own way
    // out, or is asked to send it now.
    tokio::select! {
        _ = &mut send_task => {
            recv_task.abort();
        }
        _ = &mut recv_task => {
            let _ = close_tx.send(());
            if tokio::time::timeout(CLOSE_GRACE, &mut send_task).await.is_err() {
                send_task.abort();
            }
        }
    }
}
