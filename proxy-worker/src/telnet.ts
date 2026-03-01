// Telnet protocol constants
const IAC = 0xff;
const WILL = 0xfb;
const WONT = 0xfc;
const DO = 0xfd;
const DONT = 0xfe;
const SB = 0xfa;
const SE = 0xf0;
const GA = 0xf9;

export interface ProcessedOutput {
  /** Display text with IAC stripped, ANSI preserved */
  display: string;
  /** Telnet response bytes to send back to the MUD */
  responses: Uint8Array[];
  /** Leftover bytes from incomplete IAC sequence at end of buffer */
  remainder: Uint8Array;
  /** True if IAC GA was received (server awaiting input) */
  ga: boolean;
}

/**
 * Process raw bytes from the MUD server.
 * Strips Telnet IAC sequences and generates appropriate responses.
 * Passes ANSI escape sequences through for xterm.js to render.
 * Returns any trailing partial IAC sequence as `remainder` for reassembly.
 */
export function processOutput(raw: Uint8Array): ProcessedOutput {
  const displayBytes: number[] = [];
  const responses: Uint8Array[] = [];
  let ga = false;
  let i = 0;

  while (i < raw.length) {
    if (raw[i] === IAC) {
      // Not enough bytes to determine the IAC command — save as remainder
      if (i + 1 >= raw.length) {
        return {
          display: new TextDecoder().decode(new Uint8Array(displayBytes)),
          responses,
          remainder: raw.slice(i),
          ga,
        };
      }

      switch (raw[i + 1]) {
        // Double IAC = literal 0xFF byte
        case IAC:
          displayBytes.push(IAC);
          i += 2;
          break;

        // 3-byte negotiations: DO, WILL, WONT, DONT
        case DO:
        case WILL:
        case WONT:
        case DONT: {
          if (i + 2 >= raw.length) {
            // Incomplete 3-byte sequence — save as remainder
            return {
              display: new TextDecoder().decode(new Uint8Array(displayBytes)),
              responses,
              remainder: raw.slice(i),
              ga,
            };
          }
          const cmd = raw[i + 1];
          const option = raw[i + 2];
          if (cmd === DO) {
            responses.push(new Uint8Array([IAC, WONT, option]));
          } else if (cmd === WILL) {
            responses.push(new Uint8Array([IAC, DONT, option]));
          }
          // WONT/DONT — just acknowledge by skipping
          i += 3;
          break;
        }

        // Subnegotiation — skip until IAC SE
        case SB: {
          let foundSe = false;
          let j = i + 2;
          while (j < raw.length) {
            if (raw[j] === IAC && j + 1 < raw.length && raw[j + 1] === SE) {
              i = j + 2;
              foundSe = true;
              break;
            }
            j++;
          }
          if (!foundSe) {
            // Incomplete subnegotiation — save everything from IAC SB onward
            return {
              display: new TextDecoder().decode(new Uint8Array(displayBytes)),
              responses,
              remainder: raw.slice(i),
              ga,
            };
          }
          break;
        }

        // Go Ahead — server is done sending, prompt is ready
        case GA:
          ga = true;
          i += 2;
          break;

        // Other 2-byte IAC commands (NOP, EOR, etc.) — skip
        default:
          i += 2;
          break;
      }
    } else {
      displayBytes.push(raw[i]);
      i++;
    }
  }

  return {
    display: new TextDecoder().decode(new Uint8Array(displayBytes)),
    responses,
    remainder: new Uint8Array(0),
    ga,
  };
}
