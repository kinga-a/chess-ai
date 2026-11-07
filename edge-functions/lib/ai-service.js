/**
 * Shared AI service used by both HTTP endpoints and the MCP tools.
 * Minimax always runs inside the edge/worker budget; the optional LLM path
 * falls back to minimax on timeout, network errors or illegal moves.
 */
import {
  findBestMove as gomokuBest,
  coordToLabel,
  labelToCoord,
  encodeBoard,
} from './gomoku-ai.js';
import {
  findBestMove as chessBest,
  parseFen,
  legalMoves,
  applyMoveByLabel,
  labelOfIndex,
  parseSquare,
} from './chess-ai.js';
import { chatJSON, llmConfig } from './llm.js';

const EDGE_TIME_MS = 95;
const GOMOKU_DEPTH = { easy: 1, normal: 2, hard: 3 };
const CHESS_DEPTH = { easy: 1, normal: 2, hard: 3 };

export async function chooseGomoku({ board, player, level = 'normal', engine = 'local', env = {} }) {
  const started = Date.now();
  const fallback = (llmError) => {
    const res = gomokuBest(board, player, {
      level,
      depth: GOMOKU_DEPTH[level] || 2,
      timeMs: EDGE_TIME_MS,
    });
    return {
      move: res.move,
      label: coordToLabel(res.move),
      score: res.score,
      depth: res.depth,
      nodes: res.nodes,
      timeMs: Date.now() - started,
      level,
      engine: 'minimax',
      reason: res.reason || null,
      llmError: llmError || null,
    };
  };

  if (engine !== 'llm' || !llmConfig(env).enabled) return fallback();

  const encoded = encodeBoard(board);
  const rows = [];
  for (let y = 0; y < 15; y++) rows.push(encoded.slice(y * 15, y * 15 + 15));
  const reply = await chatJSON(
    env,
    [
      {
        role: 'system',
        content:
          '你是五子棋职业棋手。棋盘 15×15，坐标列 A-O 从左到右，行 1-15 从上到下。' +
          '棋盘字符 0 空、1 黑、2 白。只输出 JSON {"move":"H8"}，不要解释。',
      },
      {
        role: 'user',
        content: `棋盘：\n${rows.join('\n')}\n轮到：${player === 1 ? '黑方' : '白方'}，请给出最佳落子。`,
      },
    ],
    { timeoutMs: 7000, maxTokens: 60 },
  );
  if (reply.ok && reply.data && reply.data.move) {
    const coord = labelToCoord(String(reply.data.move));
    if (coord && board[coord.idx] === 0) {
      return {
        move: coord.idx,
        label: coordToLabel(coord.idx),
        score: 0,
        depth: 0,
        nodes: 0,
        timeMs: Date.now() - started,
        level,
        engine: 'llm',
        model: reply.model,
        llmError: null,
      };
    }
  }
  return fallback(reply.error || 'llm returned an illegal move');
}

export async function chooseChess({ fen, level = 'normal', engine = 'local', env = {}, avoid = null }) {
  const started = Date.now();
  const parsed = parseFen(fen);
  const moves = legalMoves(parsed.board, parsed.side);
  if (!moves.length) throw new Error('the game is already over (no legal moves)');

  const fallback = (llmError) => {
    const res = chessBest(fen, {
      level,
      depth: CHESS_DEPTH[level] || 2,
      timeMs: EDGE_TIME_MS,
      avoid,
    });
    return { ...res, engine: 'minimax', llmError: llmError || null };
  };

  if (engine !== 'llm' || !llmConfig(env).enabled) return fallback();

  const sample = moves.slice(0, 48).map((m) => `${labelOfIndex(m.from)}->${labelOfIndex(m.to)}`);
  const reply = await chatJSON(
    env,
    [
      {
        role: 'system',
        content:
          '你是中国象棋职业棋手。坐标：列 a-i，行 0-9，红方底线为 0，红方在上方棋盘的视角。' +
          '只输出 JSON {"from":"b0","to":"b2"}，必须从给出的合法着法中选择，不要解释。',
      },
      {
        role: 'user',
        content: `FEN: ${fen}\n轮到：${parsed.side === 'w' ? '红方' : '黑方'}\n合法着法（部分）：\n${sample.join('\n')}\n请给出一步。`,
      },
    ],
    { timeoutMs: 7000, maxTokens: 60 },
  );

  if (reply.ok && reply.data) {
    const from = parseSquare(reply.data.from);
    const to = parseSquare(reply.data.to);
    if (from && to) {
      const mv = moves.find((m) => m.from === from.idx && m.to === to.idx);
      if (mv) {
        const applied = applyMoveByLabel(fen, from, to);
        return {
          from: mv.from,
          to: mv.to,
          fromLabel: labelOfIndex(mv.from),
          toLabel: labelOfIndex(mv.to),
          piece: mv.piece,
          capture: mv.capture,
          fen: applied.fen,
          score: 0,
          depth: 0,
          nodes: 0,
          timeMs: Date.now() - started,
          level,
          engine: 'llm',
          model: reply.model,
          check: applied.check,
          checkmate: applied.checkmate,
          stalemate: applied.stalemate,
          legalMoves: applied.legalMoves,
          llmError: null,
        };
      }
    }
  }
  return fallback(reply.error || 'llm returned an illegal move');
}