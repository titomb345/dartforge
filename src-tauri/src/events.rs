use serde::{Deserialize, Serialize};

pub const MUD_OUTPUT_EVENT: &str = "mud:output";
pub const CONNECTION_STATUS_EVENT: &str = "mud:connection-status";

#[derive(Clone, Serialize, Deserialize)]
pub struct MudOutputPayload {
    pub data: String,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct ConnectionStatusPayload {
    pub connected: bool,
    pub message: String,
}
