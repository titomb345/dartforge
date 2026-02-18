import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { MUD_OUTPUT_EVENT, CONNECTION_STATUS_EVENT } from './tauriEvents';
import type { MudTransport, TransportCallbacks } from './transport';
import type { MudOutputPayload, ConnectionStatusPayload } from '../types';

export class TauriTransport implements MudTransport {
  async connect(callbacks: TransportCallbacks): Promise<() => void> {
    const unlistenOutput = await listen<MudOutputPayload>(
      MUD_OUTPUT_EVENT,
      (event) => callbacks.onOutput(event.payload),
    );
    const unlistenStatus = await listen<ConnectionStatusPayload>(
      CONNECTION_STATUS_EVENT,
      (event) => callbacks.onStatus(event.payload),
    );
    return () => {
      unlistenOutput();
      unlistenStatus();
    };
  }

  async sendCommand(command: string): Promise<void> {
    await invoke('send_command', { command });
  }

  async reconnect(): Promise<void> {
    await invoke('reconnect');
  }

  async disconnect(): Promise<void> {
    await invoke('disconnect');
  }
}
