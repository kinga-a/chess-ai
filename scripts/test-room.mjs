/**
 * Live-room checks (HTTP API + MCP room tools).
 * Requires the dev server: npm run dev
 * Run: node scripts/test-room.mjs
 */
const BASE = process.env.BASE || 'http://127.0.0.1:8788';

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

async function api(action, body) {
  const res = await fetch(`${BASE}/api/room`, {
    method: action ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: action ? JSON.stringify({ action, ...body }) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function getRoom(code) {
  const res = await fetch(`${BASE}/api/room?code=${code}`);
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

async function rpc(method, params) {
  const res = await fetch(`${BASE}/api/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: Math.random(), method, params }),
  });
  return res.json();
}

async function call(name, args = {}) {
  const res = await rpc('tools/call', { name, arguments: args });
  if (!res.result) throw new Error(`${name} failed: ${JSON.stringify(res)}`);
  if (res.result.isError) throw new Error(`${name}: ${res.result.content[0].text}`);
  return res.result.structuredContent;
}

const created = await api('create', { game: 'gomoku', humanSide: 'first' });
ok('create gomoku room', created.status === 200 && created.data.room, created.data.room && created.data.room.code);
const code = created.data.room.code;

const initial = await getRoom(code);
ok('new room starts empty', initial.data.room.board === '0'.repeat(225) && initial.data.room.turn === 1);

const human = await api('move', { code, move: 'H8' });
ok('human move H8', human.status === 200 && human.data.room.moves.length === 1 && human.data.room.turn === 2);

const outOfTurn = await api('move', { code, player: 1, move: 'A1' });
ok('out-of-turn move rejected', outOfTurn.status === 409);

const ai = await api('ai_move', { code, level: 'normal' });
ok('server AI answers', ai.status === 200 && ai.data.room.moves.length === 2, ai.data.room.lastEngine);

const occupied = await api('move', { code, move: 'H8' });
ok('occupied square rejected', occupied.status === 409);

const badCode = await getRoom('ZZZZZZ');
ok('unknown code → 404', badCode.status === 404);
const badLabel = await getRoom('!!');
ok('invalid code → 400', badLabel.status === 400);

const chessRoom = await api('create', { game: 'chess', humanSide: 'red' });
const chessCode = chessRoom.data.room.code;
const chessMove = await api('move', { code: chessCode, from: 'b2', to: 'b1' });
ok('chess move b2→b1', chessMove.status === 200 && chessMove.data.room.turn === 'b');
const chessAi = await api('ai_move', { code: chessCode, level: 'normal' });
ok('chess AI answers', chessAi.status === 200 && chessAi.data.room.moves.length === 2);

// Delete flow
const toDelete = await api('create', { game: 'gomoku', humanSide: 'first' });
const delCode = toDelete.data.room.code;
const removed = await api('delete', { code: delCode });
ok('delete room', removed.status === 200 && removed.data.closed === true);
const gone = await getRoom(delCode);
ok('deleted room → 404', gone.status === 404);

// Guest join notification
const jr = await api('create', { game: 'gomoku', humanSide: 'first' });
const jCode = jr.data.room.code;
const beforeJoin = await getRoom(jCode);
ok('new room awaits guest', beforeJoin.data.room.guest === false);
const firstJoin = await api('join', { code: jCode });
ok('join flags guest', firstJoin.status === 200 && firstJoin.data.room.guest === true);
const againJoin = await api('join', { code: jCode });
ok('join is idempotent', againJoin.data.room.version === firstJoin.data.room.version);

// AI turn guard: AI must never move the human's side
const guardRoom = await api('create', { game: 'chess', humanSide: 'red' });
const guard = await api('ai_move', { code: guardRoom.data.room.code });
ok('AI cannot move for the human (chess)', guard.status === 409);
const openRoom = await api('create', { game: 'chess', humanSide: 'black' });
const opener = await api('ai_move', { code: openRoom.data.room.code });
ok('AI opens when human is second (chess)', opener.status === 200 && opener.data.room.moves.length === 1);
const guardGrid = await api('create', { game: 'othello', humanSide: 'first' });
const guardGridAi = await api('ai_move', { code: guardGrid.data.room.code });
ok('AI cannot move for the human (othello)', guardGridAi.status === 409);

// MCP room tools
const mcpRoom = await call('room_create', { game: 'gomoku', humanSide: 'first' });
ok('MCP room_create', !!mcpRoom.code, mcpRoom.code);
const mcpCode = mcpRoom.code;
const mcpState = await call('room_state', { code: mcpCode });
ok('MCP room_state', mcpState.board === '0'.repeat(225));
const mcpPlay = await call('room_play', { code: mcpCode, move: 'H8' });
ok('MCP room_play', mcpPlay.moves.length === 1 && mcpPlay.turn === 2);
const mcpAi = await call('room_ai_move', { code: mcpCode, level: 'normal' });
ok('MCP room_ai_move', mcpAi.moves.length === 2, mcpAi.lastEngine);

const tools = await rpc('tools/list', {});
ok('tools/list includes room tools', tools.result.tools.some((t) => t.name === 'room_create'), `total ${tools.result.tools.length}`);

console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;