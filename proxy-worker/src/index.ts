import { MudProxy } from './MudProxy';

export { MudProxy };

interface Env {
  MUD_PROXY: DurableObjectNamespace;
}

const ALLOWED_ORIGINS = [
  'https://dartforge.netlify.app',
  'http://localhost:5173',
  'http://localhost:3000',
  'http://localhost:1420',
];

function corsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get('Origin') ?? '';
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const cors = corsHeaders(request);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    // WebSocket upgrade: /ws
    if (url.pathname === '/ws') {
      if (request.headers.get('Upgrade') !== 'websocket') {
        return new Response('Expected WebSocket', { status: 426, headers: cors });
      }

      // Each connection gets its own DO instance
      const id = env.MUD_PROXY.newUniqueId();
      const stub = env.MUD_PROXY.get(id);
      return stub.fetch(request);
    }

    if (url.pathname === '/health') {
      return new Response('ok', { headers: cors });
    }

    return new Response('Not Found', { status: 404, headers: cors });
  },
};
