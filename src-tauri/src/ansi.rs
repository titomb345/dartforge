/// Telnet protocol constants
const IAC: u8 = 0xFF;
const WILL: u8 = 0xFB;
const WONT: u8 = 0xFC;
const DO: u8 = 0xFD;
const DONT: u8 = 0xFE;
const SB: u8 = 0xFA;
const SE: u8 = 0xF0;

/// Result of processing raw MUD output.
/// Contains the display text (with IAC stripped), any Telnet responses to send back,
/// and any leftover bytes from incomplete IAC sequences at the end of the buffer.
pub struct ProcessedOutput {
    pub display: String,
    pub responses: Vec<Vec<u8>>,
    /// Unconsumed bytes from a partial IAC sequence at the end of the buffer.
    /// Must be prepended to the next read.
    pub remainder: Vec<u8>,
}

/// Process raw bytes from the MUD server.
/// Strips Telnet IAC sequences and generates appropriate responses.
/// Passes ANSI escape sequences through for xterm.js to render.
/// Returns any trailing partial IAC sequence as `remainder` for reassembly.
pub fn process_output(raw: &[u8]) -> ProcessedOutput {
    let mut display_bytes: Vec<u8> = Vec::with_capacity(raw.len());
    let mut responses: Vec<Vec<u8>> = Vec::new();
    let mut i = 0;

    while i < raw.len() {
        if raw[i] == IAC {
            // Not enough bytes to determine the IAC command — save as remainder
            if i + 1 >= raw.len() {
                return ProcessedOutput {
                    display: String::from_utf8_lossy(&display_bytes).into_owned(),
                    responses,
                    remainder: raw[i..].to_vec(),
                };
            }

            match raw[i + 1] {
                // Double IAC = literal 0xFF byte
                IAC => {
                    display_bytes.push(IAC);
                    i += 2;
                }
                // 3-byte negotiations: DO, WILL, WONT, DONT
                DO | WILL | WONT | DONT => {
                    if i + 2 >= raw.len() {
                        // Incomplete 3-byte sequence — save as remainder
                        return ProcessedOutput {
                            display: String::from_utf8_lossy(&display_bytes).into_owned(),
                            responses,
                            remainder: raw[i..].to_vec(),
                        };
                    }
                    let cmd = raw[i + 1];
                    let option = raw[i + 2];
                    match cmd {
                        DO => responses.push(vec![IAC, WONT, option]),
                        WILL => responses.push(vec![IAC, DONT, option]),
                        _ => {} // WONT/DONT — just acknowledge by skipping
                    }
                    i += 3;
                }
                // Subnegotiation — skip until IAC SE
                SB => {
                    // Search for the IAC SE terminator
                    let mut found_se = false;
                    let mut j = i + 2;
                    while j < raw.len() {
                        if raw[j] == IAC && j + 1 < raw.len() && raw[j + 1] == SE {
                            i = j + 2;
                            found_se = true;
                            break;
                        }
                        j += 1;
                    }
                    if !found_se {
                        // Incomplete subnegotiation — save everything from IAC SB onward
                        return ProcessedOutput {
                            display: String::from_utf8_lossy(&display_bytes).into_owned(),
                            responses,
                            remainder: raw[i..].to_vec(),
                        };
                    }
                }
                // Other 2-byte IAC commands (NOP, GA, EOR, etc.) — skip
                _ => {
                    i += 2;
                }
            }
        } else {
            display_bytes.push(raw[i]);
            i += 1;
        }
    }

    ProcessedOutput {
        display: String::from_utf8_lossy(&display_bytes).into_owned(),
        responses,
        remainder: Vec::new(),
    }
}
