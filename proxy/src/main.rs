mod ansi;

use std::net::ToSocketAddrs;

use futures_util::{SinkExt, StreamExt};
use log::{error, info, warn};
use serde::{Deserialize, Serialize};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::mpsc;
use tokio::time::{timeout, Duration};
use tokio_tungstenite::tungstenite::Message;

const MUD_HOST: &str = "dartmud.com";
const MUD_PORT: u16 = 2525;
const READ_BUF_SIZE: usize = 4096;
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
const MAX_RETRIES: u32 = 3;
const RETRY_DELAY: Duration = Duration::from_secs(2);

#[derive(Deserialize)]
struct ClientMessage {
    #[serde(rename = "type")]
    msg_type: String,
    data: Option<String>,
}

#[derive(Serialize)]
struct ServerMessage {
    #[serde(rename = "type")]
    msg_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    data: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    ga: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    connected: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    message: Option<String>,
}

impl ServerMessage {
    fn output(data: String, ga: bool) -> Self {
        Self {
            msg_type: "output".to_string(),
            data: Some(data),
            ga: Some(ga),
            connected: None,
            message: None,
        }
    }

    fn status(connected: bool, message: String) -> Self {
        Self {
            msg_type: "status".to_string(),
            data: None,
            ga: None,
            connected: Some(connected),
            message: Some(message),
        }
    }
}

#[tokio::main]
async fn main() {
    env_logger::init();
    let addr = std::env::var("BIND_ADDR").unwrap_or_else(|_| "0.0.0.0:8080".to_string());
    let listener = TcpListener::bind(&addr).await.expect("Failed to bind");
    info!("Proxy listening on {addr}");

    while let Ok((stream, peer)) = listener.accept().await {
        info!("New connection from {peer}");
        tokio::spawn(handle_connection(stream));
    }
}

async fn handle_connection(stream: TcpStream) {
    let ws_stream = match tokio_tungstenite::accept_async(stream).await {
        Ok(ws) => ws,
        Err(e) => {
            error!("WebSocket handshake failed: {e}");
            return;
        }
    };

    let (mut ws_sender, mut ws_receiver) = ws_stream.split();

    // Channel for sending messages to the WebSocket client
    let (ws_tx, mut ws_rx) = mpsc::channel::<ServerMessage>(100);

    // Spawn a task to forward messages from the channel to the WebSocket
    let ws_send_task = tokio::spawn(async move {
        while let Some(msg) = ws_rx.recv().await {
            let json = match serde_json::to_string(&msg) {
                Ok(j) => j,
                Err(e) => {
                    error!("Failed to serialize message: {e}");
                    continue;
                }
            };
            if ws_sender.send(Message::Text(json.into())).await.is_err() {
                break;
            }
        }
    });

    // Connect to MUD and run the session
    run_session(&mut ws_receiver, &ws_tx).await;

    // Clean up
    ws_send_task.abort();
}

async fn connect_to_mud(ws_tx: &mpsc::Sender<ServerMessage>) -> Option<TcpStream> {
    let addr = format!("{MUD_HOST}:{MUD_PORT}");

    let _ = ws_tx
        .send(ServerMessage::status(false, format!("Connecting to {addr}...")))
        .await;

    // Resolve DNS
    let addrs: Vec<_> = match tokio::task::spawn_blocking(move || {
        format!("{MUD_HOST}:{MUD_PORT}").to_socket_addrs()
    })
    .await
    {
        Ok(Ok(iter)) => iter.collect(),
        _ => {
            let _ = ws_tx
                .send(ServerMessage::status(false, "DNS resolution failed".to_string()))
                .await;
            return None;
        }
    };

    // Try connecting with retries
    for attempt in 1..=MAX_RETRIES {
        for resolved_addr in &addrs {
            info!("Connection attempt {attempt}/{MAX_RETRIES} to {resolved_addr}");
            match timeout(CONNECT_TIMEOUT, TcpStream::connect(resolved_addr)).await {
                Ok(Ok(stream)) => {
                    info!("Connected to {addr} ({resolved_addr})");
                    let _ = ws_tx
                        .send(ServerMessage::status(true, format!("Connected to {addr}")))
                        .await;
                    return Some(stream);
                }
                Ok(Err(e)) => warn!("Failed to connect to {resolved_addr}: {e}"),
                Err(_) => warn!("Connection to {resolved_addr} timed out"),
            }
        }
        if attempt < MAX_RETRIES {
            let _ = ws_tx
                .send(ServerMessage::status(
                    false,
                    format!("Connection failed, retrying ({attempt}/{MAX_RETRIES})..."),
                ))
                .await;
            tokio::time::sleep(RETRY_DELAY).await;
        }
    }

    let _ = ws_tx
        .send(ServerMessage::status(
            false,
            format!("Failed to connect after {MAX_RETRIES} attempts"),
        ))
        .await;
    None
}

async fn run_session(
    ws_receiver: &mut (impl StreamExt<Item = Result<Message, tokio_tungstenite::tungstenite::Error>> + Unpin),
    ws_tx: &mpsc::Sender<ServerMessage>,
) {
    // Send initial disconnected status — wait for client to request connection
    let _ = ws_tx
        .send(ServerMessage::status(false, "Ready to connect".to_string()))
        .await;

    // Wait for "reconnect" messages to initiate MUD connections.
    // After a MUD session ends (disconnect/server drop), loop back here.
    loop {
        match ws_receiver.next().await {
            Some(Ok(Message::Text(text))) => {
                let Ok(client_msg) = serde_json::from_str::<ClientMessage>(&text) else {
                    continue;
                };
                if client_msg.msg_type == "reconnect" {
                    if let Some(mud_stream) = connect_to_mud(ws_tx).await {
                        run_mud_loop(ws_receiver, ws_tx, mud_stream).await;
                    }
                    // MUD session ended — continue waiting for next reconnect
                }
            }
            Some(Ok(Message::Close(_))) | None => return,
            _ => {}
        }
    }
}

async fn run_mud_loop(
    ws_receiver: &mut (impl StreamExt<Item = Result<Message, tokio_tungstenite::tungstenite::Error>> + Unpin),
    ws_tx: &mpsc::Sender<ServerMessage>,
    mud_stream: TcpStream,
) {
    let (mut mud_reader, mut mud_writer) = mud_stream.into_split();

    // Channel for writing to the MUD TCP connection
    let (mud_write_tx, mut mud_write_rx) = mpsc::channel::<Vec<u8>>(100);
    let mud_write_tx_for_cmds = mud_write_tx.clone();

    // Spawn MUD write task
    let mud_write_task = tokio::spawn(async move {
        while let Some(data) = mud_write_rx.recv().await {
            if mud_writer.write_all(&data).await.is_err() {
                break;
            }
        }
    });

    // Spawn MUD read task — reads from TCP, processes IAC, sends to WebSocket
    let ws_tx_for_read = ws_tx.clone();
    let mud_read_task = tokio::spawn(async move {
        let mut buf = vec![0u8; READ_BUF_SIZE];
        let mut remainder: Vec<u8> = Vec::new();

        loop {
            match mud_reader.read(&mut buf).await {
                Ok(0) => {
                    info!("MUD connection closed by server");
                    let _ = ws_tx_for_read
                        .send(ServerMessage::status(false, "Disconnected".to_string()))
                        .await;
                    break;
                }
                Ok(n) => {
                    let input = if remainder.is_empty() {
                        buf[..n].to_vec()
                    } else {
                        let mut combined = std::mem::take(&mut remainder);
                        combined.extend_from_slice(&buf[..n]);
                        combined
                    };

                    let processed = ansi::process_output(&input);
                    remainder = processed.remainder;

                    // Send IAC responses back to MUD
                    for response in processed.responses {
                        if mud_write_tx.send(response).await.is_err() {
                            return;
                        }
                    }

                    // Send display text to WebSocket client
                    if !processed.display.is_empty() {
                        if ws_tx_for_read
                            .send(ServerMessage::output(processed.display, processed.ga))
                            .await
                            .is_err()
                        {
                            return;
                        }
                    }
                }
                Err(e) => {
                    error!("MUD read error: {e}");
                    let _ = ws_tx_for_read
                        .send(ServerMessage::status(false, "Disconnected".to_string()))
                        .await;
                    break;
                }
            }
        }
    });

    // Process WebSocket messages from the browser
    loop {
        tokio::select! {
            msg = ws_receiver.next() => {
                match msg {
                    Some(Ok(Message::Text(text))) => {
                        let Ok(client_msg) = serde_json::from_str::<ClientMessage>(&text) else {
                            continue;
                        };
                        match client_msg.msg_type.as_str() {
                            "command" => {
                                if let Some(data) = client_msg.data {
                                    let cmd = format!("{data}\r\n");
                                    if mud_write_tx_for_cmds.send(cmd.into_bytes()).await.is_err() {
                                        break;
                                    }
                                }
                            }
                            "disconnect" => {
                                break;
                            }
                            "reconnect" => {
                                // Drop current connection and reconnect
                                mud_read_task.abort();
                                mud_write_task.abort();
                                if let Some(new_stream) = connect_to_mud(ws_tx).await {
                                    // Recurse with new connection
                                    return Box::pin(run_mud_loop(ws_receiver, ws_tx, new_stream)).await;
                                }
                                return;
                            }
                            _ => {}
                        }
                    }
                    Some(Ok(Message::Close(_))) | None => break,
                    _ => {}
                }
            }
            _ = mud_read_task.is_finished_signal() => {
                // MUD read ended (server disconnected)
                break;
            }
        }
    }

    mud_read_task.abort();
    mud_write_task.abort();
}

/// Helper trait to detect when a JoinHandle has completed.
trait JoinHandleExt {
    fn is_finished_signal(&self) -> impl std::future::Future<Output = ()>;
}

impl<T> JoinHandleExt for tokio::task::JoinHandle<T> {
    async fn is_finished_signal(&self) {
        while !self.is_finished() {
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
    }
}
