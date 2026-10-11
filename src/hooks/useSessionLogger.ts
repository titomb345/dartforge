import { useRef, useCallback, useEffect } from 'react';
import { getPlatform } from '../lib/platform';
import { SessionLogWriter } from '../lib/sessionLog';
import type { TimestampFormat } from './useAppSettings';

let invoke: ((cmd: string, args?: Record<string, unknown>) => Promise<unknown>) | null = null;
if (getPlatform() === 'tauri') {
  import('@tauri-apps/api/core')
    .then((m) => {
      invoke = m.invoke;
    })
    .catch(() => {});
}

function generateLogFilename(): string {
  const d = new Date();
  const ts = d.toISOString().replace(/[:.]/g, '-').replace('Z', '');
  return `session_${ts}.log`;
}

/** Writes to <data dir>/sessions/<filename> once the Tauri API has loaded */
function appendToLog(filename: string, content: string): boolean {
  if (!invoke) return false;
  invoke('append_to_log', { subdir: 'sessions', filename, content }).catch(console.error);
  return true;
}

/**
 * Session logger — the log format and why it is cut the way it is are in
 * lib/sessionLog.ts: output lines exactly as the parsers see them (whole,
 * blank ones kept), typed input, and every command as actually sent. The
 * state and its rules live in SessionLogWriter (tested without React);
 * this hook only drives it. Keep timers out of the hook: React.StrictMode
 * runs the unmount cleanup once at mount, and a timer handle the hook kept
 * across it stopped every dev session's log from being written (see
 * SessionLogWriter).
 */
export function useSessionLogger(
  enabled: boolean,
  passwordMode: boolean,
  timestampFormat: TimestampFormat,
  /** The MUD connection: a line cut off by a disconnect is logged as is */
  connected = true
) {
  const writerRef = useRef<SessionLogWriter | null>(null);
  if (!writerRef.current) {
    writerRef.current = new SessionLogWriter({
      append: appendToLog,
      newFilename: generateLogFilename,
    });
  }
  const writer = writerRef.current;
  writer.passwordMode = passwordMode;
  writer.stampFormat = timestampFormat;

  // Open a new log file when logging is enabled; write and close it when not
  useEffect(() => {
    writer.setEnabled(enabled);
  }, [writer, enabled]);

  // A dropped connection completes no line: the next session's output must
  // not be glued onto the last one's unfinished line
  useEffect(() => {
    if (!connected) writer.connectionLost();
  }, [writer, connected]);

  // Write everything on unmount
  useEffect(() => () => writer.close(), [writer]);

  const logOutput = useCallback(
    (rawData: string) => {
      if (enabled) writer.output(rawData);
    },
    [writer, enabled]
  );

  const logCommand = useCallback(
    (command: string) => {
      if (enabled) writer.typed(command);
    },
    [writer, enabled]
  );

  /** A command as it actually went out (see lib/sessionLog.ts) */
  const logSent = useCallback(
    (command: string) => {
      if (enabled) writer.sent(command);
    },
    [writer, enabled]
  );

  return { logOutput, logCommand, logSent };
}
