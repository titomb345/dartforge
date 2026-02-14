/// Process raw bytes from the MUD server into a displayable string.
/// For now this is a simple passthrough — xterm.js handles ANSI rendering.
/// Future home for DartMUD-specific parsing (e.g., stripping Telnet IAC sequences).
pub fn process_output(raw: &[u8]) -> String {
    String::from_utf8_lossy(raw).into_owned()
}
