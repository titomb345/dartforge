import type { MudTransport, TransportCallbacks } from './transport';

const DEFAULT_PROXY_URL = 'wss://dartforge-proxy.fly.dev';

export class WebSocketTransport implements MudTransport {
  private ws: WebSocket | null = null;
  private callbacks: TransportCallbacks | null = null;
  private proxyUrl: string;

  constructor(proxyUrl?: string) {
    this.proxyUrl = proxyUrl ?? DEFAULT_PROXY_URL;
  }

  async connect(callbacks: TransportCallbacks): Promise<() => void> {
    this.callbacks = callbacks;

    // Only open the WebSocket once — subsequent connect() calls (e.g. from
    // React StrictMode re-mounts) just update the callbacks reference.
    if (!this.ws || this.ws.readyState === WebSocket.CLOSED) {
      this.openSocket();
    }

    // Cleanup only detaches callbacks — the WebSocket stays open because
    // the transport is a module-level singleton shared across re-mounts.
    return () => {
      this.callbacks = null;
    };
  }

  private openSocket() {
    this.ws = new WebSocket(this.proxyUrl);

    this.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'output') {
          this.callbacks?.onOutput({ data: msg.data, ga: msg.ga ?? false });
        } else if (msg.type === 'status') {
          this.callbacks?.onStatus({ connected: msg.connected, message: msg.message });
        }
      } catch (e) {
        console.error('Failed to parse proxy message:', e);
      }
    };

    this.ws.onclose = () => {
      this.ws = null;
      this.callbacks?.onStatus({
        connected: false,
        message: 'WebSocket connection closed',
      });
    };

    this.ws.onerror = () => {
      this.callbacks?.onStatus({
        connected: false,
        message: 'WebSocket connection error',
      });
    };
  }

  async sendCommand(command: string): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'command', data: command }));
    }
  }

  async reconnect(): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'reconnect' }));
    } else {
      // WebSocket is down — re-establish it, then send reconnect once open
      this.openSocket();
      this.ws?.addEventListener(
        'open',
        () => {
          this.ws?.send(JSON.stringify({ type: 'reconnect' }));
        },
        { once: true }
      );
    }
  }

  async disconnect(): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'disconnect' }));
    }
  }
}
