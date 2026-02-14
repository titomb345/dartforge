import { useEffect, useRef, useState, useCallback } from 'react';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import type { Terminal } from '@xterm/xterm';
import { MUD_OUTPUT_EVENT, CONNECTION_STATUS_EVENT } from '../lib/tauriEvents';
import { MudOutputPayload, ConnectionStatusPayload } from '../types';

export function useMudConnection(terminalRef: React.MutableRefObject<Terminal | null>) {
  const [connected, setConnected] = useState(false);
  const [statusMessage, setStatusMessage] = useState('Connecting...');
  const unlistenRefs = useRef<(() => void)[]>([]);

  useEffect(() => {
    let cancelled = false;

    async function setup() {
      const unlistenOutput = await listen<MudOutputPayload>(MUD_OUTPUT_EVENT, (event) => {
        if (!cancelled && terminalRef.current) {
          terminalRef.current.write(event.payload.data);
        }
      });

      const unlistenStatus = await listen<ConnectionStatusPayload>(
        CONNECTION_STATUS_EVENT,
        (event) => {
          if (!cancelled) {
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
      await invoke('send_command', { command });
    } catch (e) {
      console.error('Failed to send command:', e);
    }
  }, []);

  return { connected, statusMessage, sendCommand };
}
