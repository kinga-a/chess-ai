/**
 * MCP-side room bridge: keeps an AI seat in a live room using only MCP tools.
 * Useful when the web room is protected by ADMIN_PASS and you only have the
 * MCP ACCESS_KEY.
 *
 *   MCP_URL=https://your-domain/api/mcp ACCESS_KEY=xxx ROOM=ABC123 \
 *     node scripts/mcp-room-bridge.mjs
 *
 * Options via env: ROOM, LEVEL (easy|normal|hard), ENGINE (minimax|llm), ONCE=1, QUIET=1
 */
const MCP_URL = process.env.MCP_URL || 'http://127.0.0.1:8788/api/mcp';
const KEY = process.env.ACCESS_KEY || '';
const ROOM = (process.env.ROOM || '').toUpperCase();
const LEVEL = process.env.LEVEL || 'normal';
const ENGINE = process.env.ENGINE || 'minimax';
const ONCE = process.env.ONCE === '1';
const QUIET = process.env.QUIET === '1';

if (!/^[A-Z0-9]{6}$/.test(ROOM)) {
  console.error('ROOM=<6位房间码> 必填');
  process.exit(1);
}

const headers = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };
if (KEY) headers.Authorization = `Bearer ${KEY}`;

let id = 0;

async function rpc(method, params) {
  const res = await fetch(MCP_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return text ? JSON.parse(text) : null;
}

async function call(name, args = {}) {
  const res = await rpc('tools/call', { name, arguments: args });
  if (!res || !res.result) throw new Error(`${name}: bad response`);
  if (res.result.isError) throw new Error(res.result.content[0].text);
  return res.result.structuredContent;
}

const log = (...msg) => {
  if (!QUIET) console.log(...msg);
};

function aiSideOf(room) {
  if (room.game === 'gomoku') return room.humanSide === 1 ? 2 : 1;
  return room.humanSide === 'w' ? 'b' : 'w';
}

function describe(room) {
  const last = room.moves[room.moves.length - 1];
  if (!last) return '—';
  return room.game === 'gomoku' ? last.label : `${last.fromLabel}→${last.toLabel}`;
}

async function main() {
  log(`MCP bridge → ${MCP_URL} · room ${ROOM} · ${LEVEL}/${ENGINE}`);
  let useTick = true;
  for (;;) {
    const started = Date.now();
    let room = null;
    let moved = false;

    if (useTick) {
      try {
        const tick = await call('room_tick', { code: ROOM, level: LEVEL, engine: ENGINE });
        room = tick.room;
        moved = tick.moved;
      } catch (err) {
        if (/unknown tool|not found|invalid|bad response/i.test(err.message)) {
          useTick = false;
          await new Promise((resolve) => setTimeout(resolve, 500));
          continue;
        }
        throw err;
      }
    } else {
      room = await call('room_state', { code: ROOM });
      if (room.status === 'playing' && String(room.turn) === String(aiSideOf(room))) {
        room = await call('room_ai_move', { code: ROOM, level: LEVEL, engine: ENGINE });
        moved = true;
      }
    }

    if (room.status === 'over') {
      await new Promise((resolve) => setTimeout(resolve, 800));
      const again = await call('room_state', { code: ROOM });
      if (again.status === 'over') {
        log('对局结束，bridge 退出');
        return;
      }
      room = again;
    }
    if (moved) {
      log(`AI ${describe(room)} · ${Date.now() - started}ms · ${room.lastEngine || ENGINE}`);
      if (ONCE) return;
      continue;
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('bridge error:', err.message);
    process.exit(1);
  });