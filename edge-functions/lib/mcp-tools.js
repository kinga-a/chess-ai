/** Tool schemas exposed through the MCP server. */

export const PROTOCOL_VERSION = '2025-03-26';
export const SERVER_INFO = {
  name: 'edgeone-chess-ai',
  title: '棋境 · EdgeOne AI 棋馆',
  version: '1.4.2',
};

export const RULES_GOMOKU =
  '五子棋：15×15 棋盘，黑先。棋盘用 225 个字符表示（逐行，0 空 / 1 黑 / 2 白）。' +
  '坐标：列 A-O（左→右），行 1-15（上→下），例如 H8。也可用 [列,行]（0 起始）或 "列,行"。' +
  '率先横、竖、斜连成五子者胜。本服务无禁手规则。';

export const RULES_CHESS =
  '中国象棋：9 列 × 10 行，红先。使用标准 Xiangqi FEN，例如 ' +
  '"rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1"。' +
  '坐标：ICCS，列 a-i（左→右），行 0-9（红方底线为 0），例如 b0→b2。' +
  '包含蹩马腿、塞象眼、炮翻山、过河兵、九宫限制与将帅照面规则；将死或困毙均判负。';

export const TOOLS = [
  {
    name: 'gomoku_new_game',
    title: '新建五子棋棋局',
    description: '创建一个空白的 15×15 五子棋棋局，返回棋盘字符串、执子方与坐标说明。',
    inputSchema: {
      type: 'object',
      properties: {
        size: { type: 'integer', enum: [15], description: '棋盘尺寸，固定 15' },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, idempotentHint: true },
  },
  {
    name: 'gomoku_play',
    title: '五子棋落子',
    description: '在棋盘上落下一子并返回新局面、胜负与下一手。棋局状态通过 board 参数传递（无状态）。',
    inputSchema: {
      type: 'object',
      properties: {
        board: {
          type: 'string',
          pattern: '^[012]{225}$',
          description: '225 个字符的棋盘，逐行排列，0 空 / 1 黑 / 2 白',
        },
        move: {
          oneOf: [
            { type: 'string', pattern: '^[A-Oa-o](1[0-5]|[1-9])$', description: '坐标，如 "H8"' },
            { type: 'string', pattern: '^\\d{1,2},\\d{1,2}$', description: '列,行（0 起始），如 "7,7"' },
            { type: 'array', items: { type: 'integer' }, minItems: 2, maxItems: 2, description: '[列,行]（0 起始）' },
          ],
          description: '落子位置',
        },
        player: { type: 'integer', enum: [1, 2], description: '1 黑 / 2 白；省略时按棋子数推断' },
      },
      required: ['board', 'move'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false },
  },
  {
    name: 'gomoku_ai_move',
    title: '五子棋 AI 落子',
    description:
      '让 AI 计算一步并落在棋盘上，返回新棋盘与思考信息。engine=llm 时优先调用大模型，失败自动回退 minimax。',
    inputSchema: {
      type: 'object',
      properties: {
        board: { type: 'string', pattern: '^[012]{225}$', description: '225 个字符的棋盘' },
        player: { type: 'integer', enum: [1, 2], description: 'AI 执子颜色；省略时推断' },
        level: { type: 'string', enum: ['easy', 'normal', 'hard'], description: '搜索强度' },
        engine: { type: 'string', enum: ['minimax', 'llm'], description: 'AI 引擎，默认 minimax' },
      },
      required: ['board'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false },
  },
  {
    name: 'gomoku_analyze',
    title: '五子棋局面分析',
    description: '分析当前五子棋局面：手数、执子方、胜负、双方最佳落点与静态评估。',
    inputSchema: {
      type: 'object',
      properties: {
        board: { type: 'string', pattern: '^[012]{225}$', description: '225 个字符的棋盘' },
      },
      required: ['board'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'chess_new_game',
    title: '新建中国象棋棋局',
    description: '创建一局标准中国象棋，返回起始 FEN、执子方与合法着法数量。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: false, idempotentHint: true },
  },
  {
    name: 'chess_play',
    title: '中国象棋走子',
    description: '按 ICCS 坐标走一步棋，校验合法性并返回新 FEN、将军 / 绝杀状态与下一手。',
    inputSchema: {
      type: 'object',
      properties: {
        fen: { type: 'string', description: '当前局面 FEN' },
        from: { type: 'string', description: '起点，如 "b0"' },
        to: { type: 'string', description: '终点，如 "b2"' },
      },
      required: ['fen', 'from', 'to'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false },
  },
  {
    name: 'chess_legal_moves',
    title: '查询合法着法',
    description: '列出当前局面的全部合法着法，可按起点过滤。',
    inputSchema: {
      type: 'object',
      properties: {
        fen: { type: 'string', description: '当前局面 FEN' },
        from: { type: 'string', description: '可选起点，如 "b0"' },
      },
      required: ['fen'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'chess_ai_move',
    title: '中国象棋 AI 走子',
    description: '让 AI 计算一步并返回新 FEN 与着法。engine=llm 时优先大模型，失败自动回退 minimax。',
    inputSchema: {
      type: 'object',
      properties: {
        fen: { type: 'string', description: '当前局面 FEN' },
        level: { type: 'string', enum: ['easy', 'normal', 'hard'], description: '搜索强度' },
        engine: { type: 'string', enum: ['minimax', 'llm'], description: 'AI 引擎，默认 minimax' },
      },
      required: ['fen'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false },
  },
  {
    name: 'chess_status',
    title: '中国象棋局面状态',
    description: '解析 FEN 并返回执子方、将军 / 绝杀、合法着法数量、子力与棋子位置。',
    inputSchema: {
      type: 'object',
      properties: { fen: { type: 'string', description: '局面 FEN' } },
      required: ['fen'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'room_create',
    title: '创建实时对战房间',
    description:
      '创建一个联机房间并返回 6 位房间码。网页端用相同房间码加入，MCP 与网页共用同一棋盘，可实时对战。',
    inputSchema: {
      type: 'object',
      properties: {
        game: { type: 'string', enum: ['gomoku', 'chess', 'tictactoe', 'connect4', 'othello'], description: '默认 gomoku' },
        humanSide: {
          type: 'string',
          enum: ['first', 'second', 'red', 'black'],
          description: '人类执子：五子棋 first/second，象棋 red/black',
        },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false },
  },
  {
    name: 'room_state',
    title: '读取房间局面',
    description: '返回房间的棋盘 / FEN、当前轮次、胜负状态与完整着法记录。',
    inputSchema: {
      type: 'object',
      properties: { code: { type: 'string', pattern: '^[A-Z0-9]{6}$', description: '6 位房间码' } },
      required: ['code'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'room_play',
    title: '在房间落子',
    description:
      '以当前轮次一方落子并写回房间。五子棋传 move（如 "H8"）；象棋传 from / to（如 "b0" / "b2"）。',
    inputSchema: {
      type: 'object',
      properties: {
        code: { type: 'string', pattern: '^[A-Z0-9]{6}$' },
        move: {
          oneOf: [
            { type: 'string' },
            { type: 'array', items: { type: 'integer' }, minItems: 2, maxItems: 2 },
            { type: 'integer' },
          ],
          description: '五子棋落点',
        },
        from: { type: 'string', description: '象棋起点' },
        to: { type: 'string', description: '象棋终点' },
        player: { description: '1/2 或 w/b；省略时按当前轮次' },
      },
      required: ['code'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false },
  },
  {
    name: 'room_ai_move',
    title: '房间 AI 应手',
    description:
      '让服务端 AI 在当前房间落一手并写回房间；网页端轮询即可看到这步棋。engine=llm 时优先大模型。',
    inputSchema: {
      type: 'object',
      properties: {
        code: { type: 'string', pattern: '^[A-Z0-9]{6}$' },
        level: { type: 'string', enum: ['easy', 'normal', 'hard'] },
        engine: { type: 'string', enum: ['minimax', 'llm'] },
      },
      required: ['code'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false },
  },
  {
    name: 'room_tick',
    title: '房间轮询并应手',
    description:
      '一次调用完成「读局面 + 轮到自己则落子」，适合桥接高频轮询，比 room_state + room_ai_move 少一半往返。',
    inputSchema: {
      type: 'object',
      properties: {
        code: { type: 'string', pattern: '^[A-Z0-9]{6}$' },
        level: { type: 'string', enum: ['easy', 'normal', 'hard'] },
        engine: { type: 'string', enum: ['minimax', 'llm'] },
      },
      required: ['code'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false },
  },
  {
    name: 'game_info',
    title: '棋馆与 MCP 说明',
    description: '返回棋馆信息、规则、可用工具与大模型配置状态。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
  },
];

export function findTool(name) {
  return TOOLS.find((t) => t.name === name) || null;
}