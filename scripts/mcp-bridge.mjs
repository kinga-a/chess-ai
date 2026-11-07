/**
 * MCP room bridge: keeps an AI seat in a live room so the web board updates
 * in real time. It watches the room and answers whenever it is the AI's turn.
 *
 *   node scripts/mcp-bridge.mjs --room ABC123 --level normal --engine minimax
 *   BASE=https://your-domain node scripts/mcp-bridge.mjs --room ABC123
 *
 * Options:
 *   --room   6-char room code (required)
 *   --level  easy | normal | hard          (default normal)
 *   --engine minimax | llm                 (default minimax)
 *   --once   answer at most one move then exit
 *   --quiet  only print errors
 */
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback;
};
const flag = (name) => args.includes(`--${name}`);

const BASE = process.env.BASE || 'http://127.0.0.1:8788';
const ACCESS_KEY = process.env.ACCESS_KEY || '';
const room = (opt('room', '') || '').toUpperCase();
const level = opt('level', 'normal');
const engine = opt('engine', 'minimax');
const once = flag('once');
const quiet = flag('quiet');

if (!/^[A-Z0-9]{6}$/.test(room)) {
  console.error('用法: node scripts/mcp-bridge.mjs --room ABC123 [--level normal] [--engine minimax|llm]');
  process.exit(1);
}

const headers = { 'Content-Type': 'application/json' };
if (ACCESS_KEY) headers.Authorization = `Bearer ${ACCESS_KEY}`;

const log = (...msg) => {
  if (!quiet) console.log(...msg);
};

function opposite(color) {
  return color === 1 ? 2 : 1;
}

function aiSideOf(state) {
  if (state.game === 'gomoku') return opposite(state.humanSide);
  return state.humanSide === 'w' ? 'b' : 'w';
}

async function getRoom() {
  const res = await fetch(`${BASE}/api/room?code=${room}`, { headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data.room;
}

async function aiMove() {
  const res = await fetch(`${BASE}/api/room`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ action: 'ai_move', code: room, level, engine }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data.room;
}

function describe(state) {
  if (state.game === 'gomoku') {
    const last = state.moves[state.moves.length - 1];
    return `第 ${state.moves.length} 手 ${last ? last.label : '—'}`;
  }
  const last = state.moves[state.moves.length - 1];
  return `第 ${state.moves.length} 手 ${last ? `${last.fromLabel}→${last.toLabel}` : '—'}`;
}

async function main() {
  log(`bridge  →  ${BASE}  房间 ${room}  难度 ${level}  引擎 ${engine}`);
  let first = await getRoom();
  log(`棋种 ${first.game} · 人类执 ${first.humanSide} · AI 执 ${aiSideOf(first)}`);

  for (;;) {
    const state = await getRoom();
    if (state.status === 'over') {
      log('对局结束，bridge 退出');
      return;
    }
    if (String(state.turn) === String(aiSideOf(state))) {
      const started = Date.now();
      const next = await aiMove();
      log(`AI 应手 ${describe(next)} · ${Date.now() - started}ms · ${next.lastEngine || engine}`);
      if (once) return;
      continue;
    }
    await new Promise((r) => setTimeout(r, 800));
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('bridge error:', err.message);
    process.exit(1);
  });