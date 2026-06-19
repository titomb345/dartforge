use std::net::ToSocketAddrs;
use log::{error, info, warn};
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::sync::mpsc;
use tokio::time::{timeout, Duration};

use std::sync::Arc;
use tokio::sync::Mutex as TokioMutex;

use crate::ansi;
use crate::companion::CompanionMessage;
use crate::events::{ConnectionStatusPayload, MudOutputPayload, CONNECTION_STATUS_EVENT, MUD_OUTPUT_EVENT};

/// Shared type for tracking the last connection status.
pub type LastStatus = Arc<TokioMutex<Option<(bool, String)>>>;

fn set_status(last_status: &LastStatus, connected: bool, message: &str) {
    // Use try_lock to avoid blocking — best-effort update
    if let Ok(mut guard) = last_status.try_lock() {
        *guard = Some((connected, message.to_string()));
    }
}

const MUD_HOST: &str = "dartmud.com";
const MUD_PORT: u16 = 2525;
const READ_BUF_SIZE: usize = 4096;
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
const MAX_RETRIES: u32 = 3;
const RETRY_DELAY: Duration = Duration::from_secs(2);
/// Max time a single write may block before we treat the connection as stalled.
/// Commands are tiny, so a write that can't drain in this window means the
/// socket is half-open (server gone / TCP backpressure with no drain) and the
/// connection should be torn down rather than silently swallowing input.
const WRITE_TIMEOUT: Duration = Duration::from_secs(10);

pub async fn connect(
    app: AppHandle,
    mut cmd_rx: mpsc::Receiver<String>,
    broadcast_tx: tokio::sync::broadcast::Sender<CompanionMessage>,
    last_status: LastStatus,
) {
    let addr = format!("{MUD_HOST}:{MUD_PORT}");
    info!("Connecting to {addr}...");

    let msg = format!("Connecting to {addr}...");
    let _ = app.emit(CONNECTION_STATUS_EVENT, ConnectionStatusPayload { connected: false, message: msg.clone() });
    let _ = broadcast_tx.send(CompanionMessage::ConnectionStatus { connected: false, message: msg.clone() });
    set_status(&last_status, false, &msg);

    // Resolve DNS on a blocking thread to get the actual IP address
    let resolved = tokio::task::spawn_blocking(move || {
        format!("{MUD_HOST}:{MUD_PORT}").to_socket_addrs()
    }).await;

    let addrs: Vec<_> = match resolved {
        Ok(Ok(iter)) => iter.collect(),
        Ok(Err(e)) => {
            error!("DNS resolution failed for {addr}: {e}");
            let msg = format!("DNS resolution failed: {e}");
            let _ = app.emit(CONNECTION_STATUS_EVENT, ConnectionStatusPayload { connected: false, message: msg.clone() });
            let _ = broadcast_tx.send(CompanionMessage::ConnectionStatus { connected: false, message: msg.clone() });
            set_status(&last_status, false, &msg);
            return;
        }
        Err(e) => {
            error!("DNS resolution task failed: {e}");
            let msg = format!("DNS resolution failed: {e}");
            let _ = app.emit(CONNECTION_STATUS_EVENT, ConnectionStatusPayload { connected: false, message: msg.clone() });
            let _ = broadcast_tx.send(CompanionMessage::ConnectionStatus { connected: false, message: msg.clone() });
            set_status(&last_status, false, &msg);
            return;
        }
    };

    info!("Resolved {addr} to {addrs:?}");

    let mut stream: Option<TcpStream> = None;
    for attempt in 1..=MAX_RETRIES {
        for resolved_addr in &addrs {
            info!("Connection attempt {attempt}/{MAX_RETRIES} to {resolved_addr}");
            match timeout(CONNECT_TIMEOUT, TcpStream::connect(resolved_addr)).await {
                Ok(Ok(s)) => {
                    info!("Connected to {addr} ({resolved_addr})");
                    stream = Some(s);
                    break;
                }
                Ok(Err(e)) => {
                    warn!("Failed to connect to {resolved_addr}: {e}");
                }
                Err(_) => {
                    warn!("Connection to {resolved_addr} timed out after {}s", CONNECT_TIMEOUT.as_secs());
                }
            }
        }
        if stream.is_some() {
            break;
        }
        if attempt < MAX_RETRIES {
            info!("Retrying in {}s...", RETRY_DELAY.as_secs());
            let msg = format!("Connection failed, retrying ({attempt}/{MAX_RETRIES})...");
            let _ = app.emit(CONNECTION_STATUS_EVENT, ConnectionStatusPayload { connected: false, message: msg.clone() });
            let _ = broadcast_tx.send(CompanionMessage::ConnectionStatus { connected: false, message: msg.clone() });
            set_status(&last_status, false, &msg);
            tokio::time::sleep(RETRY_DELAY).await;
        }
    }

    let stream = match stream {
        Some(s) => {
            let msg = format!("Connected to {addr}");
            let _ = app.emit(CONNECTION_STATUS_EVENT, ConnectionStatusPayload { connected: true, message: msg.clone() });
            let _ = broadcast_tx.send(CompanionMessage::ConnectionStatus { connected: true, message: msg.clone() });
            set_status(&last_status, true, &msg);
            s
        }
        None => {
            error!("Failed to connect to {addr} after {MAX_RETRIES} attempts");
            let msg = format!("Failed to connect after {MAX_RETRIES} attempts");
            let _ = app.emit(CONNECTION_STATUS_EVENT, ConnectionStatusPayload { connected: false, message: msg.clone() });
            let _ = broadcast_tx.send(CompanionMessage::ConnectionStatus { connected: false, message: msg.clone() });
            set_status(&last_status, false, &msg);
            return;
        }
    };

    let (mut reader, mut writer) = stream.into_split();

    // Channel for sending data to the writer (both user commands and telnet responses)
    let (write_tx, mut write_rx) = mpsc::channel::<Vec<u8>>(100);
    let write_tx_for_cmds = write_tx.clone();

    // Spawn write loop — handles both user commands and telnet responses.
    // Each write is bounded by WRITE_TIMEOUT so a stalled/half-open socket
    // tears the task down instead of blocking forever (which would leave the
    // connection looking healthy while silently dropping commands).
    let mut write_handle = tokio::spawn(async move {
        while let Some(data) = write_rx.recv().await {
            match timeout(WRITE_TIMEOUT, writer.write_all(&data)).await {
                Ok(Ok(())) => {}
                Ok(Err(e)) => {
                    error!("Write error: {e}");
                    break;
                }
                Err(_) => {
                    error!(
                        "Write stalled (>{}s); treating connection as dead",
                        WRITE_TIMEOUT.as_secs()
                    );
                    break;
                }
            }
        }
    });

    // Forward user commands to the write channel
    let cmd_handle = tokio::spawn(async move {
        while let Some(cmd) = cmd_rx.recv().await {
            let mut data = Vec::with_capacity(cmd.len() + 2);
            data.extend_from_slice(cmd.as_bytes());
            data.extend_from_slice(b"\r\n");
            if write_tx_for_cmds.send(data).await.is_err() {
                break;
            }
        }
    });

    // Read loop — remainder holds partial IAC sequences between reads
    let mut buf = vec![0u8; READ_BUF_SIZE];
    let mut remainder: Vec<u8> = Vec::new();
    loop {
        let read_result = tokio::select! {
            result = reader.read(&mut buf) => result,
            _ = &mut write_handle => {
                // Writer task exited (write error or stall). Output may still be
                // arriving, but we can no longer send commands — tear the
                // connection down so a disconnect is surfaced and the normal
                // reconnect path can run, rather than appearing healthy while
                // silently dropping input.
                warn!("Writer task exited; tearing down half-open connection");
                break;
            }
        };

        match read_result {
            Ok(0) => {
                info!("Connection closed by server");
                break;
            }
            Ok(n) => {
                // Prepend any leftover bytes from the previous read
                // Reuse remainder's allocation when possible to avoid per-read Vec allocs
                let input = if remainder.is_empty() {
                    // Fast path: borrow buf directly via a temporary vec
                    buf[..n].to_vec()
                } else {
                    let mut combined = std::mem::take(&mut remainder);
                    combined.extend_from_slice(&buf[..n]);
                    combined
                };

                let processed = ansi::process_output(&input);
                remainder = processed.remainder;

                // Send telnet responses back to server
                for response in processed.responses {
                    if write_tx.send(response).await.is_err() {
                        break;
                    }
                }

                // Emit display text to frontend (companion gets post-gag output from frontend)
                if !processed.display.is_empty() {
                    let _ = app.emit(MUD_OUTPUT_EVENT, MudOutputPayload { data: processed.display, ga: processed.ga });
                }
            }
            Err(e) => {
                error!("Read error: {e}");
                break;
            }
        }
    }

    cmd_handle.abort();
    write_handle.abort();

    let _ = app.emit(
        CONNECTION_STATUS_EVENT,
        ConnectionStatusPayload {
            connected: false,
            message: "Disconnected".to_string(),
        },
    );
    let _ = broadcast_tx.send(CompanionMessage::ConnectionStatus {
        connected: false,
        message: "Disconnected".to_string(),
    });
    set_status(&last_status, false, "Disconnected");
}
