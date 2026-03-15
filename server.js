const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// ===== ゲームロジック =====
const SUITS = ['♣', '♦', '♥', '♠'];
const NUMS = ['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2'];
const NR = {};
NUMS.forEach((n, i) => NR[n] = i + 3);

function cr(c) { return c.isJoker ? 100 : NR[c.num]; }
function si(s) { return SUITS.indexOf(s); }

function makeDeck() {
  let d = [];
  for (let s of SUITS) for (let n of NUMS) d.push({ suit: s, num: n, id: s + n, isJoker: false });
  d.push({ suit: '★', num: 'JOKER', id: 'JOKER', isJoker: true });
  return d;
}
function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function sortHand(h) {
  return [...h].sort((a, b) => {
    if (a.isJoker && b.isJoker) return 0;
    if (a.isJoker) return 1; if (b.isJoker) return -1;
    if (cr(a) !== cr(b)) return cr(a) - cr(b);
    return si(a.suit) - si(b.suit);
  });
}

function isStairs(cards) {
  if (cards.length < 3) return false;
  const normals = cards.filter(c => !c.isJoker);
  const jokers = cards.filter(c => c.isJoker);
  if (jokers.length > 1 || !normals.length) return false;
  const suit = normals[0].suit;
  if (!normals.every(c => c.suit === suit)) return false;
  const nums = normals.map(c => NR[c.num]).sort((a, b) => a - b);
  for (let i = 0; i < nums.length - 1; i++) if (nums[i] === nums[i + 1]) return false;
  if (!jokers.length) {
    for (let i = 0; i < nums.length - 1; i++) if (nums[i + 1] - nums[i] !== 1) return false;
    return true;
  }
  let gaps = 0;
  for (let i = 0; i < nums.length - 1; i++) {
    const d = nums[i + 1] - nums[i];
    if (d === 1) continue; if (d === 2) { gaps++; continue; } return false;
  }
  return gaps === 1;
}

function stairsTopRank(cards, rev) {
  const normals = cards.filter(c => !c.isJoker);
  const jokers = cards.filter(c => c.isJoker);
  const nums = normals.map(c => NR[c.num]).sort((a, b) => a - b);
  let top = nums[nums.length - 1];
  if (jokers.length) {
    let g = -1;
    for (let i = 0; i < nums.length - 1; i++) { if (nums[i + 1] - nums[i] === 2) { g = nums[i] + 1; break; } }
    top = g > 0 ? Math.max(top, g) : top + 1;
  }
  return rev ? (100 - top) : top;
}

function isValidPair(cards) {
  const n = cards.filter(c => !c.isJoker);
  return !n.length || n.every(c => c.num === n[0].num);
}

function detectMode(cards) {
  if (!cards.length) return null;
  if (cards.length === 1) return 'single';
  if (isStairs(cards)) return 'stairs';
  if (isValidPair(cards)) return 'multi';
  return null;
}

function fieldMode(lc) {
  if (!lc.length) return null;
  if (lc.length === 1) return 'single';
  if (isStairs(lc)) return 'stairs';
  return 'multi';
}

function effectiveRev(G) { return G.revolution !== G.elevenBack; }

function mainRank(cards, rev) {
  const n = cards.filter(c => !c.isJoker);
  if (!n.length) return 100;
  const r = NR[n[0].num];
  return rev ? (16 - r) : r;
}

function canPlay(cards, G) {
  if (!cards.length) return false;
  const { lastCards, shibariSuit } = G;
  const rev = effectiveRev(G);
  if (cards.length === 1 && cards[0].suit === '♠' && cards[0].num === '3' &&
    lastCards.length === 1 && lastCards[0].isJoker) return true;
  const mode = detectMode(cards);
  if (!mode) return false;
  if (!lastCards.length) return true;
  const fMode = fieldMode(lastCards);
  if (mode !== fMode || cards.length !== lastCards.length) return false;
  if (shibariSuit && mode !== 'stairs' &&
    !cards.filter(c => !c.isJoker).every(c => c.suit === shibariSuit)) return false;
  if (cards.length === 1 && cards[0].isJoker) return true;
  if (mode === 'stairs') return stairsTopRank(cards, rev) > stairsTopRank(lastCards, rev);
  return mainRank(cards, rev) > mainRank(lastCards, rev);
}

function isRevolution(cards) {
  const n = cards.filter(c => !c.isJoker);
  const j = cards.filter(c => c.isJoker);
  if (cards.length >= 4 && isStairs(cards)) return true;
  if (n.length === 4 && n.every(c => c.num === n[0].num)) return true;
  if (n.length === 3 && j.length >= 1 && n.every(c => c.num === n[0].num)) return true;
  return false;
}

function isForbiddenWin(cards, rev) {
  const n = cards.filter(c => !c.isJoker);
  if (cards.some(c => c.isJoker) && !n.length) return true;
  if (!rev && n.length && n[0].num === '2') return true;
  if (rev && n.length && n[0].num === '3') return true;
  if (n.length && n[0].num === '8') return true;
  return false;
}

function calcShibari(prev, nxt) {
  const pn = prev.filter(c => !c.isJoker);
  const nn = nxt.filter(c => !c.isJoker);
  if (!pn.length || !nn.length || nxt.some(c => c.isJoker) || isStairs(nxt)) return null;
  if (pn.every(c => c.suit === pn[0].suit) && nn.every(c => c.suit === pn[0].suit) && pn[0].suit === nn[0].suit)
    return pn[0].suit;
  return null;
}

function nextAlive(G, pidx) {
  let n = (pidx + 1) % 4;
  for (let t = 0; t < 4; t++) {
    if (G.players[n].rank === null && !G.players[n].passed) return n;
    n = (n + 1) % 4;
  }
  n = (pidx + 1) % 4;
  for (let t = 0; t < 4; t++) { if (G.players[n].rank === null) return n; n = (n + 1) % 4; }
  return pidx;
}

// ===== ルーム管理 =====
const rooms = {};

function createRoom(roomId) {
  rooms[roomId] = {
    id: roomId,
    players: [],   // { socketId, name, seatIndex }
    game: null,
    started: false,
    round: 0,
  };
  return rooms[roomId];
}

function getRoom(roomId) { return rooms[roomId]; }

function broadcastRoom(roomId) {
  const room = rooms[roomId];
  if (!room) return;
  // 各プレイヤーに「自分視点」の情報を送る
  for (const p of room.players) {
    const socket = io.sockets.sockets.get(p.socketId);
    if (!socket) continue;
    socket.emit('roomUpdate', buildRoomView(room, p.seatIndex));
  }
}

function buildRoomView(room, mySeat) {
  if (!room.game) {
    return {
      roomId: room.id,
      players: room.players.map(p => ({ name: p.name, seat: p.seatIndex, ready: true })),
      started: false,
      mySeat,
    };
  }
  const G = room.game;
  // 自分の手札だけ公開、他は枚数のみ
  const playersView = G.players.map((p, i) => ({
    name: p.name,
    handCount: p.hand.length,
    hand: i === mySeat ? p.hand : [],
    passed: p.passed,
    rank: p.rank,
    isHuman: p.isHuman,
  }));
  return {
    roomId: room.id,
    started: true,
    mySeat,
    players: playersView,
    lastCards: G.lastCards,
    lastPlayer: G.lastPlayer,
    currentTurn: G.currentTurn,
    rankOrder: G.rankOrder,
    revolution: G.revolution,
    elevenBack: G.elevenBack,
    shibariSuit: G.shibariSuit,
    gameOver: G.gameOver,
    log: G.log.slice(-6),
    round: G.round,
    // 特殊アクション待ち
    sevenPassActive: G.sevenPassActive,
    sevenPassFrom: G.sevenPassFrom,
    sevenPassTo: G.sevenPassTo,
    sevenPassMax: G.sevenPassMax,
    tenDiscardActive: G.tenDiscardActive,
    tenDiscardFrom: G.tenDiscardFrom,
    tenDiscardMax: G.tenDiscardMax,
    exchangePhase: G.exchangePhase,
    exchangeRole: G.exchangeRole,
    exchangeCount: G.exchangeCount,
  };
}

// ===== ゲーム開始 =====
function startGame(room) {
  const deck = shuffle(makeDeck());
  const hands = [[], [], [], []];
  for (let i = 0; i < deck.length; i++) hands[i % 4].push(deck[i]);
  for (let i = 0; i < 4; i++) hands[i] = sortHand(hands[i]);

  room.round++;
  const prevRanks = room.game ? room.game.rankOrder : null;

  room.game = {
    round: room.round,
    players: room.players.map((p, i) => ({
      name: p.name,
      hand: hands[i],
      isHuman: true,
      passed: false,
      rank: null,
      seatIndex: i,
    })),
    lastCards: [], lastPlayer: -1, currentTurn: 0, rankOrder: [],
    revolution: false, elevenBack: false,
    gameOver: false, log: [], shibariSuit: null,
    sevenPassActive: false, sevenPassMax: 0, sevenPassFrom: -1, sevenPassTo: -1, sevenPassNextTurn: -1,
    tenDiscardActive: false, tenDiscardMax: 0, tenDiscardFrom: -1, tenDiscardNextTurn: -1,
    exchangePhase: false, exchangeRole: -1, exchangeCount: 0,
    prevRanks,
  };

  const G = room.game;

  // ♦3を持つプレイヤーが先攻
  let first = 0;
  for (let i = 0; i < 4; i++) {
    if (G.players[i].hand.some(c => c.suit === '♦' && c.num === '3')) { first = i; break; }
  }
  G.currentTurn = first;
  addLog(G, 'ゲーム開始！♦3を持つ人から');

  // 2ラウンド目以降はカード交換
  if (room.round > 1 && prevRanks && prevRanks.length === 4) {
    doExchange(room);
    return;
  }

  broadcastRoom(room.id);
}

function addLog(G, msg) {
  G.log.push(msg);
  if (G.log.length > 20) G.log.shift();
}

// ===== カード交換 =====
function doExchange(room) {
  const G = room.game;
  const ranks = G.prevRanks;
  const daifu = ranks[0], fugo = ranks[1], hinmin = ranks[2], daihin = ranks[3];

  function autoEx(fromIdx, toIdx, count) {
    let strongest = sortHand(G.players[toIdx].hand).slice(-count);
    strongest.forEach(c => {
      const i = G.players[toIdx].hand.findIndex(h => h.id === c.id);
      if (i >= 0) G.players[toIdx].hand.splice(i, 1);
    });
    let weakest = sortHand(G.players[fromIdx].hand).slice(0, count);
    weakest.forEach(c => {
      const i = G.players[fromIdx].hand.findIndex(h => h.id === c.id);
      if (i >= 0) G.players[fromIdx].hand.splice(i, 1);
    });
    strongest.forEach(c => G.players[fromIdx].hand.push(c));
    weakest.forEach(c => G.players[toIdx].hand.push(c));
    G.players[fromIdx].hand = sortHand(G.players[fromIdx].hand);
    G.players[toIdx].hand = sortHand(G.players[toIdx].hand);
  }

  // まず全ペアを自動処理
  autoEx(daifu, daihin, 2);
  autoEx(fugo, hinmin, 1);

  addLog(G, 'カード交換完了！');
  G.exchangePhase = false;

  // ♦3スタート
  let first = 0;
  for (let i = 0; i < 4; i++) {
    if (G.players[i].hand.some(c => c.suit === '♦' && c.num === '3')) { first = i; break; }
  }
  G.currentTurn = first;
  addLog(G, '♦3を持つ人から！');

  broadcastRoom(room.id);
}

// ===== プレイ処理 =====
function serverPlayCards(room, seatIndex, cardIds) {
  const G = room.game;
  if (!G || G.gameOver) return { ok: false, msg: 'ゲーム中ではありません' };
  if (G.currentTurn !== seatIndex) return { ok: false, msg: 'あなたのターンではありません' };

  const p = G.players[seatIndex];
  const cards = p.hand.filter(c => cardIds.includes(c.id));
  if (cards.length !== cardIds.length) return { ok: false, msg: 'カードが見つかりません' };
  if (!canPlay(cards, G)) return { ok: false, msg: 'そのカードは出せません' };

  // 手札から除去
  cards.forEach(c => {
    const i = p.hand.findIndex(h => h.id === c.id);
    if (i >= 0) p.hand.splice(i, 1);
  });

  const num = cards.filter(c => !c.isJoker)[0]?.num || null;
  const effects = [];
  const isSP3 = cards.length === 1 && cards[0].suit === '♠' && cards[0].num === '3' &&
    G.lastCards.length === 1 && G.lastCards[0].isJoker;

  if (!isSP3 && isRevolution(cards)) {
    G.revolution = !G.revolution;
    effects.push(G.revolution ? '🔄 革命！' : '🔄 革命返し！');
  }
  if (!isSP3 && G.lastCards.length) {
    const s = calcShibari(G.lastCards, cards);
    if (s) { G.shibariSuit = s; effects.push(`🔒 ${s}縛り！`); }
  }
  addLog(G, `${p.name}: ${cards.map(c => c.isJoker ? '★JOK' : c.num + c.suit).join(',')}`);

  // 8切り
  if (num === '8' && !isSP3) {
    effects.push('🎴 8切り！');
    G.lastCards = [...cards]; G.lastPlayer = seatIndex;
    checkFinished(G, seatIndex, cards);
    if (!G.gameOver) resetField(G, seatIndex);
    broadcastRoom(room.id);
    return { ok: true, effects };
  }

  // スペ3返し
  if (isSP3) {
    effects.push('♠3返し！');
    checkFinished(G, seatIndex, cards);
    if (!G.gameOver) resetField(G, seatIndex);
    broadcastRoom(room.id);
    return { ok: true, effects };
  }

  // 11バック
  if (num === 'J') {
    G.elevenBack = !G.elevenBack;
    effects.push(G.elevenBack ? '🔁 11バック！' : '🔁 11バック解除');
  }

  // 7渡し
  if (num === '7') {
    G.lastCards = [...cards]; G.lastPlayer = seatIndex;
    effects.push('7渡し！');
    checkFinished(G, seatIndex, cards);
    if (!G.gameOver) {
      const tgt = nextAlive(G, seatIndex);
      G.sevenPassActive = true; G.sevenPassMax = cards.length;
      G.sevenPassFrom = seatIndex; G.sevenPassTo = tgt;
      G.sevenPassNextTurn = nextAlive(G, seatIndex);
    }
    broadcastRoom(room.id);
    return { ok: true, effects };
  }

  // 5スキップ
  if (num === '5') {
    G.lastCards = [...cards]; G.lastPlayer = seatIndex;
    effects.push('5スキップ！');
    checkFinished(G, seatIndex, cards);
    if (!G.gameOver) {
      let skip = cards.length, next = (seatIndex + 1) % 4;
      for (let s = 0; s < skip; s++) {
        while (G.players[next].rank !== null) next = (next + 1) % 4;
        addLog(G, `${G.players[next].name}をスキップ`);
        next = (next + 1) % 4;
      }
      while (G.players[next].rank !== null) next = (next + 1) % 4;
      G.currentTurn = next;
    }
    broadcastRoom(room.id);
    return { ok: true, effects };
  }

  // 10捨て
  if (num === '10') {
    G.lastCards = [...cards]; G.lastPlayer = seatIndex;
    effects.push('10捨て！');
    checkFinished(G, seatIndex, cards);
    if (!G.gameOver) {
      G.tenDiscardActive = true; G.tenDiscardMax = cards.length;
      G.tenDiscardFrom = seatIndex;
      G.tenDiscardNextTurn = nextAlive(G, seatIndex);
    }
    broadcastRoom(room.id);
    return { ok: true, effects };
  }

  // 通常
  G.lastCards = [...cards]; G.lastPlayer = seatIndex;
  checkFinished(G, seatIndex, cards);
  if (!G.gameOver) G.currentTurn = nextAlive(G, seatIndex);
  broadcastRoom(room.id);
  return { ok: true, effects };
}

function serverPass(room, seatIndex) {
  const G = room.game;
  if (!G || G.gameOver) return { ok: false };
  if (G.currentTurn !== seatIndex) return { ok: false, msg: 'あなたのターンではありません' };
  if (!G.lastCards.length) return { ok: false, msg: '最初のターンはパスできません' };

  G.players[seatIndex].passed = true;
  addLog(G, `${G.players[seatIndex].name}:パス`);

  const alive = G.players.filter(p => p.rank === null && !p.passed);
  if (!alive.length || (alive.length === 1 && G.lastPlayer >= 0 && alive[0] === G.players[G.lastPlayer])) {
    let lp = G.lastPlayer >= 0 ? G.lastPlayer : seatIndex;
    if (G.players[lp].rank !== null) { lp = (lp + 1) % 4; for (let t = 0; t < 4; t++) { if (G.players[lp].rank === null) break; lp = (lp + 1) % 4; } }
    resetField(G, lp);
  } else {
    G.currentTurn = nextAlive(G, seatIndex);
  }
  broadcastRoom(room.id);
  return { ok: true };
}

function serverSevenPass(room, seatIndex, cardIds) {
  const G = room.game;
  if (!G.sevenPassActive || G.sevenPassFrom !== seatIndex) return { ok: false };
  const p = G.players[seatIndex];
  const give = p.hand.filter(c => cardIds.includes(c.id));
  if (give.length < 1) return { ok: false, msg: '1枚以上選んでください' };
  give.forEach(c => { const i = p.hand.findIndex(h => h.id === c.id); if (i >= 0) p.hand.splice(i, 1); });
  G.players[G.sevenPassTo].hand = sortHand([...G.players[G.sevenPassTo].hand, ...give]);
  p.hand = sortHand(p.hand);
  addLog(G, `7渡し:${p.name}→${G.players[G.sevenPassTo].name}に${give.length}枚`);
  G.sevenPassActive = false;
  if (p.hand.length === 0 && p.rank === null) {
    p.rank = G.rankOrder.length; G.rankOrder.push(seatIndex);
    addLog(G, `🏆${p.name}:7渡しで上がり`);
    checkAllFinished(G);
  }
  if (!G.gameOver) {
    let t = G.sevenPassNextTurn;
    for (let i = 0; i < 4; i++) { if (G.players[t].rank === null) break; t = (t + 1) % 4; }
    G.currentTurn = t;
  }
  broadcastRoom(room.id);
  return { ok: true };
}

function serverTenDiscard(room, seatIndex, cardIds) {
  const G = room.game;
  if (!G.tenDiscardActive || G.tenDiscardFrom !== seatIndex) return { ok: false };
  const p = G.players[seatIndex];
  const dis = p.hand.filter(c => cardIds.includes(c.id));
  if (dis.length < 1) return { ok: false, msg: '1枚以上選んでください' };
  dis.forEach(c => { const i = p.hand.findIndex(h => h.id === c.id); if (i >= 0) p.hand.splice(i, 1); });
  p.hand = sortHand(p.hand);
  addLog(G, `10捨て:${p.name}が${dis.length}枚捨てた`);
  G.tenDiscardActive = false;
  if (p.hand.length === 0 && p.rank === null) {
    p.rank = G.rankOrder.length; G.rankOrder.push(seatIndex);
    addLog(G, `🏆${p.name}:10捨てで上がり`);
    checkAllFinished(G);
  }
  if (!G.gameOver) {
    let t = G.tenDiscardNextTurn;
    for (let i = 0; i < 4; i++) { if (G.players[t].rank === null) break; t = (t + 1) % 4; }
    G.currentTurn = t;
  }
  broadcastRoom(room.id);
  return { ok: true };
}

function resetField(G, turnPidx) {
  G.lastCards = []; G.lastPlayer = -1; G.shibariSuit = null; G.elevenBack = false;
  for (const p of G.players) p.passed = false;
  let t = turnPidx;
  for (let i = 0; i < 4; i++) { if (G.players[t].rank === null) break; t = (t + 1) % 4; }
  G.currentTurn = t;
}

function checkFinished(G, pidx, cards) {
  const p = G.players[pidx];
  if (p.hand.length > 0) return;
  const rev = effectiveRev(G);
  if (isForbiddenWin(cards, rev)) {
    addLog(G, `⚠️${p.name}:反則上がり`); p.rank = 99; G.rankOrder.push(pidx);
  } else {
    const ri = G.rankOrder.filter(i => G.players[i].rank !== 99).length;
    p.rank = ri; G.rankOrder.push(pidx);
    addLog(G, `🏆${p.name}:${['大富豪', '富豪', '貧民', '大貧民'][Math.min(ri, 3)]}！`);
  }
  checkAllFinished(G);
}

function checkAllFinished(G) {
  if (G.rankOrder.length >= 3) {
    for (let i = 0; i < 4; i++) {
      if (G.players[i].rank === null) { G.players[i].rank = G.rankOrder.length; G.rankOrder.push(i); }
    }
    const nrm = G.rankOrder.filter(i => G.players[i].rank !== 99);
    const pen = G.rankOrder.filter(i => G.players[i].rank === 99);
    nrm.forEach((idx, ri) => G.players[idx].rank = ri);
    pen.forEach((idx, ri) => G.players[idx].rank = nrm.length + ri);
    G.gameOver = true;
    G.rankOrder = [...nrm, ...pen];
  }
}

// ===== Socket.IO接続処理 =====
io.on('connection', (socket) => {
  console.log('接続:', socket.id);

  // ルーム作成
  socket.on('createRoom', ({ name }, cb) => {
    const roomId = Math.random().toString(36).substr(2, 6).toUpperCase();
    const room = createRoom(roomId);
    room.players.push({ socketId: socket.id, name, seatIndex: 0 });
    socket.join(roomId);
    socket.data.roomId = roomId;
    socket.data.seatIndex = 0;
    socket.data.name = name;
    cb({ ok: true, roomId });
    broadcastRoom(roomId);
  });

  // ルーム参加
  socket.on('joinRoom', ({ roomId, name }, cb) => {
    const room = getRoom(roomId);
    if (!room) return cb({ ok: false, msg: 'ルームが見つかりません' });
    if (room.players.length >= 4) return cb({ ok: false, msg: '満員です' });
    if (room.started) return cb({ ok: false, msg: 'ゲームはすでに開始しています' });
    const seatIndex = room.players.length;
    room.players.push({ socketId: socket.id, name, seatIndex });
    socket.join(roomId);
    socket.data.roomId = roomId;
    socket.data.seatIndex = seatIndex;
    socket.data.name = name;
    cb({ ok: true, roomId, seatIndex });
    broadcastRoom(roomId);
  });

  // ゲーム開始（ホストのみ）
  socket.on('startGame', (_, cb) => {
    const room = getRoom(socket.data.roomId);
    if (!room) return cb && cb({ ok: false });
    if (socket.data.seatIndex !== 0) return cb && cb({ ok: false, msg: 'ホストのみ開始できます' });
    if (room.players.length < 2) return cb && cb({ ok: false, msg: '2人以上必要です' });
    room.started = true;
    // 4人未満はCPUで埋める
    while (room.players.length < 4) {
      room.players.push({ socketId: null, name: `CPU${room.players.length}`, seatIndex: room.players.length, isCpu: true });
    }
    startGame(room);
    cb && cb({ ok: true });
  });

  // カードを出す
  socket.on('playCards', ({ cardIds }, cb) => {
    const room = getRoom(socket.data.roomId);
    if (!room) return cb({ ok: false });
    const result = serverPlayCards(room, socket.data.seatIndex, cardIds);
    cb(result);
    // CPUのターンを処理
    setTimeout(() => processCpuTurns(room), 800);
  });

  // パス
  socket.on('pass', (_, cb) => {
    const room = getRoom(socket.data.roomId);
    if (!room) return cb({ ok: false });
    const result = serverPass(room, socket.data.seatIndex);
    cb(result);
    setTimeout(() => processCpuTurns(room), 800);
  });

  // 7渡し
  socket.on('sevenPass', ({ cardIds }, cb) => {
    const room = getRoom(socket.data.roomId);
    if (!room) return cb({ ok: false });
    const result = serverSevenPass(room, socket.data.seatIndex, cardIds);
    cb(result);
    setTimeout(() => processCpuTurns(room), 800);
  });

  // 10捨て
  socket.on('tenDiscard', ({ cardIds }, cb) => {
    const room = getRoom(socket.data.roomId);
    if (!room) return cb({ ok: false });
    const result = serverTenDiscard(room, socket.data.seatIndex, cardIds);
    cb(result);
    setTimeout(() => processCpuTurns(room), 800);
  });

  // 次のゲーム
  socket.on('nextGame', (_, cb) => {
    const room = getRoom(socket.data.roomId);
    if (!room) return;
    if (socket.data.seatIndex !== 0) return;
    startGame(room);
    cb && cb({ ok: true });
  });

  // 切断
  socket.on('disconnect', () => {
    const roomId = socket.data.roomId;
    if (!roomId) return;
    const room = getRoom(roomId);
    if (!room) return;
    console.log(`${socket.data.name} が切断しました`);
    // ゲーム中でなければ退出
    if (!room.started) {
      room.players = room.players.filter(p => p.socketId !== socket.id);
      if (room.players.length === 0) delete rooms[roomId];
      else broadcastRoom(roomId);
    }
  });
});

// ===== CPU処理 =====
function processCpuTurns(room) {
  const G = room.game;
  if (!G || G.gameOver) return;

  // 特殊アクション待ちのCPU処理
  if (G.sevenPassActive) {
    const from = G.sevenPassFrom;
    if (room.players[from].isCpu) {
      const give = sortHand(G.players[from].hand).slice(0, 1);
      give.forEach(c => { const i = G.players[from].hand.findIndex(h => h.id === c.id); if (i >= 0) G.players[from].hand.splice(i, 1); });
      G.players[G.sevenPassTo].hand = sortHand([...G.players[G.sevenPassTo].hand, ...give]);
      addLog(G, `7渡し:${G.players[from].name}→${G.players[G.sevenPassTo].name}に${give.length}枚`);
      G.sevenPassActive = false;
      let t = G.sevenPassNextTurn;
      for (let i = 0; i < 4; i++) { if (G.players[t].rank === null) break; t = (t + 1) % 4; }
      G.currentTurn = t;
      broadcastRoom(room.id);
      setTimeout(() => processCpuTurns(room), 700);
      return;
    }
  }

  if (G.tenDiscardActive) {
    const from = G.tenDiscardFrom;
    if (room.players[from].isCpu) {
      const dis = sortHand(G.players[from].hand).slice(0, 1);
      dis.forEach(c => { const i = G.players[from].hand.findIndex(h => h.id === c.id); if (i >= 0) G.players[from].hand.splice(i, 1); });
      addLog(G, `10捨て:${G.players[from].name}が${dis.length}枚捨てた`);
      G.tenDiscardActive = false;
      let t = G.tenDiscardNextTurn;
      for (let i = 0; i < 4; i++) { if (G.players[t].rank === null) break; t = (t + 1) % 4; }
      G.currentTurn = t;
      broadcastRoom(room.id);
      setTimeout(() => processCpuTurns(room), 700);
      return;
    }
  }

  const cur = G.currentTurn;
  if (!room.players[cur] || !room.players[cur].isCpu) return;
  if (G.players[cur].rank !== null) return;

  const play = cpuChoose(G, cur);
  if (play) {
    // CPUがカードを出す
    const p = G.players[cur];
    play.forEach(c => { const i = p.hand.findIndex(h => h.id === c.id); if (i >= 0) p.hand.splice(i, 1); });
    const num = play.filter(c => !c.isJoker)[0]?.num || null;
    const isSP3 = play.length === 1 && play[0].suit === '♠' && play[0].num === '3' &&
      G.lastCards.length === 1 && G.lastCards[0].isJoker;
    if (!isSP3 && isRevolution(play)) {
      G.revolution = !G.revolution;
      addLog(G, G.revolution ? '🔄 革命！' : '🔄 革命返し！');
    }
    if (!isSP3 && G.lastCards.length) {
      const s = calcShibari(G.lastCards, play);
      if (s) { G.shibariSuit = s; addLog(G, `🔒 ${s}縛り！`); }
    }
    addLog(G, `${p.name}: ${play.map(c => c.isJoker ? '★JOK' : c.num + c.suit).join(',')}`);

    if (num === '8' && !isSP3) {
      G.lastCards = [...play]; G.lastPlayer = cur;
      checkFinished(G, cur, play);
      if (!G.gameOver) resetField(G, cur);
    } else if (isSP3) {
      checkFinished(G, cur, play);
      if (!G.gameOver) resetField(G, cur);
    } else if (num === 'J') {
      G.elevenBack = !G.elevenBack;
      G.lastCards = [...play]; G.lastPlayer = cur;
      checkFinished(G, cur, play);
      if (!G.gameOver) G.currentTurn = nextAlive(G, cur);
    } else if (num === '7') {
      G.lastCards = [...play]; G.lastPlayer = cur;
      checkFinished(G, cur, play);
      if (!G.gameOver) {
        const tgt = nextAlive(G, cur);
        G.sevenPassActive = true; G.sevenPassMax = play.length;
        G.sevenPassFrom = cur; G.sevenPassTo = tgt;
        G.sevenPassNextTurn = nextAlive(G, cur);
      }
    } else if (num === '5') {
      G.lastCards = [...play]; G.lastPlayer = cur;
      checkFinished(G, cur, play);
      if (!G.gameOver) {
        let skip = play.length, next = (cur + 1) % 4;
        for (let s = 0; s < skip; s++) {
          while (G.players[next].rank !== null) next = (next + 1) % 4;
          next = (next + 1) % 4;
        }
        while (G.players[next].rank !== null) next = (next + 1) % 4;
        G.currentTurn = next;
      }
    } else if (num === '10') {
      G.lastCards = [...play]; G.lastPlayer = cur;
      checkFinished(G, cur, play);
      if (!G.gameOver) {
        G.tenDiscardActive = true; G.tenDiscardMax = play.length;
        G.tenDiscardFrom = cur;
        G.tenDiscardNextTurn = nextAlive(G, cur);
      }
    } else {
      G.lastCards = [...play]; G.lastPlayer = cur;
      checkFinished(G, cur, play);
      if (!G.gameOver) G.currentTurn = nextAlive(G, cur);
    }
  } else {
    // CPUパス
    G.players[cur].passed = true;
    addLog(G, `${G.players[cur].name}:パス`);
    const alive = G.players.filter(p => p.rank === null && !p.passed);
    if (!alive.length || (alive.length === 1 && G.lastPlayer >= 0 && alive[0] === G.players[G.lastPlayer])) {
      let lp = G.lastPlayer >= 0 ? G.lastPlayer : cur;
      if (G.players[lp].rank !== null) { lp = (lp + 1) % 4; for (let t = 0; t < 4; t++) { if (G.players[lp].rank === null) break; lp = (lp + 1) % 4; } }
      resetField(G, lp);
    } else {
      G.currentTurn = nextAlive(G, cur);
    }
  }

  broadcastRoom(room.id);
  if (!G.gameOver) setTimeout(() => processCpuTurns(room), 700);
}

function cpuChoose(G, idx) {
  const hand = G.players[idx].hand;
  const { lastCards } = G;
  const rev = effectiveRev(G);
  const cands = [];
  const normals = sortHand(hand.filter(c => !c.isJoker));
  const jokers = hand.filter(c => c.isJoker);
  const fMode = fieldMode(lastCards);
  function try_(c) { if (canPlay(c, G)) cands.push(c); }

  if (!lastCards.length) {
    if (normals.length) try_([normals[0]]);
    for (let i = 0; i < normals.length - 1; i++) {
      if (normals[i].num === normals[i + 1].num) { try_([normals[i], normals[i + 1]]); break; }
    }
  } else {
    const n = lastCards.length;
    if (fMode === 'single') {
      for (const c of normals) try_([c]);
      if (jokers.length) try_([jokers[0]]);
    } else if (fMode === 'multi') {
      const g = {};
      for (const c of normals) { if (!g[c.num]) g[c.num] = []; g[c.num].push(c); }
      for (const v of Object.values(g)) {
        if (v.length >= n) try_(v.slice(0, n));
        if (v.length >= n - 1 && jokers.length) try_([...v.slice(0, n - 1), jokers[0]]);
      }
    } else if (fMode === 'stairs') {
      const sts = findAllStairs(normals, jokers, n);
      for (const s of sts) try_(s);
    }
  }
  if (!cands.length) return null;
  cands.sort((a, b) => fMode === 'stairs'
    ? stairsTopRank(a, rev) - stairsTopRank(b, rev)
    : mainRank(a, rev) - mainRank(b, rev));
  return cands[0];
}

function findAllStairs(normals, jokers, len) {
  const res = [];
  for (const suit of SUITS) {
    const sc = sortHand(normals.filter(c => c.suit === suit));
    for (let i = 0; i <= sc.length - len; i++) { const seg = sc.slice(i, i + len); if (isStairs(seg)) res.push(seg); }
    if (jokers.length && sc.length >= len - 1) {
      for (let i = 0; i <= sc.length - (len - 1); i++) { const seg = [...sc.slice(i, i + len - 1), jokers[0]]; if (isStairs(seg)) res.push(seg); }
    }
  }
  return res;
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`大富豪サーバー起動: http://localhost:${PORT}`));
