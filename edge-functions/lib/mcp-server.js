/** MCP tool implementations (stateless: every call carries the full position). */
import {
  newBoard,
  decodeBoard,
  encodeBoard,
  turnOf,
  countStones,
  playMove,
  findBestMove,
  coordToLabel,
  labelToCoord,
  scanWinner,
  evaluateBoard,
} from './gomoku-ai.js';
import {
  START_FEN,
  parseFen,
  legalMoves,
  applyMoveByLabel,
  describe,
  labelOfIndex,
  parseSquare,
} from './chess-ai.js';
import { chooseGomoku, chooseChess } from './ai-service.js';
import { llmConfig } from './llm.js';
import { TOOLS, PROTOCOL_VERSION, SERVER_INFO, RULES_GOMOKU, RULES_CHESS } from './mcp-tools.js';
import { createRoom, getRoom, playInRoom, aiMoveInRoom } from './rooms.js';

function parseGomokuMove(input, size = 15) {
  if (Array.isArray(input) && input.length === 2) {
    const x = Number(input[0]);
    const y = Number(input[1]);
    if (Number.isInteger(x) && Number.isInteger(y) && x >= 0 && x < size && y >= 0 && y < size) {
      return y * size + x;
    }
  }
  if (typeof input === 'number' && Number.isInteger(input) && input >= 0 && input < size * size) {
    return input;
  }
  if (typeof input === 'string') {
    const s = input.trim();
    const pair = /^(\d{1,2})\s*,\s*(\d{1,2})$/.exec(s);
    if (pair) {
      const x = Number(pair[1]);
      const y = Number(pair[2]);
      if (x >= 0 && x < size && y >= 0 && y < size) return y * size + x;
    }
    const coord = labelToCoord(s, size);
    if (coord) return coord.idx;
  }
  throw new Error('invalid move: use "H8", [col,row] or "col,row"');
}

function playerLabel(player) {
  return player === 1 ? 'black' : 'white';
}

async function gomokuPlay(args) {
  const size = 15;
  const board = decodeBoard(args.board, size);
  const player = args.player === 1 || args.player === 2 ? args.player : turnOf(board);
  const expected = turnOf(board);
  if (player !== expected) {
    throw new Error(`it is ${playerLabel(expected)}'s turn (${expected}), not ${playerLabel(player)}`);
  }
  const idx = parseGomokuMove(args.move, size);
  if (board[idx] !== 0) throw new Error('that intersection is already occupied');
  const res = playMove(board, size, idx, player);
  return {
    board: encodeBoard(board),
    size,
    move: { index: idx, label: coordToLabel(idx, size) },
    player,
    playerLabel: playerLabel(player),
    win: res.win,
    winner: res.player || null,
    line: res.line.map((i) => coordToLabel(i, size)),
    gameOver: res.win,
    turn: res.turn,
    turnLabel: playerLabel(res.turn),
    rules: RULES_GOMOKU,
  };
}

async function gomokuAiMove(args, env) {
  const size = 15;
  const board = decodeBoard(args.board, size);
  const player = args.player === 1 || args.player === 2 ? args.player : turnOf(board);
  const expected = turnOf(board);
  if (player !== expected) {
    throw new Error(`it is ${playerLabel(expected)}'s turn (${expected}), not ${playerLabel(player)}`);
  }
  const level = ['easy', 'normal', 'hard'].includes(args.level) ? args.level : 'normal';
  const engine = args.engine === 'llm' ? 'llm' : 'local';
  const ai = await chooseGomoku({ board, player, level, engine, env });
  if (board[ai.move] !== 0) throw new Error('AI produced an occupied move');
  const res = playMove(board, size, ai.move, player);
  return {
    board: encodeBoard(board),
    size,
    move: {
      index: ai.move,
      label: ai.label || coordToLabel(ai.move, size),
      score: ai.score,
      engine: ai.engine,
      model: ai.model || null,
      depth: ai.depth,
      nodes: ai.nodes,
      timeMs: ai.timeMs,
      llmError: ai.llmError || null,
    },
    player,
    playerLabel: playerLabel(player),
    win: res.win,
    winner: res.player || null,
    line: res.line.map((i) => coordToLabel(i, size)),
    gameOver: res.win,
    turn: res.turn,
    turnLabel: playerLabel(res.turn),
  };
}

async function gomokuAnalyze(args) {
  const size = 15;
  const board = decodeBoard(args.board, size);
  const winner = scanWinner(board);
  const counts = countStones(board);
  const turn = turnOf(board);
  const blackBest = winner.win ? null : findBestMove(board, 1, { level: 'easy', depth: 2, timeMs: 25 });
  const whiteBest = winner.win ? null : findBestMove(board, 2, { level: 'easy', depth: 2, timeMs: 25 });
  return {
    size,
    ...counts,
    turn,
    turnLabel: playerLabel(turn),
    winner: winner.win
      ? { player: winner.player, label: playerLabel(winner.player), line: winner.line.map((i) => coordToLabel(i, size)) }
      : null,
    gameOver: winner.win,
    best: {
      black: blackBest ? { move: blackBest.move, label: coordToLabel(blackBest.move, size), score: blackBest.score } : null,
      white: whiteBest ? { move: whiteBest.move, label: coordToLabel(whiteBest.move, size), score: whiteBest.score } : null,
    },
    evaluation: {
      black: evaluateBoard(board, 1),
      white: evaluateBoard(board, 2),
    },
  };
}

function chessNewGame() {
  const parsed = parseFen(START_FEN);
  const moves = legalMoves(parsed.board, parsed.side);
  return {
    fen: START_FEN,
    turn: parsed.side,
    turnLabel: parsed.side === 'w' ? 'red' : 'black',
    legalMoves: moves.length,
    rules: RULES_CHESS,
    coordinates: 'ICCS：列 a-i（左→右），行 0-9（红方底线为 0），例如 b0→b2。',
  };
}

function chessPlay(args) {
  if (typeof args.fen !== 'string') throw new Error('fen is required');
  const res = applyMoveByLabel(args.fen, args.from, args.to);
  return {
    fen: res.fen,
    from: res.from,
    to: res.to,
    fromLabel: res.fromLabel,
    toLabel: res.toLabel,
    piece: res.piece,
    capture: res.capture,
    turn: res.fen.split(' ')[1],
    check: res.check,
    checkmate: res.checkmate,
    stalemate: res.stalemate,
    legalMoves: res.legalMoves,
    winner: res.winner,
    winnerLabel: res.winner === 'w' ? 'red' : res.winner === 'b' ? 'black' : null,
    gameOver: res.checkmate || res.stalemate,
  };
}

function chessLegalMoves(args) {
  if (typeof args.fen !== 'string') throw new Error('fen is required');
  const parsed = parseFen(args.fen);
  let moves = legalMoves(parsed.board, parsed.side);
  if (args.from) {
    const from = parseSquare(args.from);
    if (!from) throw new Error('invalid from square');
    moves = moves.filter((m) => m.from === from.idx);
  }
  return {
    side: parsed.side,
    sideLabel: parsed.side === 'w' ? 'red' : 'black',
    count: moves.length,
    moves: moves.slice(0, 120).map((m) => ({
      from: labelOfIndex(m.from),
      to: labelOfIndex(m.to),
      fromIdx: m.from,
      toIdx: m.to,
      piece: m.piece,
      capture: m.capture || null,
    })),
  };
}

async function chessAiMove(args, env) {
  if (typeof args.fen !== 'string') throw new Error('fen is required');
  const level = ['easy', 'normal', 'hard'].includes(args.level) ? args.level : 'normal';
  const engine = args.engine === 'llm' ? 'llm' : 'local';
  const res = await chooseChess({ fen: args.fen, level, engine, env });
  return {
    fen: res.fen,
    move: {
      from: res.from,
      to: res.to,
      fromLabel: res.fromLabel || labelOfIndex(res.from),
      toLabel: res.toLabel || labelOfIndex(res.to),
      piece: res.piece,
      capture: res.capture || null,
      engine: res.engine,
      model: res.model || null,
      score: res.score,
      depth: res.depth,
      nodes: res.nodes,
      timeMs: res.timeMs,
      llmError: res.llmError || null,
    },
    turn: res.fen.split(' ')[1],
    check: !!res.check,
    checkmate: !!res.checkmate,
    stalemate: !!res.stalemate,
    legalMoves: res.legalMoves,
    gameOver: !!res.checkmate || !!res.stalemate,
    winner: res.checkmate || res.stalemate ? (res.fen.split(' ')[1] === 'w' ? 'b' : 'w') : null,
  };
}

function chessStatus(args) {
  if (typeof args.fen !== 'string') throw new Error('fen is required');
  const d = describe(args.fen);
  return {
    fen: d.fen,
    side: d.side,
    sideLabel: d.sideLabel,
    check: d.check,
    checkmate: d.checkmate,
    stalemate: d.stalemate,
    legalMoves: d.legalMoves,
    material: { red: d.redMaterial, black: d.blackMaterial },
    pieces: d.pieces,
    moves: d.moves.slice(0, 120),
  };
}

function gameInfo(env) {
  const cfg = llmConfig(env);
  return {
    service: SERVER_INFO,
    protocol: PROTOCOL_VERSION,
    transport: 'Streamable HTTP (stateless JSON-RPC 2.0)',
    games: {
      gomoku: { size: '15x15', firstPlayer: 'black', rules: RULES_GOMOKU },
      chess: { size: '9x10', firstPlayer: 'red', rules: RULES_CHESS },
    },
    tools: TOOLS.map((t) => ({ name: t.name, title: t.title, description: t.description })),
    engines: {
      minimax: true,
      llm: cfg.enabled,
      model: cfg.enabled ? cfg.model : null,
    },
    usage: [
      '1. 调用 gomoku_new_game / chess_new_game 获取初始局面。',
      '2. 用 gomoku_play / chess_play 提交你的着法，返回新的 board / fen。',
      '3. 用 gomoku_ai_move / chess_ai_move 让 AI 应手，继续传递最新局面。',
      '所有工具无状态，局面通过 board / fen 参数携带，可并行、可跨客户端。',
    ],
  };
}

/** Execute an MCP tool. Throws on invalid input; the transport maps it to isError. */
export async function callTool(name, args = {}, env = {}) {
  const a = args && typeof args === 'object' ? args : {};
  switch (name) {
    case 'gomoku_new_game': {
      const size = 15;
      const board = newBoard(size);
      return {
        board: encodeBoard(board),
        size,
        turn: 1,
        turnLabel: 'black',
        rules: RULES_GOMOKU,
        coordinates: '列 A-O，行 1-15（行 1 在顶部）；也可用 [col,row]（0 起始）。',
      };
    }
    case 'gomoku_play':
      return gomokuPlay(a);
    case 'gomoku_ai_move':
      return gomokuAiMove(a, env);
    case 'gomoku_analyze':
      return gomokuAnalyze(a);
    case 'chess_new_game':
      return chessNewGame();
    case 'chess_play':
      return chessPlay(a);
    case 'chess_legal_moves':
      return chessLegalMoves(a);
    case 'chess_ai_move':
      return chessAiMove(a, env);
    case 'chess_status':
      return chessStatus(a);
    case 'room_create':
      return createRoom(env, { game: a.game, humanSide: a.humanSide });
    case 'room_state':
      return getRoom(env, a.code);
    case 'room_play':
      return playInRoom(env, a.code, a);
    case 'room_ai_move':
      return aiMoveInRoom(env, a.code, { level: a.level, engine: a.engine });
    case 'game_info':
      return gameInfo(env);
    default:
      throw new Error(`unknown tool: ${name}`);
  }
}