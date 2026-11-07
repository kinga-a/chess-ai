/**
 * Split-key checks:
 *   ADMIN_PASS → web + AI + rooms
 *   ACCESS_KEY → MCP only
 *   missing variable → that surface is open
 *
 * Run: node scripts/test-auth.mjs
 */
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const MCP_KEY = 'mcp-key-2026';
const ADMIN = 'admin-pass-2026';
const servers = [];
let passed = 0;
let failed = 0;

function ok(name, condition, extra = '') {
  if (condition) {
    passed += 1;
    console.log(`✓ ${name}${extra ? ` (${extra})` : ''}`);
  } else {
    failed += 1;
    console.log(`✗ ${name}${extra ? ` (${extra})` : ''}`);
  }
}

function start(port, env) {
  const child = spawn(process.execPath, ['scripts/dev-server.mjs'], {
    env: { ...process.env, PORT: String(port), ...env },
    stdio: 'ignore',
  });
  servers.push(child);
  const base = `http://127.0.0.1:${port}`;
  return { port, base };
}

async function waitFor(base) {
  for (let i = 0; i < 60; i += 1) {
    try {
      const res = await fetch(`${base}/api/health`);
      if (res.ok) return;
    } catch (_) {
      /* not ready */
    }
    await sleep(100);
  }
  throw new Error(`server ${base} did not start`);
}

async function mcp(base, headers = {}) {
  return fetch(`${base}/api/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
  });
}

async function ai(base, headers = {}) {
  return fetch(`${base}/api/ai/chess`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ fen: 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1', level: 'easy' }),
  });
}

async function room(base, headers = {}) {
  return fetch(`${base}/api/room`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ action: 'create', game: 'gomoku', humanSide: 'first' }),
  });
}

async function check(base, key) {
  return fetch(`${base}/api/auth/check`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key }),
  });
}

const a = start(8799, { ACCESS_KEY: MCP_KEY, ADMIN_PASS: ADMIN });
const b = start(8798, { ACCESS_KEY: MCP_KEY, ADMIN_PASS: '' });
const c = start(8796, { ACCESS_KEY: '', ADMIN_PASS: ADMIN });

try {
  await Promise.all([waitFor(a.base), waitFor(b.base), waitFor(c.base)]);

  // ---- A: both keys configured ----
  const ha = await (await fetch(`${a.base}/api/health`)).json();
  ok('A health: web protected + mcp protected', ha.auth.enabled === true && ha.auth.mcp.enabled === true, ha.auth.mode);

  ok('A MCP without key → 401', (await mcp(a.base)).status === 401);
  ok('A MCP with ADMIN_PASS → 401 (keys are separate)', (await mcp(a.base, { Authorization: `Bearer ${ADMIN}` })).status === 401);
  ok('A MCP with ACCESS_KEY → 200', (await mcp(a.base, { Authorization: `Bearer ${MCP_KEY}` })).status === 200);

  ok('A AI without key → 401', (await ai(a.base)).status === 401);
  ok('A AI with ACCESS_KEY → 401 (MCP key is MCP-only)', (await ai(a.base, { Authorization: `Bearer ${MCP_KEY}` })).status === 401);
  ok('A AI with ADMIN_PASS → 200', (await ai(a.base, { Authorization: `Bearer ${ADMIN}` })).status === 200);

  ok('A room with ADMIN_PASS → 200', (await room(a.base, { Authorization: `Bearer ${ADMIN}` })).status === 200);
  ok('A room with ACCESS_KEY → 401', (await room(a.base, { Authorization: `Bearer ${MCP_KEY}` })).status === 401);

  ok('A auth/check accepts ADMIN_PASS', (await check(a.base, ADMIN)).status === 200);
  ok('A auth/check rejects ACCESS_KEY', (await check(a.base, MCP_KEY)).status === 401);

  // ---- B: only ACCESS_KEY ----
  const hb = await (await fetch(`${b.base}/api/health`)).json();
  ok('B health: web open, mcp protected', hb.auth.enabled === false && hb.auth.mcp.enabled === true, hb.auth.mode);
  ok('B web API without key → 200 (open)', (await ai(b.base)).status === 200);
  ok('B MCP without key → 401', (await mcp(b.base)).status === 401);
  ok('B MCP with ACCESS_KEY → 200', (await mcp(b.base, { Authorization: `Bearer ${MCP_KEY}` })).status === 200);

  // ---- C: only ADMIN_PASS ----
  const hc = await (await fetch(`${c.base}/api/health`)).json();
  ok('C health: web protected, mcp open', hc.auth.enabled === true && hc.auth.mcp.enabled === false, hc.auth.mode);
  ok('C web API without key → 401', (await ai(c.base)).status === 401);
  ok('C web API with ADMIN_PASS → 200', (await ai(c.base, { Authorization: `Bearer ${ADMIN}` })).status === 200);
  ok('C MCP without key → 200 (open)', (await mcp(c.base)).status === 200);

  // ---- rate limit on the MCP scope ----
  let last = 0;
  for (let i = 0; i < 12; i += 1) {
    const res = await mcp(a.base, { Authorization: 'Bearer brute-force' });
    last = res.status;
    if (res.status === 429) break;
  }
  ok('MCP brute force is rate limited', last === 429, `last ${last}`);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
} catch (err) {
  console.error('test error:', err);
  process.exitCode = 1;
} finally {
  servers.forEach((child) => child.kill('SIGTERM'));
}