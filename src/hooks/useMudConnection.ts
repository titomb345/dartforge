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

export function useMudConnection(terminalRef: React.MutableRefObject<Terminal | null>) {
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
              smartWrite(term, afterBanner);
            }
          } else if (bannerBufferRef.current.length > BANNER_MAX_BUFFER) {
            // Safety: too much data without finding banner, flush it all
            filteringBannerRef.current = false;
            smartWrite(term, bannerBufferRef.current);
            bannerBufferRef.current = '';
          }
          return;
        }

        // Detect login/password prompts
        if (/password:/i.test(event.payload.data)) {
          passwordModeRef.current = true;
          skipHistoryRef.current = true;
          setPasswordMode(true);
          setSkipHistory(true);
        } else if (/name:/i.test(event.payload.data)) {
          skipHistoryRef.current = true;
          setSkipHistory(true);
        }

        smartWrite(term, event.payload.data);
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
