/**
 * Live MCP walkthrough against a running deployment.
 *
 *   MCP_URL=https://your-domain/api/mcp ACCESS_KEY=xxx node scripts/mcp-demo.mjs
 *
 * Prints a readable transcript: handshake, tool discovery, a gomoku exchange
 * and a chess exchange, including which engine produced every move.
 */
const endpoint = process.env.MCP_URL || process.argv[2] || 'http://127.0.0.1:8788/api/mcp';
const accessKey = process.env.ACCESS_KEY || '';
const baseHeaders = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };
if (accessKey) baseHeaders.Authorization = `Bearer ${accessKey}`;

let id = 0;

async function rpc(method, params) {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: baseHeaders,
    body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }),
  });
  const text = await res.text();
  if (!res.ok && res.status !== 202) throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

async function call(name, args = {}) {
  const res = await rpc('tools/call', { name, arguments: args });
  if (!res || !res.result) throw new Error(`${name} failed: ${JSON.stringify(res)}`);
  if (res.result.isError) throw new Error(`${name}: ${res.result.content[0].text}`);
  return res.result.structuredContent;
}

function drawBoard(board, size = 15) {
  const glyph = { 0: '·', 1: '●', 2: '○' };
  const lines = [];
  for (let r = 0; r < size; r += 1) {
    lines.push(Array.from({ length: size }, (_, c) => glyph[board[r * size + c]]).join(' '));
  }
  return lines.join('\n');
}

const t0 = Date.now();
console.log(`endpoint : ${endpoint}`);
console.log(`auth     : ${accessKey ? 'Bearer ****' : 'none (open deployment)'}\n`);

const init = await rpc('initialize', {
  protocolVersion: '2025-03-26',
  capabilities: {},
  clientInfo: { name: 'mcp-demo', version: '1.0.0' },
});
console.log(`[initialize] ${init.result.protocolVersion} · ${init.result.serverInfo.name} v${init.result.serverInfo.version}`);

await fetch(endpoint, {
  method: 'POST',
  headers: baseHeaders,
  body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
});

const list = await rpc('tools/list');
console.log(`[tools/list] ${list.result.tools.length} tools: ${list.result.tools.map((t) => t.name).join(', ')}`);

const info = await call('game_info');
console.log(`[game_info] minimax=${info.engines.minimax} llm=${info.engines.llm}${info.engines.model ? ` (${info.engines.model})` : ''}\n`);

/* ---------------- gomoku ---------------- */
let g = await call('gomoku_new_game');
const gomokuLog = [];
for (const [humanMove, level] of [['H8', 'normal'], ['I9', 'normal'], ['J10', 'hard']]) {
  const played = await call('gomoku_play', { board: g.board, move: humanMove });
  gomokuLog.push(`你 ${played.move.label}`);
  const ai = await call('gomoku_ai_move', { board: played.board, player: 2, level });
  gomokuLog.push(
    `AI ${ai.move.label} [${ai.move.engine}${ai.move.model ? '/' + ai.move.model : ''} · depth ${ai.move.depth} · ${ai.move.timeMs}ms]`,
  );
  g = ai;
  if (g.gameOver) break;
}

console.log('=== 五子棋（你执黑 · AI 执白）===');
console.log(gomokuLog.join('\n'));
const analysis = await call('gomoku_analyze', { board: g.board });
console.log(
  `手数 ${analysis.total} · 下一手 ${analysis.turnLabel} · 最佳黑点 ${analysis.best.black ? analysis.best.black.label : '—'} · 最佳白点 ${analysis.best.white ? analysis.best.white.label : '—'}${analysis.gameOver ? ' · 已结束' : ''}`,
);
console.log(drawBoard(g.board));
console.log();

/* ---------------- chess ---------------- */
const c = await call('chess_new_game');
const first = await call('chess_legal_moves', { fen: c.fen, from: 'b2' });
const pick = first.moves[0];
const moved = await call('chess_play', { fen: c.fen, from: pick.from, to: pick.to });
const chessAi = await call('chess_ai_move', { fen: moved.fen, level: 'normal' });
const status = await call('chess_status', { fen: chessAi.fen });

console.log('=== 中国象棋（你执红）===');
console.log(`你 ${moved.fromLabel}→${moved.toLabel}（${moved.piece}${moved.capture ? ' 吃 ' + moved.capture : ''}）`);
console.log(
  `AI ${chessAi.move.fromLabel}→${chessAi.move.toLabel} [${chessAi.move.engine}${chessAi.move.model ? '/' + chessAi.move.model : ''} · depth ${chessAi.move.depth} · ${chessAi.move.timeMs}ms]`,
);
console.log(`局面：${status.side === 'w' ? '红方' : '黑方'}走 · 合法着法 ${status.legalMoves} · 将军 ${status.check} · 绝杀 ${status.checkmate}`);
console.log(`FEN：${chessAi.fen}`);
console.log();

// Error contract: bad input must come back as a tool error, not a crash.
const bad = await rpc('tools/call', { name: 'gomoku_play', arguments: { board: g.board, move: 'Z99' } });
console.log(`[error contract] invalid move → isError=${bad.result && bad.result.isError}`);

console.log(`\n全部完成，用时 ${Date.now() - t0}ms。`);