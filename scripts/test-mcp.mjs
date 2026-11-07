/**
 * End-to-end MCP protocol test. Requires the dev server:
 *   npm run dev
 *   node scripts/test-mcp.mjs http://localhost:8788/api/mcp
 */
const endpoint = process.argv[2] || 'http://localhost:8788/api/mcp';
const accessKey = process.env.ACCESS_KEY || '';
const baseHeaders = {
  'Content-Type': 'application/json',
  Accept: 'application/json, text/event-stream',
};
if (accessKey) baseHeaders.Authorization = `Bearer ${accessKey}`;
let id = 0;

async function rpc(method, params) {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: baseHeaders,
    body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }),
  });
  const text = await res.text();
  if (!res.ok && res.status !== 202) throw new Error(`HTTP ${res.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

async function call(name, args = {}) {
  const res = await rpc('tools/call', { name, arguments: args });
  assert(res && res.result, `tool ${name} failed: ${JSON.stringify(res)}`);
  if (res.result.isError) throw new Error(`tool ${name} returned error: ${res.result.content[0].text}`);
  return res.result.structuredContent;
}

async function main() {
  console.log(`MCP endpoint: ${endpoint}`);

  const init = await rpc('initialize', {
    protocolVersion: '2025-03-26',
    capabilities: {},
    clientInfo: { name: 'edgeone-test', version: '1.0.0' },
  });
  assert(init.result && init.result.serverInfo, 'initialize failed');
  console.log('✓ initialize', init.result.protocolVersion, init.result.serverInfo.name);

  const notified = await fetch(endpoint, {
    method: 'POST',
    headers: baseHeaders,
    body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
  });
  assert(notified.status === 202, `notification should be 202, got ${notified.status}`);
  console.log('✓ notifications/initialized');

  const list = await rpc('tools/list');
  assert(Array.isArray(list.result.tools) && list.result.tools.length >= 10, 'tools/list failed');
  console.log('✓ tools/list:', list.result.tools.map((t) => t.name).join(', '));

  const info = await call('game_info');
  assert(info.games && info.games.gomoku, 'game_info failed');
  console.log('✓ game_info');

  // Gomoku: create → play → AI reply → analyze
  const g = await call('gomoku_new_game');
  assert(g.board.length === 225 && g.turn === 1, 'gomoku_new_game failed');
  const played = await call('gomoku_play', { board: g.board, move: 'H8' });
  assert(played.board[7 * 15 + 7] === '1' && played.turn === 2, 'gomoku_play failed');
  const ai = await call('gomoku_ai_move', { board: played.board, player: 2, level: 'normal' });
  assert(ai.board && ai.move && ai.board.split('').filter((c) => c !== '0').length === 2, 'gomoku_ai_move failed');
  console.log('✓ gomoku flow:', played.move.label, '→ AI', ai.move.label, 'engine=' + ai.move.engine);
  const analysis = await call('gomoku_analyze', { board: ai.board });
  assert(analysis.best && analysis.best.black, 'gomoku_analyze failed');
  console.log('✓ gomoku_analyze');

  // Chess: create → legal moves → play → AI reply → status
  const c = await call('chess_new_game');
  assert(c.fen && c.legalMoves === 44, 'chess_new_game failed');
  const legal = await call('chess_legal_moves', { fen: c.fen, from: 'b2' });
  assert(legal.count > 0, 'chess_legal_moves failed');
  const move = legal.moves[0];
  const moved = await call('chess_play', { fen: c.fen, from: move.from, to: move.to });
  assert(moved.fen && moved.turn === 'b', 'chess_play failed');
  const chessAi = await call('chess_ai_move', { fen: moved.fen, level: 'normal' });
  assert(chessAi.fen && chessAi.move && chessAi.move.fromLabel, 'chess_ai_move failed');
  console.log('✓ chess flow:', move.from, '→', move.to, '| AI', chessAi.move.fromLabel, '→', chessAi.move.toLabel);
  const status = await call('chess_status', { fen: chessAi.fen });
  assert(status.side && typeof status.legalMoves === 'number', 'chess_status failed');
  console.log('✓ chess_status: side=' + status.side + ' legal=' + status.legalMoves);

  // Invalid input should surface as an MCP tool error, not a crash.
  const bad = await rpc('tools/call', {
    name: 'gomoku_play',
    arguments: { board: g.board, move: 'Z99' },
  });
  assert(bad.result && bad.result.isError === true, 'invalid move should be an error result');
  console.log('✓ invalid input handled gracefully');

  console.log('\nAll MCP checks passed.');
}

main().catch((err) => {
  console.error('\nMCP test failed:', err.message);
  process.exit(1);
});