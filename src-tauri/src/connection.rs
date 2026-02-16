use std::net::ToSocketAddrs;
use log::{error, info, warn};
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::sync::mpsc;
use tokio::time::{timeout, Duration};

use crate::ansi;
use crate::events::{ConnectionStatusPayload, MudOutputPayload, CONNECTION_STATUS_EVENT, MUD_OUTPUT_EVENT};

const MUD_HOST: &str = "dartmud.com";
const MUD_PORT: u16 = 2525;
const READ_BUF_SIZE: usize = 4096;
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
const MAX_RETRIES: u32 = 3;
const RETRY_DELAY: Duration = Duration::from_secs(2);

pub async fn connect(app: AppHandle, mut cmd_rx: mpsc::Receiver<String>) {
    let addr = format!("{MUD_HOST}:{MUD_PORT}");
    info!("Connecting to {addr}...");

    let _ = app.emit(
        CONNECTION_STATUS_EVENT,
        ConnectionStatusPayload {
            connected: false,
            message: format!("Connecting to {addr}..."),
        },
    );

    // Resolve DNS on a blocking thread to get the actual IP address
    let resolved = tokio::task::spawn_blocking(move || {
        format!("{MUD_HOST}:{MUD_PORT}").to_socket_addrs()
    }).await;

    let addrs: Vec<_> = match resolved {
        Ok(Ok(iter)) => iter.collect(),
        Ok(Err(e)) => {
            error!("DNS resolution failed for {addr}: {e}");
            let _ = app.emit(
                CONNECTION_STATUS_EVENT,
                ConnectionStatusPayload {
                    connected: false,
                    message: format!("DNS resolution failed: {e}"),
                },
            );
            return;
        }
        Err(e) => {
            error!("DNS resolution task failed: {e}");
            let _ = app.emit(
                CONNECTION_STATUS_EVENT,
                ConnectionStatusPayload {
                    connected: false,
                    message: format!("DNS resolution failed: {e}"),
                },
            );
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
            let _ = app.emit(
                CONNECTION_STATUS_EVENT,
                ConnectionStatusPayload {
                    connected: false,
                    message: format!("Connection failed, retrying ({attempt}/{MAX_RETRIES})..."),
                },
            );
            tokio::time::sleep(RETRY_DELAY).await;
        }
    }

    let stream = match stream {
        Some(s) => {
            let _ = app.emit(
                CONNECTION_STATUS_EVENT,
                ConnectionStatusPayload {
                    connected: true,
                    message: format!("Connected to {addr}"),
                },
            );
            s
        }
        None => {
            error!("Failed to connect to {addr} after {MAX_RETRIES} attempts");
            let _ = app.emit(
                CONNECTION_STATUS_EVENT,
                ConnectionStatusPayload {
                    connected: false,
                    message: format!("Failed to connect after {MAX_RETRIES} attempts"),
                },
            );
            return;
        }
    };

    let (mut reader, mut writer) = stream.into_split();

    // Channel for sending data to the writer (both user commands and telnet responses)
    let (write_tx, mut write_rx) = mpsc::channel::<Vec<u8>>(100);
    let write_tx_for_cmds = write_tx.clone();

    // Spawn write loop — handles both user commands and telnet responses
    let write_handle = tokio::spawn(async move {
        while let Some(data) = write_rx.recv().await {
            if let Err(e) = writer.write_all(&data).await {
                error!("Write error: {e}");
                break;
            }
        }
    });

    // Forward user commands to the write channel
    let cmd_handle = tokio::spawn(async move {
        while let Some(cmd) = cmd_rx.recv().await {
            let data = format!("{cmd}\r\n");
            if write_tx_for_cmds.send(data.into_bytes()).await.is_err() {
                break;
            }
        }
    });

    // Read loop — remainder holds partial IAC sequences between reads
    let mut buf = vec![0u8; READ_BUF_SIZE];
    let mut remainder: Vec<u8> = Vec::new();
    loop {
        match reader.read(&mut buf).await {
            Ok(0) => {
                info!("Connection closed by server");
                break;
            }
            Ok(n) => {
                // Prepend any leftover bytes from the previous read
                let input = if remainder.is_empty() {
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

                // Emit display text to frontend
                if !processed.display.is_empty() {
                    let _ = app.emit(MUD_OUTPUT_EVENT, MudOutputPayload { data: processed.display });
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
}
