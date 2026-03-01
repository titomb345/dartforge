import { connect } from 'cloudflare:sockets';
import { processOutput } from './telnet';

const MUD_HOST = 'dartmud.com';
const MUD_PORT = 2525;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2_000;
const CONNECT_TIMEOUT_MS = 10_000;

interface ClientMessage {
  type: 'command' | 'reconnect' | 'disconnect' | 'ping';
  data?: string;
}

interface OutputMessage {
  type: 'output';
  data: string;
  ga: boolean;
}

interface StatusMessage {
  type: 'status';
  connected: boolean;
  message: string;
}

interface PongMessage {
  type: 'pong';
}

type ServerMessage = OutputMessage | StatusMessage | PongMessage;

export class MudProxy implements DurableObject {
  private ws: WebSocket | null = null;
  private tcpSocket: Socket | null = null;
  private tcpWriter: WritableStreamDefaultWriter<Uint8Array> | null = null;
  private remainder: Uint8Array = new Uint8Array(0);
  private abortController: AbortController | null = null;

  constructor(
    private state: DurableObjectState,
    _env: unknown,
  ) {}

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected WebSocket', { status: 426 });
    }

    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];

    server.accept();
    this.ws = server;

    server.addEventListener('message', (event) => {
      this.handleMessage(event.data as string);
    });

    server.addEventListener('close', () => {
      this.cleanup();
    });

    server.addEventListener('error', () => {
      this.cleanup();
    });

    this.send({ type: 'status', connected: false, message: 'Ready to connect' });

    return new Response(null, { status: 101, webSocket: client });
  }

  private handleMessage(raw: string): void {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    switch (msg.type) {
      case 'command':
        if (msg.data !== undefined) {
          this.sendToMud(msg.data);
        }
        break;
      case 'reconnect':
        this.connectToMud();
        break;
      case 'disconnect':
        this.disconnectMud();
        this.send({ type: 'status', connected: false, message: 'Disconnected' });
        break;
      case 'ping':
        this.send({ type: 'pong' });
        break;
    }
  }

  private async connectToMud(): Promise<void> {
    await this.disconnectMud();

    const addr = `${MUD_HOST}:${MUD_PORT}`;
    this.send({ type: 'status', connected: false, message: `Connecting to ${addr}...` });

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const socket = connect({ hostname: MUD_HOST, port: MUD_PORT });

        await Promise.race([
          socket.opened,
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Connection timed out')), CONNECT_TIMEOUT_MS),
          ),
        ]);

        this.tcpSocket = socket;
        this.tcpWriter = socket.writable.getWriter();
        this.remainder = new Uint8Array(0);

        this.send({ type: 'status', connected: true, message: `Connected to ${addr}` });
        this.startTcpReadLoop();
        return;
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : 'Unknown error';
        if (attempt < MAX_RETRIES) {
          this.send({
            type: 'status',
            connected: false,
            message: `Connection failed (${errMsg}), retrying (${attempt}/${MAX_RETRIES})...`,
          });
          await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
        } else {
          this.send({
            type: 'status',
            connected: false,
            message: `Failed to connect after ${MAX_RETRIES} attempts: ${errMsg}`,
          });
        }
      }
    }
  }

  private startTcpReadLoop(): void {
    if (!this.tcpSocket) return;

    this.abortController = new AbortController();
    const signal = this.abortController.signal;
    const reader = this.tcpSocket.readable.getReader();

    const readLoop = async () => {
      try {
        while (!signal.aborted) {
          const { done, value } = await reader.read();

          if (done || !value) {
            this.send({ type: 'status', connected: false, message: 'Disconnected' });
            this.tcpSocket = null;
            this.tcpWriter = null;
            break;
          }

          // Prepend remainder from previous chunk
          let input: Uint8Array;
          if (this.remainder.length > 0) {
            input = new Uint8Array(this.remainder.length + value.length);
            input.set(this.remainder);
            input.set(value, this.remainder.length);
            this.remainder = new Uint8Array(0);
          } else {
            input = value;
          }

          const processed = processOutput(input);
          this.remainder = processed.remainder;

          // Send IAC responses back to MUD
          for (const response of processed.responses) {
            try {
              await this.tcpWriter?.write(response);
            } catch {
              break;
            }
          }

          // Forward display text to browser
          if (processed.display.length > 0 || processed.ga) {
            this.send({
              type: 'output',
              data: processed.display,
              ga: processed.ga,
            });
          }
        }
      } catch {
        if (!signal.aborted) {
          this.send({ type: 'status', connected: false, message: 'Disconnected' });
        }
      } finally {
        try {
          reader.releaseLock();
        } catch {
          /* noop */
        }
      }
    };

    readLoop();
  }

  private async sendToMud(command: string): Promise<void> {
    if (!this.tcpWriter) return;
    try {
      const encoder = new TextEncoder();
      await this.tcpWriter.write(encoder.encode(`${command}\r\n`));
    } catch {
      this.send({ type: 'status', connected: false, message: 'Disconnected' });
      this.tcpSocket = null;
      this.tcpWriter = null;
    }
  }

  private async disconnectMud(): Promise<void> {
    this.abortController?.abort();
    this.abortController = null;

    try {
      await this.tcpWriter?.close();
    } catch {
      /* noop */
    }
    this.tcpWriter = null;

    try {
      await this.tcpSocket?.close();
    } catch {
      /* noop */
    }
    this.tcpSocket = null;

    this.remainder = new Uint8Array(0);
  }

  private cleanup(): void {
    this.abortController?.abort();
    this.abortController = null;
    try {
      this.tcpWriter?.close();
    } catch {
      /* noop */
    }
    try {
      this.tcpSocket?.close();
    } catch {
      /* noop */
    }
    this.tcpWriter = null;
    this.tcpSocket = null;
    this.ws = null;
  }

  private send(msg: ServerMessage): void {
    try {
      this.ws?.send(JSON.stringify(msg));
    } catch {
      /* WebSocket may already be closed */
    }
  }
}
