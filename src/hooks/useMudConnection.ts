import { useEffect, useRef, useState, useCallback } from 'react';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import type { Terminal } from '@xterm/xterm';
import { MUD_OUTPUT_EVENT, CONNECTION_STATUS_EVENT } from '../lib/tauriEvents';
import { MudOutputPayload, ConnectionStatusPayload } from '../types';
import { getConnectedSplash, getDisconnectSplash } from '../lib/splash';

/** End marker for the DartMUD ASCII banner */
const BANNER_END_MARKER = 'Ferdarchi';
/** Max bytes to buffer before giving up on banner detection */
const BANNER_MAX_BUFFER = 5000;

/**
 * Detect if data ends with a MUD prompt ("> ") without a trailing newline.
 * When the server sends a prompt, the next response would get jammed onto
 * the same line. Adding a newline after the prompt keeps output clean.
 */
function endsWithPrompt(data: string): boolean {
  // Strip ANSI escape sequences to check the visible text
  const stripped = data.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
  return stripped.endsWith('\n> ') || stripped.endsWith('\r\n> ') || stripped === '> ';
}

/**
 * Write data to terminal with smart auto-scroll.
 * If user has scrolled up to read history, new output won't yank them back.
 * If user is at the bottom, it scrolls normally.
 */
function smartWrite(term: Terminal, data: string) {
  const buffer = term.buffer.active;
  const scrolledUp = buffer.baseY - buffer.viewportY;

  if (scrolledUp <= 0) {
    term.write(data);
  } else {
    term.write(data, () => {
      const newBase = term.buffer.active.baseY;
      term.scrollToLine(newBase - scrolledUp);
    });
  }
}

/** Map a single ANSI SGR code to a human-readable name */
function sgrName(code: number): string | null {
  const FG = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white'];
  if (code >= 30 && code <= 37) return FG[code - 30];
  if (code >= 90 && code <= 97) return 'bright ' + FG[code - 90];
  if (code >= 40 && code <= 47) return 'bg:' + FG[code - 40];
  if (code >= 100 && code <= 107) return 'bg:bright ' + FG[code - 100];
  if (code === 2) return 'dim';
  if (code === 3) return 'italic';
  if (code === 4) return 'underline';
  if (code === 7) return 'reverse';
  return null;
}

/**
 * Annotate ANSI SGR (color) sequences with human-readable tags for debug mode.
 * Shows labels like [bright green] or [magenta] that match the color picker panel.
 * Bold (1) + a normal color is promoted to the bright variant to match terminal behavior.
 */
function annotateAnsi(data: string): string {
  return data.replace(/\x1b\[([0-9;]*)m/g, (match, params) => {
    if (!params || params === '0') return match;

    const codes = params.split(';').map(Number);
    let bold = false;
    const names: string[] = [];

    for (const code of codes) {
      if (code === 0) continue;
      if (code === 1) { bold = true; continue; }
      const name = sgrName(code);
      if (name) names.push(name);
    }

    // Bold + normal foreground color → promote to bright variant
    const finalNames = names.map((n) => {
      if (bold && !n.startsWith('bright') && !n.startsWith('bg:') &&
          !['dim', 'italic', 'underline', 'reverse'].includes(n)) {
        return 'bright ' + n;
      }
      return n;
    });

    if (finalNames.length === 0) return match;
    return `\x1b[2;37m[${finalNames.join(', ')}]\x1b[22m${match}`;
  });
}

export function useMudConnection(
  terminalRef: React.MutableRefObject<Terminal | null>,
  debugModeRef: React.RefObject<boolean>,
) {
  const [connected, setConnected] = useState(false);
  const [statusMessage, setStatusMessage] = useState('Connecting...');
  const [passwordMode, setPasswordMode] = useState(false);
  const [skipHistory, setSkipHistory] = useState(false);
  const unlistenRefs = useRef<(() => void)[]>([]);
  const wasConnectedRef = useRef(false);
  const passwordModeRef = useRef(false);
  const skipHistoryRef = useRef(false);

  // Banner filtering state
  const filteringBannerRef = useRef(false);
  const bannerBufferRef = useRef('');

  useEffect(() => {
    let cancelled = false;

    async function setup() {
      const unlistenOutput = await listen<MudOutputPayload>(MUD_OUTPUT_EVENT, (event) => {
        if (cancelled || !terminalRef.current) return;
        const term = terminalRef.current;

        const detectPrompts = (data: string) => {
          if (/password:/i.test(data)) {
            passwordModeRef.current = true;
            skipHistoryRef.current = true;
            setPasswordMode(true);
            setSkipHistory(true);
          } else if (/name:/i.test(data)) {
            skipHistoryRef.current = true;
            setSkipHistory(true);
          }
        };

        // Banner filtering: suppress the server's ASCII splash on connect
        if (filteringBannerRef.current) {
          bannerBufferRef.current += event.payload.data;

          const markerIdx = bannerBufferRef.current.indexOf(BANNER_END_MARKER);
          if (markerIdx >= 0) {
            // Found end of banner — pass through anything after the marker line
            filteringBannerRef.current = false;
            const lineEnd = bannerBufferRef.current.indexOf('\n', markerIdx);
            const afterBanner =
              lineEnd >= 0 ? bannerBufferRef.current.substring(lineEnd + 1) : '';
            bannerBufferRef.current = '';
            if (afterBanner.length > 0) {
              detectPrompts(afterBanner);
              let afterOutput = debugModeRef.current ? annotateAnsi(afterBanner) : afterBanner;
              if (endsWithPrompt(afterBanner)) {
                afterOutput += '\n';
              }
              smartWrite(term, afterOutput);
            }
          } else if (bannerBufferRef.current.length > BANNER_MAX_BUFFER) {
            // Safety: too much data without finding banner, flush it all
            filteringBannerRef.current = false;
            detectPrompts(bannerBufferRef.current);
            let flushOutput = debugModeRef.current ? annotateAnsi(bannerBufferRef.current) : bannerBufferRef.current;
            if (endsWithPrompt(bannerBufferRef.current)) {
              flushOutput += '\n';
            }
            smartWrite(term, flushOutput);
            bannerBufferRef.current = '';
          }
          return;
        }

        let output = debugModeRef.current ? annotateAnsi(event.payload.data) : event.payload.data;
        if (endsWithPrompt(event.payload.data)) {
          output += '\n';
        }
        detectPrompts(event.payload.data);
        smartWrite(term, output);
      });

      const unlistenStatus = await listen<ConnectionStatusPayload>(
        CONNECTION_STATUS_EVENT,
        (event) => {
          if (!cancelled) {
            const term = terminalRef.current;

            if (event.payload.connected && !wasConnectedRef.current && term) {
              // Just connected — clear terminal, show our splash, start filtering banner
              term.clear();
              term.write(getConnectedSplash(term.cols));
              filteringBannerRef.current = true;
              bannerBufferRef.current = '';
            } else if (!event.payload.connected && wasConnectedRef.current && term) {
              // Connection dropped — stop any active filtering, show disconnect splash
              filteringBannerRef.current = false;
              bannerBufferRef.current = '';
              smartWrite(term, getDisconnectSplash(term.cols));
            }

            wasConnectedRef.current = event.payload.connected;
            setConnected(event.payload.connected);
            setStatusMessage(event.payload.message);
          }
        }
      );

      unlistenRefs.current = [unlistenOutput, unlistenStatus];
    }

    setup();

    return () => {
      cancelled = true;
      unlistenRefs.current.forEach((fn) => fn());
    };
  }, [terminalRef]);

  const sendCommand = useCallback(async (command: string) => {
    try {
      if (passwordModeRef.current) {
        passwordModeRef.current = false;
        setPasswordMode(false);
      }
      if (skipHistoryRef.current) {
        skipHistoryRef.current = false;
        setSkipHistory(false);
      }
      await invoke('send_command', { command });
    } catch (e) {
      console.error('Failed to send command:', e);
    }
  }, []);

  const reconnect = useCallback(async () => {
    try {
      await invoke('reconnect');
    } catch (e) {
      console.error('Failed to reconnect:', e);
    }
  }, []);

  const disconnect = useCallback(async () => {
    try {
      await invoke('disconnect');
    } catch (e) {
      console.error('Failed to disconnect:', e);
    }
  }, []);

  return { connected, passwordMode, skipHistory, statusMessage, sendCommand, reconnect, disconnect };
}
