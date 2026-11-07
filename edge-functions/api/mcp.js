/**
 * MCP Streamable HTTP endpoint (stateless JSON-RPC 2.0).
 * Supports: initialize, notifications/initialized, ping, tools/list, tools/call,
 * resources/list, prompts/list.
 */
import { CORS_HEADERS, json, corsPreflight } from '../lib/http.js';
import {
  TOOLS,
  findTool,
  PROTOCOL_VERSION,
  SERVER_INFO,
  RULES_GOMOKU,
  RULES_CHESS,
} from '../lib/mcp-tools.js';
import { callTool } from '../lib/mcp-server.js';
import { requireMcpAccess } from '../lib/auth.js';

const SUPPORTED_VERSIONS = ['2024-11-05', '2025-03-26', '2025-06-18'];

function rpcError(id, code, message) {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message } };
}

function textResult(id, result) {
  return { jsonrpc: '2.0', id: id ?? null, result };
}

function handleInitialize(params = {}) {
  const requested = params.protocolVersion;
  const version = SUPPORTED_VERSIONS.includes(requested) ? requested : PROTOCOL_VERSION;
  return {
    protocolVersion: version,
    capabilities: {
      tools: { listChanged: false },
    },
    serverInfo: SERVER_INFO,
    instructions:
      '棋境 · EdgeOne AI 棋馆 MCP。提供五子棋与中国象棋的无状态工具：' +
      '先调用 *_new_game 获取棋盘，再用 *_play 提交着法、*_ai_move 让 AI 应手。' +
      '每步都需要把最新的 board / fen 传回来。支持 minimax 与大模型（engine=llm）两种 AI 引擎。',
  };
}

async function handleToolsCall(params, env) {
  const name = params && params.name;
  if (!name) return rpcError(params && params.id, -32602, 'tools/call requires a tool name');
  if (!findTool(name)) return rpcError(null, -32602, `unknown tool: ${name}`);
  try {
    const output = await callTool(name, params.arguments || {}, env);
    return {
      content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
      structuredContent: output,
      isError: false,
    };
  } catch (err) {
    return {
      content: [{ type: 'text', text: `Error: ${err && err.message ? err.message : String(err)}` }],
      structuredContent: { error: err && err.message ? err.message : String(err) },
      isError: true,
    };
  }
}

async function handleMessage(message, env) {
  if (!message || typeof message !== 'object' || message.jsonrpc !== '2.0') {
    return rpcError(null, -32600, 'Invalid Request');
  }
  const id = message.id;
  const method = message.method;
  if (typeof method !== 'string') return rpcError(id, -32600, 'Invalid Request');
  const isNotification = id === undefined || id === null;

  switch (method) {
    case 'initialize':
      return textResult(id, handleInitialize(message.params || {}));
    case 'notifications/initialized':
    case 'notifications/cancelled':
      return null;
    case 'ping':
      return textResult(id, {});
    case 'tools/list':
      return textResult(id, { tools: TOOLS });
    case 'tools/call': {
      const result = await handleToolsCall(message.params || {}, env);
      if (result && result.error) return { jsonrpc: '2.0', id: id ?? null, error: result.error };
      return textResult(id, result);
    }
    case 'resources/list':
      return textResult(id, { resources: [] });
    case 'resources/templates/list':
      return textResult(id, { resourceTemplates: [] });
    case 'prompts/list':
      return textResult(id, { prompts: [] });
    default:
      return rpcError(id, -32601, `Method not found: ${method}`);
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const denied = await requireMcpAccess(request, env);
  if (denied) return denied;

  let payload;
  try {
    payload = JSON.parse(await request.text());
  } catch (_) {
    return json(rpcError(null, -32700, 'Parse error'), { status: 400 });
  }

  if (Array.isArray(payload)) {
    if (payload.length === 0) return json(rpcError(null, -32600, 'Invalid Request'), { status: 400 });
    const responses = [];
    for (const message of payload) {
      const result = await handleMessage(message, env);
      if (result) responses.push(result);
    }
    if (!responses.length) return new Response(null, { status: 202, headers: CORS_HEADERS });
    return json(responses);
  }

  const result = await handleMessage(payload, env);
  if (!result) return new Response(null, { status: 202, headers: CORS_HEADERS });
  return json(result);
}

export async function onRequestGet(context) {
  const denied = await requireMcpAccess(context.request, context.env);
  if (denied) return denied;
  const accept = (context.request.headers.get('Accept') || '').toLowerCase();
  if (accept.includes('text/event-stream')) {
    return new Response('SSE stream not supported on this stateless endpoint; use POST JSON-RPC.', {
      status: 405,
      headers: { ...CORS_HEADERS, Allow: 'POST, OPTIONS', 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
  return json({
    name: SERVER_INFO.name,
    title: SERVER_INFO.title,
    version: SERVER_INFO.version,
    protocolVersion: PROTOCOL_VERSION,
    transport: 'Streamable HTTP (stateless JSON-RPC 2.0)',
    tools: TOOLS.map((t) => ({ name: t.name, title: t.title })),
    games: { gomoku: RULES_GOMOKU, chess: RULES_CHESS },
    hint: 'POST JSON-RPC 2.0 messages to this URL. No session required.',
  });
}

export function onRequestOptions() {
  return corsPreflight();
}