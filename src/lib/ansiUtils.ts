/** Regex matching ANSI CSI escape sequences (colors, cursor movement, etc.) */
const ANSI_CSI_RE = /\x1b\[[0-9;]*[A-Za-z]/g;

/** Strip all ANSI escape sequences from text. */
export function stripAnsi(data: string): string {
  return data.replace(ANSI_CSI_RE, '');
}
