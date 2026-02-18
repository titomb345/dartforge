import type { MudOutputPayload, ConnectionStatusPayload } from '../types';

export interface TransportCallbacks {
  onOutput: (payload: MudOutputPayload) => void;
  onStatus: (payload: ConnectionStatusPayload) => void;
}

export interface MudTransport {
  /** Start listening for output and status events. Returns cleanup function. */
  connect(callbacks: TransportCallbacks): Promise<() => void>;
  /** Send a command string to the MUD server. */
  sendCommand(command: string): Promise<void>;
  /** Reconnect to the MUD server. */
  reconnect(): Promise<void>;
  /** Disconnect from the MUD server. */
  disconnect(): Promise<void>;
}
