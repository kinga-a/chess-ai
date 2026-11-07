/** 棋境 · EdgeOne AI 棋馆 — app shell, lobby, routing, MCP panel, stats. */
import { AudioKit } from './core/audio.js';
import { AmbientBackground, launchConfetti } from './core/fx.js';
import { EngineClient } from './engine-client.js';
import { GomokuGame } from './games/gomoku.js';
import { ChessGame } from './games/chess.js';
import { initAccessGate } from './auth-gate.js';
import { RoomClient } from './room-client.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const audio = new AudioKit();
const engineClient = new EngineClient();

const STORE_KEY = 'qijing.stats.v1';

function loadStats() {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY)) || { games: 0, wins: 0, draws: 0 };
  } catch (_) {
    return { games: 0, wins: 0, draws: 0 };
  }
}

const state = {
  view: 'lobby',
  currentGame: null,
  activeGame: null,
  settings: { level: 'normal', engine: 'local', side: 'first' },
  stats: loadStats(),
  sound: audio.enabled,
  resignArmed: 0,
  room: null,
  roomClient: new RoomClient(),
};

/* ------------------------------------------------------------------ */
/* toast & clipboard                                                   */
/* ------------------------------------------------------------------ */
let toastTimer = 0;
function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
}

async function copyText(text, okMessage = '已复制') {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
    } else {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    toast(okMessage);
  } catch (_) {
    toast('复制失败，请手动选择文本');
  }
}

function endpointUrl() {
  const origin = location.protocol.startsWith('http') ? location.origin : 'https://your-domain';
  return `${origin}/api/mcp`;
}

/* ------------------------------------------------------------------ */
/* stats                                                               */
/* ------------------------------------------------------------------ */
function recordResult(won, draw) {
  state.stats.games += 1;
  if (won) state.stats.wins += 1;
  if (draw) state.stats.draws += 1;
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(state.stats));
  } catch (_) {
    /* ignore */
  }
  renderStats();
}

function renderStats() {
  const { games, wins, draws } = state.stats;
  $('#statGames').textContent = String(games);
  $('#statWins').textContent = String(wins);
  const rate = games ? Math.round(((wins + draws * 0.5) / games) * 100) : 0;
  $('#statRate').textContent = games ? `${rate}%` : '—';
  $('#statEngine').textContent = state.settings.engine === 'local' ? 'LOCAL' : state.settings.engine === 'edge' ? 'EDGE' : 'LLM';
}

/* ------------------------------------------------------------------ */
/* routing                                                             */
/* ------------------------------------------------------------------ */
function switchView(name) {
  state.view = name;
  $$('.view').forEach((v) => v.classList.remove('is-active'));
  $(`#view-${name}`).classList.add('is-active');
  window.scrollTo({ top: 0, behavior: 'instant' in window ? 'auto' : 'auto' });
}

function destroyActive() {
  if (state.activeGame) {
    state.activeGame.destroy();
    state.activeGame = null;
  }
}

function openGame(id) {
  if (state.currentGame === id && state.activeGame) {
    switchView('game');
    state.activeGame.resize();
    return;
  }
  destroyActive();
  if (state.room && state.room.game !== id) {
    state.roomClient.reset();
    state.room = null;
    renderRoomBar(null);
  }
  state.currentGame = id;
  switchView('game');
  updateShell(id);
  requestAnimationFrame(() => {
    const game = createGame(id);
    state.activeGame = game;
    game.resize();
    startNewGame();
    updateEnginePill();
  });
}

function showLobby() {
  destroyActive();
  state.currentGame = null;
  switchView('lobby');
  renderStats();
}

function updateShell(id) {
  const isGomoku = id === 'gomoku';
  $('#gameName').textContent = isGomoku ? '五子棋' : '中国象棋';
  $('#gameSub').textContent = isGomoku ? 'GOMOKU · 15×15 · 自由规则' : 'XIANGQI · 9×10 · 完整规则';
  $('#boardFrame').classList.toggle('is-chess', !isGomoku);
  const sideSelect = $('#sideSelect');
  sideSelect.options[0].textContent = isGomoku ? '先手（黑）' : '先手（红）';
  sideSelect.options[1].textContent = isGomoku ? '后手（白）' : '后手（黑）';
  sideSelect.value = state.settings.side;
  $('#levelSelect').value = state.settings.level;
  $('#engineSelect').value = state.settings.engine;
  $('#helpTitle').textContent = isGomoku ? '五子棋规则' : '中国象棋规则';
  $('#helpBody').innerHTML = isGomoku
    ? `<p><b>目标：</b>在 15×15 棋盘上率先连成五子（横、竖、斜）。</p>
       <p><b>操作：</b>点击交叉点落子。你执黑先行或执白后行，AI 会自动应手。</p>
       <p><b>悔棋：</b>撤回你与 AI 的最后一回合。</p>
       <p><b>引擎：</b>本地 Worker 零延迟；边缘函数由 EdgeOne 就近计算；大模型接管需要配置 Key，失败时自动回退。</p>`
    : `<p><b>目标：</b>将死对方将/帅。红方先行，双方轮流走子。</p>
       <p><b>操作：</b>点击己方棋子选中，再点击合法落点走子。绿色点为可走位置，红圈为可吃棋子。</p>
       <p><b>规则：</b>蹩马腿、塞象眼、炮翻山、兵卒过河可横走、仕士与将帅不可出九宫、将帅不可照面（飞将）。</p>
       <p><b>胜负：</b>被将死或无子可走（困毙）均判负。</p>`;
}

function createGame(id) {
  const hooks = {
    onState: (s) => {
      if (state.activeGame && state.activeGame.id !== s.game) return;
      renderGameState(s);
    },
    onEnd: (result) => {
      if (state.activeGame && state.activeGame.id !== result.game) return;
      showResult(result);
    },
    toast,
    confetti: () => launchConfetti($('#confettiLayer')),
  };
  const common = {
    canvas: $('#boardCanvas'),
    fxCanvas: $('#fxCanvas'),
    audio,
    engineClient,
    hooks,
  };
  const game = id === 'gomoku' ? new GomokuGame(common) : new ChessGame(common);
  game.id = id;
  return game;
}

function startNewGame() {
  if (!state.activeGame) return;
  $('#resultModal').classList.remove('open');
  state.activeGame.newGame({
    ...state.settings,
    roomClient: state.room ? state.roomClient : undefined,
    roomState: state.room || undefined,
    mySide: state.roomClient.mySide || undefined,
  });
  updateEnginePill();
}

/* ------------------------------------------------------------------ */
/* live rooms                                                          */
/* ------------------------------------------------------------------ */
const ROOM_BOOK_KEY = 'qijing.rooms.v1';
const ROOM_BOOK_MAX = 20;

function loadRoomBook() {
  try {
    const list = JSON.parse(localStorage.getItem(ROOM_BOOK_KEY));
    return Array.isArray(list) ? list : [];
  } catch (_) {
    return [];
  }
}

function saveRoomBook(list) {
  try {
    localStorage.setItem(ROOM_BOOK_KEY, JSON.stringify(list.slice(0, ROOM_BOOK_MAX)));
  } catch (_) {
    /* storage disabled */
  }
}

function rememberRoom(room, role) {
  const previous = loadRoomBook().find((item) => item.code === room.code);
  const next = loadRoomBook().filter((item) => item.code !== room.code);
  next.unshift({
    code: room.code,
    game: room.game,
    role: previous ? previous.role : role,
    at: Date.now(),
    missing: false,
  });
  saveRoomBook(next);
  renderRoomBook();
}

function forgetRoom(code) {
  saveRoomBook(loadRoomBook().filter((item) => item.code !== code));
  renderRoomBook();
}

function renderRoomBook() {
  const wrap = $('#roomBook');
  const list = $('#roomBookList');
  if (!wrap || !list) return;
  const rooms = loadRoomBook();
  wrap.hidden = rooms.length === 0;
  list.innerHTML = rooms
    .map((room) => {
      const game = room.game === 'chess' ? '中国象棋' : '五子棋';
      const role = room.role === 'host' ? '我创建' : '我加入';
      const state = room.missing ? '已失效 · 可删除' : `${game} · ${role}`;
      return (
        `<li class="${room.missing ? 'is-missing' : ''}">` +
        `<div class="room-info"><code>${room.code}</code><span>${state}</span></div>` +
        `<div class="room-ops">` +
        `<button class="btn ghost sm" data-open-room="${room.code}">进入</button>` +
        `<button class="btn ghost sm room-del" data-del-room="${room.code}">删除</button>` +
        `</div></li>`
      );
    })
    .join('');
}

async function openSavedRoom(code) {
  const entry = loadRoomBook().find((item) => item.code === code);
  try {
    const room = await state.roomClient.rejoin(code, entry ? entry.role : 'guest');
    rememberRoom(room, entry ? entry.role : 'guest');
    enterRoom(room);
  } catch (_) {
    const rooms = loadRoomBook();
    const target = rooms.find((item) => item.code === code);
    if (target) {
      target.missing = true;
      saveRoomBook(rooms);
      renderRoomBook();
    }
    toast('房间已失效，可点击「删除」清理');
  }
}

let pendingDelete = '';
let pendingDeleteTimer = 0;

function armDelete(code, button) {
  if (pendingDelete === code) {
    pendingDelete = '';
    clearTimeout(pendingDeleteTimer);
    deleteSavedRoom(code);
    return;
  }
  pendingDelete = code;
  clearTimeout(pendingDeleteTimer);
  $$('[data-del-room]').forEach((el) => {
    el.classList.remove('confirm');
    el.textContent = '删除';
  });
  button.classList.add('confirm');
  button.textContent = '确认删除';
  pendingDeleteTimer = setTimeout(() => {
    pendingDelete = '';
    renderRoomBook();
  }, 3000);
}

async function deleteSavedRoom(code) {
  try {
    await state.roomClient.remove(code);
  } catch (_) {
    /* already expired: still drop it locally */
  }
  forgetRoom(code);
  if (state.room && state.room.code === code) leaveRoom();
  toast(`房间 ${code} 已删除`);
}

async function clearSavedRooms() {
  const rooms = loadRoomBook();
  await Promise.allSettled(rooms.map((room) => state.roomClient.remove(room.code)));
  saveRoomBook([]);
  renderRoomBook();
  if (state.room && rooms.some((room) => room.code === state.room.code)) leaveRoom();
  toast('已清除全部房间');
}

function roomSideLabel(game, side) {
  if (game === 'gomoku') return side === 1 ? '你执黑' : '你执白';
  return side === 'w' ? '你执红' : '你执黑';
}

function renderRoomBar(room) {
  const badge = $('#roomBadge');
  if (!badge) return;
  if (!room) {
    badge.hidden = true;
    badge.textContent = '';
    const active = $('#roomActive');
    if (active) active.hidden = true;
    return;
  }
  badge.hidden = false;
  const mySide = state.roomClient.mySide || room.humanSide;
  badge.textContent = `房间 ${room.code} · ${roomSideLabel(room.game, mySide)}`;
  const value = $('#roomCodeValue');
  if (value) value.textContent = room.code;
  const active = $('#roomActive');
  if (active) active.hidden = false;
  const hint = $('#roomHint');
  if (hint) {
    hint.textContent =
      room.status === 'over'
        ? '对局已结束'
        : !room.guest
          ? '等待对手加入…'
          : room.turn === mySide
            ? '轮到你落子'
            : '等待对手落子…';
  }
}

let roomErrorAt = 0;

function enterRoom(room) {
  state.room = room;
  state.roomClient.start(
    (next) => {
      const previous = state.room;
      state.room = next;
      if (previous && !previous.guest && next.guest) {
        toast('对手已加入房间');
        audio.play('select');
      }
      renderRoomBar(next);
      if (state.activeGame && state.activeGame.id === next.game) state.activeGame.syncRoom(next);
    },
    (err) => {
      const now = Date.now();
      if (now - roomErrorAt < 5000) return;
      roomErrorAt = now;
      toast(err.message || '房间连接失败');
    },
    (code) => {
      state.room = null;
      state.roomClient.reset();
      forgetRoom(code);
      renderRoomBar(null);
      toast(`房间 ${code} 已失效（服务重启或未启用 CHESS_KV）`);
      if (state.activeGame) startNewGame();
    },
  );
  closeModal('roomModal');
  if (state.currentGame !== room.game) openGame(room.game);
  else startNewGame();
  renderRoomBar(room);
  toast(room.guest ? `已进入房间 ${room.code}` : `房间 ${room.code} 已创建，等待对手加入`);
}

async function createRoom() {
  const game = $('#roomGame').value || state.currentGame || 'gomoku';
  const side = $('#roomSide').value;
  const humanSide = game === 'gomoku' ? side : side === 'first' ? 'red' : 'black';
  const error = $('#roomError');
  error.textContent = '';
  $('#roomCreate').disabled = true;
  try {
    const room = await state.roomClient.create(game, humanSide);
    rememberRoom(room, 'host');
    enterRoom(room);
  } catch (err) {
    error.textContent = err.message || '创建房间失败';
  } finally {
    $('#roomCreate').disabled = false;
  }
}

async function joinRoom() {
  const code = $('#roomCodeInput').value.trim().toUpperCase();
  const error = $('#roomError');
  error.textContent = '';
  if (!/^[A-Z0-9]{6}$/.test(code)) {
    error.textContent = '请输入 6 位房间码';
    return;
  }
  $('#roomJoin').disabled = true;
  try {
    const room = await state.roomClient.join(code);
    rememberRoom(room, 'guest');
    enterRoom(room);
  } catch (err) {
    error.textContent = err.message || '加入房间失败';
  } finally {
    $('#roomJoin').disabled = false;
  }
}

function leaveRoom() {
  state.roomClient.reset();
  state.room = null;
  renderRoomBar(null);
  if (state.activeGame) startNewGame();
  toast('已退出房间');
}

function syncRoomSideOptions() {
  const gameSelect = $('#roomGame');
  const sideSelect = $('#roomSide');
  const gomoku = !gameSelect || gameSelect.value !== 'chess';
  sideSelect.options[0].textContent = gomoku ? '先手（黑）' : '先手（红）';
  sideSelect.options[1].textContent = gomoku ? '后手（白）' : '后手（黑）';
}

function openRoomPanel() {
  if (state.room) renderRoomBar(state.room);
  const active = $('#roomActive');
  if (active) active.hidden = !state.room;
  const gameSelect = $('#roomGame');
  if (gameSelect) gameSelect.value = state.currentGame || 'gomoku';
  syncRoomSideOptions();
  renderRoomBook();
  const warning = $('#storageWarn');
  if (warning) warning.hidden = document.documentElement.dataset.storage !== 'memory';
  $('#roomError').textContent = '';
  openModal('roomModal');
}

/* ------------------------------------------------------------------ */
/* game state rendering                                                */
/* ------------------------------------------------------------------ */
function renderGameState(s) {
  $('#moveCount').textContent = String(s.moveCount);
  $('#aiTime').textContent = s.aiTime ? `${Math.round(s.aiTime)} ms` : '—';
  $('#evalText').textContent = s.evalText || '—';

  const dot = $('#turnSide .dot');
  const label = $('#turnSide b');
  dot.className = 'dot';
  if (s.game === 'gomoku') {
    dot.classList.add(s.turn === 1 ? 'black' : 'white');
  } else {
    dot.classList.add(s.turn === 'w' ? 'red' : 'black');
  }
  if (s.thinking) dot.classList.add('ai');

  if (s.status === 'over') {
    label.textContent = '对局结束';
  } else if (s.thinking) {
    label.textContent = s.roomMode ? '等待对手落子' : 'AI 思考中';
  } else if (s.turn === s.human) {
    label.textContent = '轮到你';
  } else {
    label.textContent = '等待 AI';
  }

  const sideName = s.game === 'gomoku' ? (s.human === 1 ? '黑' : '白') : (s.human === 'w' ? '红' : '黑');
  $('#turnInfo').textContent = `执${sideName} · 第 ${s.moveCount + (s.status === 'playing' ? 1 : 0)} 手${s.check ? ' · 将军' : ''}`;

  $('#thinking').classList.toggle('show', !!s.thinking);
  $('#undoBtn').disabled = s.moveCount === 0;
  renderRecord(s);
  if (s.game === 'chess') renderCaptured(s.captured || []);
}

const PIECE_GLYPH = {
  K: '帅', A: '仕', B: '相', N: '马', R: '车', C: '炮', P: '兵',
  k: '将', a: '士', b: '象', n: '马', r: '车', c: '炮', p: '卒',
};

function renderRecord(s) {
  const list = $('#recordList');
  if (!s.record || !s.record.length) {
    list.innerHTML = '<li class="empty">暂无着法</li>';
    return;
  }
  if (s.game === 'gomoku') {
    const rows = [];
    for (let i = 0; i < s.record.length; i += 2) {
      const a = s.record[i];
      const b = s.record[i + 1];
      const latest = i + 1 >= s.record.length - 1;
      rows.push(
        `<li><span class="rn">${i / 2 + 1}</span>` +
          `<span class="mv${a.player === 2 ? ' ai' : ''}${latest && !b ? ' latest' : ''}">${a.player === 1 ? '黑' : '白'} ${a.label}</span>` +
          `<span class="mv${b && b.player === 2 ? ' ai' : ''}${latest && b ? ' latest' : ''}">${b ? `${b.player === 1 ? '黑' : '白'} ${b.label}` : ''}</span></li>`,
      );
    }
    list.innerHTML = rows.join('');
  } else {
    list.innerHTML = s.record
      .map((m, i) => {
        const color = m.player === 'w' ? '红' : '黑';
        const cap = m.capture ? ' ×' : '';
        return `<li><span class="rn">${i + 1}</span><span class="mv${m.player === 'b' ? ' ai' : ''}${i === s.record.length - 1 ? ' latest' : ''}">${color} ${PIECE_GLYPH[m.piece] || ''} ${m.from}→${m.to}${cap}</span></li>`;
      })
      .join('');
  }
  list.scrollTop = list.scrollHeight;
}

function renderCaptured(captured) {
  const row = $('#capturedRow');
  if (!captured.length) {
    row.innerHTML = '<span style="border:none;background:none;width:auto;color:var(--muted-2);font-size:10.5px;">暂无吃子</span>';
    return;
  }
  row.innerHTML = captured
    .slice(-14)
    .map((p) => {
      const red = p >= 'A' && p <= 'Z';
      return `<span class="${red ? 'red' : 'black'}" title="${PIECE_GLYPH[p] || p}">${PIECE_GLYPH[p] || p}</span>`;
    })
    .join('');
}

function updateEnginePill() {
  const pill = $('#enginePill');
  if (state.room) {
    pill.classList.remove('edge', 'llm');
    pill.innerHTML = '<i></i>联机对战';
    return;
  }
  const engine = state.settings.engine;
  pill.classList.toggle('edge', engine === 'edge');
  pill.classList.toggle('llm', engine === 'llm');
  pill.innerHTML = `<i></i>${engine === 'local' ? '本地引擎' : engine === 'edge' ? '边缘 AI' : '大模型接管'}`;
}

/* ------------------------------------------------------------------ */
/* result modal                                                        */
/* ------------------------------------------------------------------ */
const REASONS = {
  five: '五子连珠，胜负已分。',
  checkmate: '将死！这盘棋结束了。',
  stalemate: '困毙无着，判负。',
  full: '棋盘已满，握手言和。',
  resign: '你选择了认输。',
};

function showResult(result) {
  const { winner, human } = result;
  const draw = winner === 0;
  const won = !draw && winner === human;
  const emblem = $('#resultEmblem');
  emblem.className = 'result-emblem' + (draw ? ' draw' : won ? '' : ' lose');
  emblem.textContent = draw ? '和' : won ? '胜' : '负';
  $('#resultTitle').textContent = draw ? '和棋' : won ? '你赢了' : '惜败';
  const reason = REASONS[result.reason] || '对局结束。';
  $('#resultDesc').textContent = `${reason}${won ? ' 漂亮的收官。' : draw ? '' : ' 再来一局找回场子。'}`;
  $('#resultMoves').textContent = String(result.moveCount);
  $('#resultTime').textContent = `${Math.round(result.durationMs / 1000)}s`;
  const levelName = { easy: '入门', normal: '进阶', hard: '大师' }[result.level] || '进阶';
  $('#resultLevel').textContent = levelName;
  $('#resultModal').classList.add('open');
  recordResult(won, draw);
}

/* ------------------------------------------------------------------ */
/* MCP panel                                                           */
/* ------------------------------------------------------------------ */
function fillMcp() {
  const url = endpointUrl();
  const secure = document.documentElement.dataset.secure === 'on';
  ['#mcpEndpoint', '#mcpEndpointFull', '#mcpEndpointInline'].forEach((sel) => {
    const el = $(sel);
    if (el) el.textContent = url;
  });
  $('#mcpConfig').textContent = secure
    ? `{
  "mcpServers": {
    "edgeone-chess-ai": {
      "type": "http",
      "url": "${url}",
      "headers": {
        "Authorization": "Bearer <YOUR_ACCESS_KEY>"
      }
    }
  }
}`
    : `{
  "mcpServers": {
    "edgeone-chess-ai": {
      "type": "http",
      "url": "${url}"
    }
  }
}`;
  $('#mcpCurl').textContent = secure
    ? `curl -X POST ${url} \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer $ACCESS_KEY" \\
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'`
    : `curl -X POST ${url} \\
  -H "Content-Type: application/json" \\
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'`;
}

let modalReturnFocus = null;

function openModal(id) {
  const el = $('#' + id);
  if (!el) return;
  modalReturnFocus = document.activeElement;
  el.classList.add('open');
  el.setAttribute('aria-hidden', 'false');
  const target = el.querySelector('.modal-close');
  if (target) setTimeout(() => target.focus({ preventScroll: true }), 60);
}

function closeModal(id) {
  const el = $('#' + id);
  if (!el) return;
  if (el.contains(document.activeElement)) document.activeElement.blur();
  el.classList.remove('open');
  el.setAttribute('aria-hidden', 'true');
  if (modalReturnFocus && typeof modalReturnFocus.focus === 'function') {
    try {
      modalReturnFocus.focus({ preventScroll: true });
    } catch (_) {
      /* element may be gone */
    }
  }
  modalReturnFocus = null;
}

/* ------------------------------------------------------------------ */
/* lobby visuals                                                       */
/* ------------------------------------------------------------------ */
function preparePreview(canvas) {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.max(1, rect.width || canvas.width);
  const h = Math.max(1, rect.height || canvas.height);
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h };
}

function drawGomokuPreview(canvas) {
  const { ctx, w, h } = preparePreview(canvas);
  ctx.fillStyle = '#17110a';
  ctx.fillRect(0, 0, w, h);
  // Card art is a wide strip: scale by width and crop vertically (a board close-up).
  const cell = w / 16.8;
  const span = 14 * cell;
  const ox = w / 2 - 7 * cell;
  const oy = h / 2 - 7 * cell;
  ctx.strokeStyle = 'rgba(217,164,65,0.22)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i < 15; i++) {
    ctx.moveTo(ox, oy + i * cell);
    ctx.lineTo(ox + span, oy + i * cell);
    ctx.moveTo(ox + i * cell, oy);
    ctx.lineTo(ox + i * cell, oy + span);
  }
  ctx.stroke();
  const stones = [
    [7, 7, 1], [8, 8, 2], [6, 8, 1], [9, 7, 2], [7, 9, 1], [9, 9, 2], [6, 6, 1], [8, 6, 2],
  ];
  for (const [x, y, c] of stones) {
    const cx = ox + x * cell;
    const cy = oy + y * cell;
    const g = ctx.createRadialGradient(cx - cell * 0.25, cy - cell * 0.28, cell * 0.08, cx, cy, cell * 0.44);
    if (c === 1) {
      g.addColorStop(0, '#5f625d');
      g.addColorStop(0.5, '#232522');
      g.addColorStop(1, '#060706');
    } else {
      g.addColorStop(0, '#ffffff');
      g.addColorStop(0.7, '#eee7d6');
      g.addColorStop(1, '#c4baa2');
    }
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, cell * 0.42, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = 'rgba(244,212,145,0.65)';
  ctx.lineWidth = 2.5;
  ctx.shadowColor = 'rgba(217,164,65,0.8)';
  ctx.shadowBlur = 12;
  ctx.beginPath();
  ctx.moveTo(ox + 6 * cell, oy + 9 * cell);
  ctx.lineTo(ox + 9 * cell, oy + 6 * cell);
  ctx.stroke();
  ctx.shadowBlur = 0;
}

function drawChessPreview(canvas) {
  const { ctx, w, h } = preparePreview(canvas);
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, '#e7c891');
  g.addColorStop(1, '#c79a58');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  // Close-up: scale by width so the board fills the wide card art.
  const cell = w / 9.8;
  const mx = w / 2 - 4 * cell;
  const my = h / 2 - 4.5 * cell;
  ctx.strokeStyle = 'rgba(78,46,18,0.55)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let r = 0; r < 10; r++) {
    ctx.moveTo(mx, my + r * cell);
    ctx.lineTo(mx + 8 * cell, my + r * cell);
  }
  for (let c = 0; c < 9; c++) {
    const x = mx + c * cell;
    if (c === 0 || c === 8) {
      ctx.moveTo(x, my);
      ctx.lineTo(x, my + 9 * cell);
    } else {
      ctx.moveTo(x, my);
      ctx.lineTo(x, my + 4 * cell);
      ctx.moveTo(x, my + 5 * cell);
      ctx.lineTo(x, my + 9 * cell);
    }
  }
  ctx.stroke();
  ctx.strokeStyle = 'rgba(78,46,18,0.4)';
  ctx.beginPath();
  ctx.moveTo(mx + 3 * cell, my);
  ctx.lineTo(mx + 5 * cell, my + 2 * cell);
  ctx.moveTo(mx + 5 * cell, my);
  ctx.lineTo(mx + 3 * cell, my + 2 * cell);
  ctx.moveTo(mx + 3 * cell, my + 7 * cell);
  ctx.lineTo(mx + 5 * cell, my + 9 * cell);
  ctx.moveTo(mx + 5 * cell, my + 7 * cell);
  ctx.lineTo(mx + 3 * cell, my + 9 * cell);
  ctx.stroke();
  ctx.fillStyle = 'rgba(92,54,22,0.5)';
  ctx.font = `${Math.max(8, cell * 0.55)}px "Songti SC", "STSong", serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('楚 河', mx + 2 * cell, my + 4.5 * cell);
  ctx.fillText('漢 界', mx + 6 * cell, my + 4.5 * cell);

  const pieces = [
    [0, 0, 'r'], [0, 4, 'k'], [0, 8, 'r'], [2, 1, 'c'], [2, 7, 'c'], [3, 4, 'p'],
    [9, 0, 'R'], [9, 4, 'K'], [9, 8, 'R'], [7, 1, 'C'], [7, 7, 'C'], [6, 4, 'P'],
  ];
  const names = { K: '帅', R: '车', C: '炮', P: '兵', k: '将', r: '车', c: '炮', p: '卒' };
  for (const [r, c, p] of pieces) {
    const cx = mx + c * cell;
    const cy = my + r * cell;
    const isRed = p === p.toUpperCase();
    ctx.fillStyle = '#f3e6c9';
    ctx.beginPath();
    ctx.arc(cx, cy, cell * 0.43, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = isRed ? 'rgba(150,34,24,0.8)' : 'rgba(30,32,30,0.8)';
    ctx.lineWidth = 1.4;
    ctx.stroke();
    ctx.fillStyle = isRed ? '#9e2318' : '#20221f';
    ctx.font = `700 ${Math.round(cell * 0.48)}px "STKaiti", "KaiTi", serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(names[p] || p, cx, cy + 1);
  }
}

function drawPreviews() {
  requestAnimationFrame(drawPreviews);
}

function initHeroCanvas() {
  const canvas = $('#heroCanvas');
  const ctx = canvas.getContext('2d');
  const size = 640;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = size * dpr;
  canvas.height = size * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const stones = [
    [4, 4, 1], [6, 4, 2], [5, 5, 1], [6, 6, 2], [7, 6, 1], [4, 7, 2], [5, 8, 1], [7, 8, 2],
  ];
  function frame(ts) {
    ctx.clearRect(0, 0, size, size);
    const cx = size / 2;
    const cy = size / 2;
    ctx.save();
    ctx.translate(cx, cy);
    const rot = ts / 16000;
    ctx.rotate(rot);
    const board = 330;
    const cell = board / 8;
    ctx.strokeStyle = 'rgba(217,164,65,0.28)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i <= 8; i++) {
      const p = -board / 2 + i * cell;
      ctx.moveTo(-board / 2, p);
      ctx.lineTo(board / 2, p);
      ctx.moveTo(p, -board / 2);
      ctx.lineTo(p, board / 2);
    }
    ctx.stroke();
    ctx.strokeStyle = 'rgba(217,164,65,0.5)';
    ctx.lineWidth = 1.4;
    ctx.strokeRect(-board / 2, -board / 2, board, board);
    for (const [x, y, c] of stones) {
      const px = -board / 2 + (x - 0.5) * cell;
      const py = -board / 2 + (y - 0.5) * cell;
      const pulse = 0.7 + Math.sin(ts / 900 + x + y) * 0.3;
      const g = ctx.createRadialGradient(px - 6, py - 7, 2, px, py, cell * 0.42);
      if (c === 1) {
        g.addColorStop(0, 'rgba(150,160,150,0.9)');
        g.addColorStop(1, 'rgba(5,8,6,0.95)');
      } else {
        g.addColorStop(0, 'rgba(255,255,255,1)');
        g.addColorStop(1, 'rgba(214,205,185,0.95)');
      }
      ctx.fillStyle = g;
      ctx.shadowColor = c === 1 ? 'rgba(0,0,0,0.5)' : 'rgba(255,240,200,0.5)';
      ctx.shadowBlur = 10 * pulse;
      ctx.beginPath();
      ctx.arc(px, py, cell * 0.36, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.shadowBlur = 0;
    ctx.restore();

    // Orbiting highlights
    for (let i = 0; i < 3; i++) {
      const angle = ts / 2600 + (i * Math.PI * 2) / 3;
      const r = 232;
      const x = cx + Math.cos(angle) * r;
      const y = cy + Math.sin(angle) * r * 0.82;
      ctx.fillStyle = i === 0 ? 'rgba(217,164,65,0.9)' : i === 1 ? 'rgba(55,201,169,0.8)' : 'rgba(236,230,214,0.7)';
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = 'rgba(217,164,65,0.12)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(cx, cy, 232, 190, 0, 0, Math.PI * 2);
    ctx.stroke();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

/* ------------------------------------------------------------------ */
/* boot                                                                */
/* ------------------------------------------------------------------ */
function bindUI() {
  $$('[data-nav="lobby"]').forEach((el) => el.addEventListener('click', showLobby));
  $$('[data-open]').forEach((el) => {
    el.addEventListener('click', () => openGame(el.dataset.open));
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openGame(el.dataset.open);
      }
    });
  });
  $('#cardMcp').addEventListener('click', () => openModal('mcpModal'));
  $('#heroMcp').addEventListener('click', () => openModal('mcpModal'));
  $('#navMcp').addEventListener('click', () => openModal('mcpModal'));
  $('#openMcp').addEventListener('click', () => openModal('mcpModal'));
  $('#backBtn').addEventListener('click', showLobby);
  $('#helpBtn').addEventListener('click', () => openModal('helpModal'));
  $('#roomBtn').addEventListener('click', openRoomPanel);
  $('#heroRoom').addEventListener('click', openRoomPanel);
  $('#roomGame').addEventListener('change', syncRoomSideOptions);
  $('#roomCreate').addEventListener('click', createRoom);
  $('#roomJoin').addEventListener('click', joinRoom);
  $('#roomLeave').addEventListener('click', leaveRoom);
  $('#roomCopy').addEventListener('click', () => {
    if (state.room) copyText(state.room.code, '房间码已复制');
  });
  $('#roomBookList').addEventListener('click', (event) => {
    const del = event.target.closest('[data-del-room]');
    if (del) {
      armDelete(del.dataset.delRoom, del);
      return;
    }
    const open = event.target.closest('[data-open-room]');
    if (open) openSavedRoom(open.dataset.openRoom);
  });
  $('#roomBookClear').addEventListener('click', clearSavedRooms);

  $$('[data-close]').forEach((el) => {
    el.addEventListener('click', () => closeModal(el.dataset.close));
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      $$('.modal.open').forEach((m) => closeModal(m.id));
    }
  });

  $('#soundBtn').addEventListener('click', () => {
    const on = audio.toggle();
    state.sound = on;
    $('#soundBtn').classList.toggle('muted', !on);
    toast(on ? '音效已开启' : '音效已关闭');
    if (on) audio.click();
  });
  $('#soundBtn').classList.toggle('muted', !audio.enabled);

  $('#newGameBtn').addEventListener('click', () => {
    audio.unlock();
    audio.click();
    startNewGame();
    toast('新的一局开始了');
  });
  $('#undoBtn').addEventListener('click', () => {
    if (!state.activeGame) return;
    state.activeGame.undo();
  });
  $('#resignBtn').addEventListener('click', () => {
    if (!state.activeGame || state.activeGame.status !== 'playing') return;
    const now = Date.now();
    if (now - state.resignArmed > 3000) {
      state.resignArmed = now;
      $('#resignBtn').textContent = '确认认输';
      toast('再次点击确认认输');
      setTimeout(() => {
        if (Date.now() - state.resignArmed >= 3000) $('#resignBtn').textContent = '认输';
      }, 3200);
      return;
    }
    state.resignArmed = 0;
    $('#resignBtn').textContent = '认输';
    state.activeGame.resign();
  });

  $('#levelSelect').addEventListener('change', (e) => {
    state.settings.level = e.target.value;
    if (state.activeGame) state.activeGame.level = e.target.value;
    toast('难度已切换，下一步生效');
  });
  $('#engineSelect').addEventListener('change', (e) => {
    state.settings.engine = e.target.value;
    if (state.activeGame) state.activeGame.engine = e.target.value;
    state.settings.engine === 'llm' ? audio.notify() : audio.click();
    updateEnginePill();
    renderStats();
    if (e.target.value === 'llm') toast('大模型接管：需在 EdgeOne 配置 AI_API_KEY，失败自动回退');
  });
  $('#sideSelect').addEventListener('change', (e) => {
    state.settings.side = e.target.value;
    toast('执子已记录，新开一局后生效');
  });

  $('#copyMcp').addEventListener('click', () => copyText(endpointUrl(), 'MCP 端点已复制'));
  $('#copyFullMcp').addEventListener('click', () => copyText(endpointUrl(), 'MCP 端点已复制'));
  $('#copyRecord').addEventListener('click', () => {
    if (!state.activeGame) return;
    const g = state.currentGame;
    const text =
      g === 'gomoku'
        ? state.activeGame.record.map((r) => `${r.player === 1 ? '黑' : '白'} ${r.label}`).join('\n')
        : state.activeGame.record.map((r) => `${r.player === 'w' ? '红' : '黑'} ${r.piece} ${r.from}-${r.to}`).join('\n');
    copyText(text || '（空）', '棋谱已复制');
  });

  $('#againBtn').addEventListener('click', () => {
    closeModal('resultModal');
    startNewGame();
  });
  $('#lobbyBtn').addEventListener('click', () => {
    closeModal('resultModal');
    showLobby();
  });

  let previewTimer = 0;
  window.addEventListener('resize', () => {
    if (state.activeGame) state.activeGame.resize();
    clearTimeout(previewTimer);
    previewTimer = setTimeout(drawPreviews, 160);
  });

  const frame = $('#boardFrame');
  if ('ResizeObserver' in window) {
    new ResizeObserver(() => {
      if (state.activeGame) state.activeGame.resize();
    }).observe(frame);
  }
}

async function boot() {
  await initAccessGate();

  new AmbientBackground($('#bgCanvas'));
  initHeroCanvas();
  requestAnimationFrame(drawPreviews);
  fillMcp();
  renderStats();
  bindUI();

  window.addEventListener('qijing:unlocked', (event) => {
    const locked = event.detail && event.detail.locked;
    toast(locked ? '已锁定本设备' : '验证通过，欢迎入馆');
    if (!locked) fillMcp();
  });

  const params = new URLSearchParams(location.search);
  const game = params.get('game');
  if (game === 'gomoku' || game === 'chess') {
    openGame(game);
  }

  // Browsers only allow audio after a user gesture: unlock on the first one.
  const unlockAudio = () => {
    audio.unlock();
    window.removeEventListener('pointerdown', unlockAudio);
    window.removeEventListener('keydown', unlockAudio);
  };
  window.addEventListener('pointerdown', unlockAudio, { passive: true });
  window.addEventListener('keydown', unlockAudio);
}

boot();