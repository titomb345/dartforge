import { useRef, useCallback, useEffect } from 'react';
import { stripAnsi } from '../lib/ansiUtils';
import { getPlatform } from '../lib/platform';
import type { TimestampFormat } from './useAppSettings';

let invoke: ((cmd: string, args?: Record<string, unknown>) => Promise<unknown>) | null = null;
if (getPlatform() === 'tauri') {
  import('@tauri-apps/api/core').then((m) => { invoke = m.invoke; }).catch(() => {});
}

function formatTimestamp(format: TimestampFormat): string {
  const d = new Date();
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const da = String(d.getDate()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  const s = String(d.getSeconds()).padStart(2, '0');
  if (format === '12h') {
    const hr = d.getHours();
    const h12 = hr % 12 || 12;
    const ampm = hr < 12 ? 'AM' : 'PM';
    return `${y}-${mo}-${da} ${h12}:${mi}:${s} ${ampm}`;
  }
  const h = String(d.getHours()).padStart(2, '0');
  return `${y}-${mo}-${da} ${h}:${mi}:${s}`;
}

function generateLogFilename(): string {
  const d = new Date();
  const ts = d.toISOString().replace(/[:.]/g, '-').replace('Z', '');
  return `session_${ts}.log`;
}

export function useSessionLogger(enabled: boolean, passwordMode: boolean, timestampFormat: TimestampFormat) {
  const filenameRef = useRef<string | null>(null);
  const bufferRef = useRef<string[]>([]);
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const passwordModeRef = useRef(passwordMode);
  passwordModeRef.current = passwordMode;
  const formatRef = useRef(timestampFormat);
  formatRef.current = timestampFormat;
  // Buffer for partial ANSI escape sequences split across TCP chunks
  const partialAnsiRef = useRef('');

  const flush = useCallback(() => {
    if (!invoke || !filenameRef.current || bufferRef.current.length === 0) return;
    const content = bufferRef.current.join('');
    bufferRef.current = [];
    invoke('append_to_log', {
      subdir: 'sessions',
      filename: filenameRef.current,
      content,
    }).catch(console.error);
  }, []);

  const scheduleFlush = useCallback(() => {
    if (flushTimerRef.current) return;
    flushTimerRef.current = setTimeout(() => {
      flushTimerRef.current = null;
      flush();
    }, 1000);
  }, [flush]);

  // Create new log file when logging is enabled
  useEffect(() => {
    if (enabled && !filenameRef.current) {
      filenameRef.current = generateLogFilename();
    }
    if (!enabled) {
      flush();
      filenameRef.current = null;
    }
  }, [enabled, flush]);

  // Flush on unmount
  useEffect(() => {
    return () => {
      if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
      flush();
    };
  }, [flush]);

  const logOutput = useCallback((rawData: string) => {
    if (!enabled || !filenameRef.current) return;
    // Prepend any leftover partial ANSI sequence from the previous chunk
    const data = partialAnsiRef.current + rawData;
    partialAnsiRef.current = '';
    // Check if this chunk ends with an incomplete ANSI escape sequence
    // (e.g. \x1b or \x1b[ or \x1b[1;35 — waiting for the final letter)
    const trailingMatch = data.match(/\x1b(\[[\d;]*)?$/);
    let toStrip: string;
    if (trailingMatch) {
      partialAnsiRef.current = trailingMatch[0];
      toStrip = data.slice(0, -trailingMatch[0].length);
    } else {
      toStrip = data;
    }
    const stripped = stripAnsi(toStrip);
    const lines = stripped.split(/\r?\n/);
    for (const line of lines) {
      if (line.trim()) {
        bufferRef.current.push(`[${formatTimestamp(formatRef.current)}] ${line}\n`);
      }
    }
    scheduleFlush();
  }, [enabled, scheduleFlush]);

  const logCommand = useCallback((command: string) => {
    if (!enabled || !filenameRef.current || passwordModeRef.current) return;
    bufferRef.current.push(`[${formatTimestamp(formatRef.current)}] > ${command}\n`);
    scheduleFlush();
  }, [enabled, scheduleFlush]);

  return { logOutput, logCommand };
}
