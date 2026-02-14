use log::{error, info};
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::sync::mpsc;

use crate::ansi;
use crate::events::{ConnectionStatusPayload, MudOutputPayload, CONNECTION_STATUS_EVENT, MUD_OUTPUT_EVENT};

const MUD_HOST: &str = "dartmud.com";
const MUD_PORT: u16 = 2525;
const READ_BUF_SIZE: usize = 4096;

pub async fn connect(app: AppHandle, mut cmd_rx: mpsc::Receiver<String>) {
    let addr = format!("{}:{}", MUD_HOST, MUD_PORT);
    info!("Connecting to {}...", addr);

    let _ = app.emit(
        CONNECTION_STATUS_EVENT,
        ConnectionStatusPayload {
            connected: false,
            message: format!("Connecting to {}...", addr),
        },
    );

    let stream = match TcpStream::connect(&addr).await {
        Ok(s) => {
            info!("Connected to {}", addr);
            let _ = app.emit(
                CONNECTION_STATUS_EVENT,
                ConnectionStatusPayload {
                    connected: true,
                    message: format!("Connected to {}", addr),
                },
            );
            s
        }
        Err(e) => {
            error!("Failed to connect to {}: {}", addr, e);
            let _ = app.emit(
                CONNECTION_STATUS_EVENT,
                ConnectionStatusPayload {
                    connected: false,
                    message: format!("Failed to connect: {}", e),
                },
            );
            return;
        }
    };

    let (mut reader, mut writer) = stream.into_split();

    // Spawn write loop
    let write_handle = tokio::spawn(async move {
        while let Some(cmd) = cmd_rx.recv().await {
            let data = format!("{}\r\n", cmd);
            if let Err(e) = writer.write_all(data.as_bytes()).await {
                error!("Write error: {}", e);
                break;
            }
        }
    });

    // Read loop
    let mut buf = vec![0u8; READ_BUF_SIZE];
    loop {
        match reader.read(&mut buf).await {
            Ok(0) => {
                info!("Connection closed by server");
                break;
            }
            Ok(n) => {
                let output = ansi::process_output(&buf[..n]);
                let _ = app.emit(MUD_OUTPUT_EVENT, MudOutputPayload { data: output });
            }
            Err(e) => {
                error!("Read error: {}", e);
                break;
            }
        }
    }

    write_handle.abort();

    let _ = app.emit(
        CONNECTION_STATUS_EVENT,
        ConnectionStatusPayload {
            connected: false,
            message: "Disconnected".to_string(),
        },
    );
}
