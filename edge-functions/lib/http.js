/** Shared HTTP helpers for EdgeOne Edge Functions. */

export const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers':
    'Content-Type, Authorization, X-Access-Key, X-MCP-Key, Mcp-Session-Id, MCP-Protocol-Version, Last-Event-ID',
  'Access-Control-Expose-Headers': 'Mcp-Session-Id, MCP-Protocol-Version',
  'Access-Control-Max-Age': '86400',
};

export function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...CORS_HEADERS,
      ...(init.headers || {}),
    },
  });
}

export function badRequest(message, status = 400) {
  return json({ error: message }, { status });
}

export function corsPreflight() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function readJson(request, maxBytes = 1024 * 1024) {
  const raw = await request.text();
  if (!raw) return {};
  if (raw.length > maxBytes) throw new Error('request body is too large');
  let data;
  try {
    data = JSON.parse(raw);
  } catch (_) {
    throw new Error('invalid JSON body');
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('JSON body must be an object');
  }
  return data;
}