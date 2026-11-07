import { json, CORS_HEADERS } from '../lib/http.js';
import { llmConfig } from '../lib/llm.js';
import { authConfig, verifyKey, requestKey } from '../lib/auth.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  const cfg = llmConfig(env);
  const auth = authConfig(env);
  const unlocked = !auth.siteEnabled || (await verifyKey(requestKey(request), auth.siteKey));

  return json({
    ok: true,
    service: 'edgeone-chess-ai',
    title: '棋境 · EdgeOne AI 棋馆',
    version: '1.2.0',
    games: ['gomoku', 'chess'],
    mcp: '/api/mcp',
    auth: {
      enabled: auth.siteEnabled,
      mode: auth.siteEnabled ? 'admin' : 'open',
      scheme: 'Bearer',
      header: 'Authorization: Bearer <ADMIN_PASS>',
      secure: auth.siteEnabled,
      mcp: {
        enabled: auth.mcpEnabled,
        header: 'Authorization: Bearer <ACCESS_KEY>',
      },
      hint: auth.siteEnabled
        ? auth.mcpEnabled
          ? 'Web uses ADMIN_PASS, MCP uses ACCESS_KEY. They are independent.'
          : 'Web is protected by ADMIN_PASS; MCP is open because ACCESS_KEY is not set.'
        : auth.mcpEnabled
          ? 'MCP is protected by ACCESS_KEY; the web is open because ADMIN_PASS is not set.'
          : 'No keys configured: both the web and MCP are open.',
    },
    ai: unlocked
      ? {
          local: true,
          edge: true,
          llm: cfg.enabled,
          model: cfg.enabled ? cfg.model : null,
          baseUrl: cfg.enabled ? cfg.base : null,
        }
      : { local: true, edge: true, llm: null, locked: true },
    runtime: 'EdgeOne Edge Functions',
    time: new Date().toISOString(),
  });
}

export function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}