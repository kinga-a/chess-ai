/**
 * Room checks for the three grid games (HTTP API + MCP tools).
 * Requires: npm run dev
 * Run: node scripts/test-grid-rooms.mjs
 */
const BASE = process.env.BASE || 'http://127.0.0.1:8788';
let passed = 0;
let failed = 0;

const ok = (name, cond, extra = '') => {
  if (cond) {
    passed += 1;
    console.log(`✓ ${name}${extra ? ` (${extra})` : ''}`);
  } else {
    failed += 1;
    console.log(`✗ ${name}${extra ? ` (${extra})` : ''}`);
  }
};

async function post(payload) {
  const res = await fetch(`${BASE}/api/room`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

async function mcp(name, args = {}) {
  const res = await fetch(`${BASE}/api/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  const data = await res.json();
  if (!data.result) throw new Error(`${name}: no result`);
  if (data.result.isError) throw new Error(data.result.content[0].text);
  return data.result.structuredContent;
}

/* tic-tac-toe room */
const t = await post({ action: 'create', game: 'tictactoe', humanSide: 'first' });
ok('ttt room created', t.status === 200 && Array.isArray(t.data.room.board) && t.data.room.turn === 1);
const tcode = t.data.room.code;

const tmove = await post({ action: 'move', code: tcode, move: 4 });
ok('ttt human move', tmove.status === 200 && tmove.data.room.moves.length === 1, `turn ${tmove.data.room.turn}`);

const tai = await post({ action: 'ai_move', code: tcode });
ok('ttt AI answers', tai.status === 200 && tai.data.room.moves.length === 2, tai.data.room.lastEngine);

/* connect four room */
const c = await post({ action: 'create', game: 'connect4', humanSide: 'second' });
ok('c4 room created', c.status === 200 && c.data.room.humanSide === 2 && c.data.room.board.length === 42);
const ccode = c.data.room.code;
const cai = await post({ action: 'ai_move', code: ccode });
ok('c4 AI opens (human is second)', cai.status === 200 && cai.data.room.moves.length === 1, `col ${cai.data.room.moves[0] && cai.data.room.moves[0].move}`);
const cmove = await post({ action: 'move', code: ccode, move: 3 });
ok('c4 human move', cmove.status === 200 && cmove.data.room.moves.length === 2);

/* othello room */
const o = await post({ action: 'create', game: 'othello', humanSide: 'first' });
ok('othello room created', o.status === 200 && o.data.room.board.filter((v) => v).length === 4);
const ocode = o.data.room.code;
const omove = await post({ action: 'move', code: ocode, move: 19 });
ok('othello human move flips', omove.status === 200 && omove.data.room.moves.length === 1);
const oai = await post({ action: 'ai_move', code: ocode });
ok('othello AI answers', oai.status === 200 && oai.data.room.moves.length === 2);

/* MCP room tools across games */
const m = await mcp('room_create', { game: 'connect4', humanSide: 'first' });
ok('MCP room_create connect4', Array.isArray(m.board) && m.board.length === 42, m.code);
const mplay = await mcp('room_play', { code: m.code, move: 3 });
ok('MCP room_play connect4', mplay.moves.length === 1);
const mtick = await mcp('room_tick', { code: m.code, level: 'normal' });
ok('MCP room_tick answers', mtick.moved === true, `moves ${mtick.room.moves.length}`);

const o2 = await mcp('room_create', { game: 'othello', humanSide: 'first' });
ok('MCP room_create othello', o2.board.filter((v) => v).length === 4);
const o2play = await mcp('room_play', { code: o2.code, move: 19 });
ok('MCP room_play othello', o2play.moves.length === 1);

console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;