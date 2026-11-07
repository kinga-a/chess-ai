# 棋境 · EdgeOne AI 棋馆

> 当前版本 **v1.2.9**

部署在 **EdgeOne Makers** 上的五子棋 + 中国象棋 AI 对弈馆。零依赖单页前端，内置本地 minimax 引擎、边缘函数 AI 接口，以及一个 **MCP Server**——任何支持 MCP 的 AI 客户端（Claude Desktop、Cursor、自研 Agent）都能直接接入，实时查局、走子、让 AI 落子。

## 特性

| 能力 | 说明 |
|------|------|
| 五子棋 | 15×15，棋型评分 + 候选点剪枝 + 迭代加深 negamax + 必胜/必防判定 |
| 中国象棋 | 标准 FEN/ICCS，蹩马腿、塞象眼、炮翻山、过河兵、九宫、将帅照面、将死困毙 |
| 三种 AI 引擎 | `local`（浏览器 Web Worker）→ `edge`（边缘函数）→ `llm`（大模型接管），逐级自动降级 |
| MCP Server | Streamable HTTP + JSON-RPC 2.0，14 个工具（含 4 个联机房间工具），无状态棋局 |
| **访问控制** | 网页用 `ADMIN_PASS`、MCP 用 `ACCESS_KEY`，两把密钥独立；Bearer 校验 + 失败限速 |
| **实时联机** | 6 位房间码双人同盘，网页轮询自动同步；MCP 客户端或 bridge 可直接在房间落子 |
| 体验 | 粒子/涟漪/彩带特效、Web Audio 合成音效、悔棋、棋谱、移动端适配、localStorage 战绩 |
| 可靠性 | 搜索超时用 `try/finally` 回滚，保证返回的棋盘/FEN 始终合法 |

## 目录结构

```
.
├── index.html                  # 单页应用：入馆验证 + 大厅 + 两棋局 + 3 个弹层
├── css/style.css               # 水墨/玉/金主题，完整响应式
├── js/
│   ├── app.js                  # 路由、大厅、战绩、MCP 面板、棋盘预览
│   ├── auth-gate.js            # 入馆口令遮罩与解锁流程
│   ├── room-client.js          # 联机房间：创建/加入/轮询/落子
│   ├── engine-client.js        # local / edge / llm 引擎调度与降级
│   ├── core/
│   │   ├── api.js              # 统一 fetch 封装，自动附带访问密钥
│   │   ├── audio.js            # 合成音效
│   │   └── fx.js               # 粒子特效
│   ├── ai/
│   │   ├── gomoku-ai.js        # 五子棋引擎（前端与边缘同构）
│   │   ├── chess-ai.js         # 中国象棋引擎（前端与边缘同构）
│   │   └── worker.js           # AI Web Worker，避免阻塞 UI
│   └── games/                  # 两棋局的渲染与交互
├── edge-functions/
│   ├── api/health.js           # GET /api/health（公开，报告鉴权状态）
│   ├── api/auth/check.js       # POST /api/auth/check（校验口令）
│   ├── api/ai/gomoku.js        # POST /api/ai/gomoku（需密钥）
│   ├── api/ai/chess.js         # POST /api/ai/chess（需密钥）
│   ├── api/mcp.js              # MCP 端点 /api/mcp（需密钥）
│   ├── api/room.js             # 联机房间 create/move（需密钥）
│   └── lib/                    # auth、房间存储、引擎副本、LLM 客户端、MCP 协议与工具
├── scripts/                    # 本地 dev server 与测试
├── edgeone.json                # 部署配置（nodeVersion、缓存头）
└── package.json
```

> 修改 `js/ai/*.js` 后请同步边缘副本：
> `cp js/ai/gomoku-ai.js edge-functions/lib/ && cp js/ai/chess-ai.js edge-functions/lib/`

## 访问控制（重要）

两把密钥，职责分离：

| 面 | 使用的密钥 | 行为 |
|----|-----------|------|
| 网页 / 浏览器 API | `ADMIN_PASS` | 打开出现「入馆验证」；`/api/ai/*`、`/api/room`、`/api/auth/check` 需 Bearer 头 |
| MCP | `ACCESS_KEY` | `/api/mcp` 独立校验；网页口令进不了 MCP，MCP 密钥也进不了网页接口 |
| 防爆破 | 两者各自计数 | 同一 IP 每分钟 8 次失败 → `429`（`Retry-After: 60`） |
| 未配置 | — | 对应面直接开放；`/api/health` 报告 `auth.enabled` 与 `auth.mcp.enabled` |

两把密钥互不替代：只设 `ADMIN_PASS` → MCP 无需密钥；只设 `ACCESS_KEY` → 网页无需口令；都不设 → 全部开放。

支持的携带方式（两把密钥通用）：

```http
Authorization: Bearer <key>
X-Access-Key: <key>
X-MCP-Key: <key>
```

> `?key=` 仅作兼容兜底，可能出现在访问日志中，公网场景请用请求头。

安全说明：口令门保护的是**所有数据与算力接口**；`index.html / js / css` 属于静态资源，浏览器必须能下载才能运行，因此不要在其中放置任何机密信息。真正需要彻底隐藏页面时，应在 EdgeOne 控制台配置访问控制或私有源。

## 本地开发

```bash
npm run dev            # 无密钥，http://localhost:8788
npm run dev:secure     # 带密钥 dev-secret，用于体验验证流程
```

`scripts/dev-server.mjs` 同时模拟静态托管与 `edge-functions` 的按路径路由，所以 `/api/*` 与线上行为一致。

### 测试

```bash
npm test                          # 五子棋 9 项 + 象棋 13 项引擎单测
npm run test:auth                 # 鉴权：401 / 正确密钥 / 限速（自起服务）
node scripts/test-timeout.mjs     # 搜索超时后棋盘完整性（12 轮）
node scripts/test-api.mjs         # HTTP 接口（需先 npm run dev）
node scripts/test-mcp.mjs         # MCP JSON-RPC 全流程（需先 npm run dev）
node scripts/test-room.mjs        # 联机房间 API + MCP 房间工具
node scripts/mcp-demo.mjs         # 可读的 MCP 对局演示（本地）
MCP_URL=https://<域名>/api/mcp ACCESS_KEY=<key> node scripts/mcp-demo.mjs   # 演示公网部署
python3 scripts/ui-room-check.py       # 双浏览器联机同步
python3 scripts/ui-room-mcp-check.py   # 网页 + bridge 实时对弈
python3 scripts/ui-check.py       # 浏览器冒烟 + 截图（无密钥模式）
python3 scripts/ui-auth-check.py  # 入馆验证流程 + 截图（自动起带密钥服务）
```

## 部署到 EdgeOne Makers

**方式一：Git 导入（推荐）**

1. 将仓库推送到 GitHub / GitLab / Gitee；
2. EdgeOne Makers 控制台 → 新建项目 → 导入该仓库；
3. 框架预设选「其他 / 静态站点」，构建命令**留空**，输出目录填 `.`；
4. **在环境变量中添加 `ADMIN_PASS` 与 `ACCESS_KEY`**（两者独立）；
5. 部署完成后绑定域名即可访问；`edge-functions/` 下的文件会自动注册为边缘函数。

**方式二：CLI**

```bash
edgeone login
edgeone deploy
```

`edgeone.json` 已声明 `nodeVersion: 22.11.0` 与静态资源缓存头，无需额外构建。

### 环境变量

| 变量 | 必填 | 默认 | 说明 |
|------|------|------|------|
| `ADMIN_PASS` | 建议 | — | 网页与浏览器 API（AI / 房间 / 登录校验）口令；未配置则网页开放 |
| `ACCESS_KEY` | 建议 | — | 仅用于 MCP 端点 `/api/mcp`；未配置则 MCP 开放 |
| `AI_API_KEY` | 否 | — | OpenAI 兼容接口密钥；也兼容 `OPENAI_API_KEY` / `DEEPSEEK_API_KEY` / `HUNYUAN_API_KEY` |
| `AI_BASE_URL` | 否 | `https://api.deepseek.com/v1` | 任意 OpenAI 兼容 `/chat/completions` 地址 |
| `AI_MODEL` | 否 | `deepseek-chat` | 模型名 |

不配置大模型也能完整游玩——AI 走本地/边缘 minimax。LLM 调用失败、超时（7s）或返回非 JSON 时，会自动回退 minimax，玩家无感知。

### KV 存储（联机房间，建议绑定）

联机房间默认放在函数进程内存里。Edge Functions 是弹性多实例，A 实例写入的房间 B 实例读不到，轮询就可能 404 或不同步；**正式公网部署请绑定 KV**。

1. EdgeOne 控制台 → **KV 存储** → 新建命名空间（如 `qijing-rooms`）；
2. 项目 → 环境变量 / 绑定 → 新增绑定，**变量名必须为 `CHESS_KV`**；
3. 重新部署。代码检测到 `env.CHESS_KV` 后自动启用（仍兼容旧的 `env.KV`），无需改动逻辑。

存储键：`room:<6位房间码>`，值为整个房间的 JSON：

| 字段 | 说明 |
|------|------|
| `board` / `fen` | 五子棋 225 位棋盘串 / 象棋 FEN |
| `moves[]` | 完整着法记录，网页据此做增量同步与动画 |
| `turn` / `status` / `winner` / `reason` | 当前轮次、进行中/已结束、胜者与结束原因 |
| `version` | 每次写入递增，轮询仅在变化时应用 |
| `humanSide` | 创建者执子（加入者自动执另一方） |
| `code` / `game` / `created` / `updated` | 房间码、棋种、创建与最后活动时间 |

未绑定 KV 时自动回退进程内存储（单实例/本地开发够用）；房间 3 小时未更新即过期，过期记录在读取时自动删除，不会无限累积。单机对局、战绩（localStorage）和 MCP 无状态棋局都**不**写入 KV。

## MCP 接入

端点：`https://<你的域名>/api/mcp`，传输方式 **Streamable HTTP**，协议版本 `2025-03-26`，无状态（棋局通过 `board` / `fen` 参数往返）。

配置了 `ACCESS_KEY` 后的客户端配置：

```json
{
  "mcpServers": {
    "edgeone-chess-ai": {
      "type": "http",
      "url": "https://your-project.edgeone.app/api/mcp",
      "headers": {
        "Authorization": "Bearer <YOUR_ACCESS_KEY>"
      }
    }
  }
}
```

未启用密钥时去掉 `headers` 即可。

验证连通性：

```bash
curl -X POST https://your-domain/api/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ACCESS_KEY" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

### 工具清单

| 工具 | 类型 | 作用 |
|------|------|------|
| `gomoku_new_game` | 写 | 新建 15×15 空棋盘 |
| `gomoku_play` | 写 | 落子（`H8` / `"7,7"` / `[7,7]`），返回局面与胜负 |
| `gomoku_ai_move` | 写 | AI 落子，可指定 `level` 与 `engine=minimax|llm` |
| `gomoku_analyze` | 读 | 手数、执子方、胜负、双方最佳点 |
| `chess_new_game` | 写 | 返回标准起始 FEN |
| `chess_play` | 写 | 按 ICCS 走子（如 `b0`→`b2`），校验合法性 |
| `chess_legal_moves` | 读 | 列全部合法着法，可按起点过滤 |
| `chess_ai_move` | 写 | AI 走子，返回新 FEN |
| `chess_status` | 读 | 将军/绝杀、子力、坐标 |
| `game_info` | 读 | 棋馆信息、规则、工具列表、LLM 配置状态 |
| `room_create` | 写 | 创建实时对战房间，返回 6 位房间码 |
| `room_state` | 读 | 读取房间棋盘/FEN、轮次、胜负与着法 |
| `room_play` | 写 | 在房间落子（五子棋 `H8` / 象棋 `from,to`） |
| `room_ai_move` | 写 | 服务端 AI 在房间应手 |

## 实时联机对战

网页 → 游戏页右上角「联机」→ 创建房间（选执子）或输入 6 位房间码加入。双方共用同一棋盘，页面每 1.2 秒轮询一次并自动同步对方着法。

房间状态默认存放在 Edge Functions 的进程内存储；绑定 **KV**（`env.KV`）后跨实例共享，适合多实例部署。未绑定 KV 时单实例可用，房间 3 小时过期。

### 房间簿

创建或加入过的房间会记在浏览器本地（`qijing.rooms.v1`，最多 20 条）。在「联机对局」弹层里可以直接重新进入、单个删除或「清除全部」。

删除会调用服务端 `action: "delete"`，把房间从内存 / KV 中真正移除；过期或已关闭的房间在点击进入时会自动从列表清除，不会越积越多。

### 让 AI / MCP 客户端坐进房间

| 方式 | 操作 |
|------|------|
| MCP 工具 | `room_state {code}` 读局面；`room_play {code, move}` 以当前轮次落子；`room_ai_move {code}` 让服务端引擎应手 |
| AI 桥接 | `node scripts/mcp-bridge.mjs --room <CODE> --level normal`，轮到自己时自动应手 |
| 外部大模型 | MCP 客户端接入本服务后，提示模型「你在房间 <CODE> 执白，轮到你时调用 room_play」 |

桥接脚本连接公网部署：

```bash
BASE=https://<域名> ACCESS_KEY=<key> node scripts/mcp-bridge.mjs --room ABC123 --level hard
```

> 房间落子采用「服务端权威」：网页点击后先提交，服务器校验轮次与合法性，再返回新局面；轮询只在版本变化时增量应用，不会重复落子。

## HTTP 接口

| 方法 | 路径 | 鉴权 | 说明 |
|------|------|------|------|
| GET | `/api/health` | 公开 | 服务状态、`auth.enabled`、可用引擎（LLM 细节仅鉴权后返回） |
| POST | `/api/auth/check` | 校验对象 | `{ key }` 或 Bearer 头 → `{ ok, enabled }`，供入馆验证 |
| POST | `/api/ai/gomoku` | 需要 | `{ board, player, level, engine }` → `{ move, index, engine, ms }` |
| POST | `/api/ai/chess` | 需要 | `{ fen, level, engine }` → `{ from, to, fen, engine, ms }` |
| POST/GET | `/api/mcp` | 需要 | MCP JSON-RPC（`initialize` / `tools/list` / `tools/call` / `ping`） |
| POST | `/api/room` | 需要 | `{ action: 'create' \| 'move' \| 'ai_move' }`，联机房间 |
| GET | `/api/room?code=ABC123` | 需要 | 读取房间局面（前端轮询） |

非法输入统一返回 `400` 与 `{ error }`；未授权返回 `401` 与 `WWW-Authenticate`；触发限速返回 `429`；未知工具名返回 JSON-RPC `-32602`。

## 实现要点

- **边缘预算**：EdgeOne Edge Functions 单次 CPU 约 200ms，服务端搜索被限制在 ~95ms，客户端 Worker 则可用完整深度，因此难度分为 `easy / normal / hard`。
- **超时安全**：negamax/quiesce 用 `try/finally` 包裹，超时抛错时一定撤销走子，杜绝「搜索途中退出污染棋盘」的经典 Bug。
- **无状态设计**：不依赖 KV，客户端把棋盘/FEN 随身携带，函数可水平扩展，也便于 MCP 客户端自由编排。
- **同构引擎**：前端与边缘共用同一份规则/评估代码，保证两边判定一致。
- **密钥安全**：SHA-256 摘要后逐字节异或比较（常量时间），不在响应或日志中回显密钥；失败计数按实例内存隔离，跨实例由平台限流兜底。

## 版本记录

| 版本 | 内容 |
|------|------|
| **v1.2.9** | 入口脚本版本参数随发版更新（避免浏览器加载旧 app.js） |
| v1.2.8 | 房间列表改为「进入 / 删除」双按钮，删除需二次确认，失效房间保留可手动清理 |
| v1.2.7 | 新增 `room_tick`（读+应手一次完成）、桥接轮询 300ms、网页轮询 600ms |
| v1.2.6 | 修正 KV key 格式（仅字母/数字/下划线，`room_XXXXXX`）、兼容 `globalThis` 绑定、404 改为 30s 重试阈值 |
| v1.2.5 | 新增 `GET /api/storage-check` KV 自检、health 返回 `storageDetail`、房间弹层提示未启用 KV |
| v1.2.4 | 修复房间 404 轮询风暴、音频手势门控、弹层焦点告警；静态资源改为 no-cache |
| v1.2.3 | KV 绑定变量名改为 `CHESS_KV`（兼容旧 `KV`） |
| v1.2.2 | 进入房间提示：房主实时收到「对手已加入房间」 |
| v1.2.1 | 修复音频自动播放与 aria-hidden 焦点告警；health 增加 `storage` 字段（kv/memory） |
| v1.2.0 | 双密钥分离（`ADMIN_PASS` 网页 / `ACCESS_KEY` MCP）、房间簿与房间删除、KV 存储说明、MCP 14 个工具 |
| v1.1.0 | 实时联机房间、AI 桥接、网页轮询同步 |
| v1.0.0 | 五子棋 + 中国象棋、本地/边缘/LLM 引擎、MCP 10 个工具、访问密钥 |

## 许可

MIT