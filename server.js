const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// ルーム管理
const rooms = {}; // roomCode -> { players: [{id, name, hand, passed, rank}], state... }

function makeCode() {
  return Math.random().toString(36).substring(2, 6).toUpperCase();
}

// ===== カードロジック =====
const SUITS = ['♣','♦','♥','♠'];
const NUMS  = ['3','4','5','6','7','8','9','10','J','Q','K','A','2'];
const NR = {};
NUMS.forEach((n,i) => NR[n] = i + 3);

function makeDeck() {
  const d = [];
  for (const s of SUITS) for (const n of NUMS) d.push({suit:s,num:n,id:s+n,isJoker:false});
  d.push({suit:'★',num:'JOKER',id:'JOKER',isJoker:true});
  d.push({suit:'★',num:'JOKER',id:'JOKER2',isJoker:true});
  return d;
}
function shuffle(a) {
  for (let i = a.length-1; i > 0; i--) {
    const j = Math.floor(Math.random()*(i+1));
    [a[i],a[j]] = [a[j],a[i]];
  }
  return a;
}
function cr(c)  { return c.isJoker ? 100 : NR[c.num]; }
function siS(s) { return SUITS.indexOf(s); }
function sortHand(h) {
  return [...h].sort((a,b) => {
    if (a.isJoker && b.isJoker) return 0;
    if (a.isJoker) return 1;
    if (b.isJoker) return -1;
    if (cr(a) !== cr(b)) return cr(a)-cr(b);
    return siS(a.suit)-siS(b.suit);
  });
}
function r2n(r) { return NUMS.find(n=>NR[n]===r)||null; }
function getEffRanks(cards, jokerRank) {
  return cards.map(c => c.isJoker ? (jokerRank!==undefined?jokerRank:null) : NR[c.num]).filter(r=>r!==null);
}
function isStairsCards(cards, jokerRank) {
  if (cards.length < 3) return false;
  const normals = cards.filter(c=>!c.isJoker);
  const jokers  = cards.filter(c=>c.isJoker);
  if (jokers.length > 1 || !normals.length) return false;
  const suit = normals[0].suit;
  if (!normals.every(c=>c.suit===suit)) return false;
  const nums = normals.map(c=>NR[c.num]).sort((a,b)=>a-b);
  for (let i=0;i<nums.length-1;i++) if (nums[i]===nums[i+1]) return false;
  if (!jokers.length) {
    for (let i=0;i<nums.length-1;i++) if (nums[i+1]-nums[i]!==1) return false;
    return true;
  }
  if (jokerRank !== undefined) {
    const all = [...nums, jokerRank].sort((a,b)=>a-b);
    for (let i=0;i<all.length-1;i++) if (all[i+1]-all[i]!==1) return false;
    return true;
  }
  let gaps = 0;
  for (let i=0;i<nums.length-1;i++) {
    const d = nums[i+1]-nums[i];
    if (d===1) continue;
    if (d===2) { gaps++; continue; }
    return false;
  }
  return gaps <= 1;
}
function stairsTop(cards, rev, jokerRank) {
  const normals = cards.filter(c=>!c.isJoker);
  const nums = normals.map(c=>NR[c.num]).sort((a,b)=>a-b);
  const top = jokerRank!==undefined ? Math.max(...nums,jokerRank) : (cards.some(c=>c.isJoker)?nums[nums.length-1]+1:nums[nums.length-1]);
  return rev ? (100-top) : top;
}
function isValidPair(cards) {
  const n = cards.filter(c=>!c.isJoker);
  return !n.length || n.every(c=>c.num===n[0].num);
}
function detectMode(cards, jokerRank) {
  if (!cards.length) return null;
  if (cards.length===1) return 'single';
  if (isStairsCards(cards,jokerRank)) return 'stairs';
  if (isValidPair(cards)) return 'multi';
  return null;
}
function fMode(lc) {
  if (!lc.length) return null;
  if (lc.length===1) return 'single';
  if (isStairsCards(lc,undefined)) return 'stairs';
  return 'multi';
}
function effRev(G) { return G.revolution !== G.elevenBack; }
function mainRank(cards, rev) {
  const n = cards.filter(c=>!c.isJoker);
  if (!n.length) return 100;
  return rev ? (16-NR[n[0].num]) : NR[n[0].num];
}
function canPlay(cards, G, jokerRank) {
  if (!cards.length) return false;
  const rev = effRev(G);
  const { lastCards, shibariSuits, kazuShibariNum } = G;
  if (cards.length===1 && cards[0].suit==='♠' && cards[0].num==='3' && lastCards.length===1 && lastCards[0].isJoker) return true;
  const mode = detectMode(cards, jokerRank);
  if (!mode) return false;
  if (!lastCards.length) return true;
  const fm = fMode(lastCards);
  if (mode!==fm || cards.length!==lastCards.length) return false;
  if (shibariSuits && shibariSuits.length>0 && mode!=='stairs') {
    const nxtSuits = new Set(cards.filter(c=>!c.isJoker).map(c=>c.suit));
    if (!shibariSuits.every(s=>nxtSuits.has(s))) return false;
  }
  if (kazuShibariNum!==null && kazuShibariNum!==undefined) {
    const effRanks = getEffRanks(cards, jokerRank);
    if (!effRanks.includes(kazuShibariNum)) return false;
  }
  if (cards.length===1 && cards[0].isJoker) return true;
  if (mode==='stairs') return stairsTop(cards,rev,jokerRank) > stairsTop(lastCards,rev,undefined);
  return mainRank(cards,rev) > mainRank(lastCards,rev);
}
function isRevolution(cards) {
  const n = cards.filter(c=>!c.isJoker);
  const j = cards.filter(c=>c.isJoker);
  if (cards.length>=4 && isStairsCards(cards,undefined)) return true;
  if (n.length===4 && n.every(c=>c.num===n[0].num)) return true;
  if (n.length===3 && j.length>=1 && n.every(c=>c.num===n[0].num)) return true;
  return false;
}
function isForbiddenWin(cards, rev, jokerRank) {
  if (cards.length>=4) return true;
  if (cards.some(c=>c.isJoker)) return true;
  const effNums = getEffRanks(cards,jokerRank).map(r=>r2n(r)).filter(Boolean);
  if (effNums.includes('8')) return true;
  if (!rev && effNums.includes('2')) return true;
  if (rev && effNums.includes('3')) return true;
  return false;
}
function calcShibari(prev, nxt) {
  if (nxt.some(c=>c.isJoker)) return [];
  if (isStairsCards(nxt,undefined)) return [];
  const pSuits = prev.filter(c=>!c.isJoker).map(c=>c.suit);
  const nSuits = nxt.filter(c=>!c.isJoker).map(c=>c.suit);
  return [...new Set(pSuits.filter(s=>nSuits.includes(s)))];
}
function calcKazuShibari(lastCards, newCards, currentKazuNum, jokerRank, revNow, revAfter) {
  if (newCards.some(c=>c.isJoker)) return null;
  const newRanks = getEffRanks(newCards, jokerRank);
  if (!newRanks.length) return null;
  const newMin = Math.min(...newRanks), newMax = Math.max(...newRanks);
  if (currentKazuNum!==null && currentKazuNum!==undefined) {
    if (!newRanks.includes(currentKazuNum)) return null;
    return revAfter ? (currentKazuNum-1) : (currentKazuNum+1);
  }
  if (!lastCards || !lastCards.length) return null;
  const prevRanks = lastCards.map(c=>c.isJoker?null:NR[c.num]).filter(r=>r!==null);
  if (!prevRanks.length) return null;
  const prevMax = Math.max(...prevRanks), prevMin = Math.min(...prevRanks);
  if (!revNow) { if (newMin-prevMax===1) return revAfter?(newMin-1):(newMax+1); }
  else         { if (prevMin-newMax===1) return revAfter?(newMin-1):(newMax+1); }
  return null;
}
function nextAlive(G, pidx) {
  let n = (pidx+1)%4;
  for (let t=0;t<4;t++) { if (G.players[n].rank===null && !G.players[n].passed) return n; n=(n+1)%4; }
  n = (pidx+1)%4;
  for (let t=0;t<4;t++) { if (G.players[n].rank===null) return n; n=(n+1)%4; }
  return pidx;
}

// ===== ゲーム状態初期化 =====
function initGame(room) {
  const deck = shuffle(makeDeck());
  const hands = [[],[],[],[]];
  for (let i=0;i<deck.length;i++) hands[i%4].push(deck[i]);
  for (let i=0;i<4;i++) hands[i] = sortHand(hands[i]);

  const prevRanks = room.G ? room.G.rankOrder : null;

  room.G = {
    round: (room.G?.round||0)+1,
    players: room.players.map((p,i) => ({
      id: p.id, name: p.name,
      hand: hands[i], passed: false, rank: null
    })),
    lastCards: [], lastPlayer: -1, currentTurn: 0,
    rankOrder: [], revolution: false, elevenBack: false,
    gameOver: false, log: [],
    shibariSuits: [], kazuShibariNum: null,
    prevPlay: null,
    sevenPassActive: false, sevenPassMax: 0, sevenPassFrom: -1, sevenPassTo: -1, sevenPassNextTurn: -1,
    tenDiscardActive: false, tenDiscardMax: 0, tenDiscardFrom: -1, tenDiscardNextTurn: -1,
    pendingEffects: null,
  };

  // ♦3スタート
  let first = 0;
  for (let i=0;i<4;i++) {
    if (room.G.players[i].hand.some(c=>c.suit==='♦'&&c.num==='3')) { first=i; break; }
  }
  room.G.currentTurn = first;

  // 2ラウンド目以降カード交換
  if (prevRanks && prevRanks.length===4) {
    doExchange(room.G, prevRanks);
  }
}

function doExchange(G, prevRanks) {
  // prevRanks = [rank0のpidx, rank1のpidx, rank2のpidx, rank3のpidx]
  const daifu=prevRanks[0], fugo=prevRanks[1], hinmin=prevRanks[2], daihin=prevRanks[3];
  function autoEx(upper, lower, cnt) {
    const strong = sortHand(G.players[lower].hand).slice(-cnt);
    strong.forEach(c => { const i=G.players[lower].hand.findIndex(h=>h.id===c.id); if(i>=0)G.players[lower].hand.splice(i,1); });
    const weak = sortHand(G.players[upper].hand).slice(0,cnt);
    weak.forEach(c => { const i=G.players[upper].hand.findIndex(h=>h.id===c.id); if(i>=0)G.players[upper].hand.splice(i,1); });
    strong.forEach(c=>G.players[upper].hand.push(c));
    weak.forEach(c=>G.players[lower].hand.push(c));
    G.players[upper].hand = sortHand(G.players[upper].hand);
    G.players[lower].hand = sortHand(G.players[lower].hand);
  }
  autoEx(daifu, daihin, 2);
  autoEx(fugo, hinmin, 1);
}

// ===== ゲーム状態をクライアント用に整形（手札は自分のだけ） =====
function stateForPlayer(G, pidx) {
  return {
    round: G.round,
    players: G.players.map((p,i) => ({
      name: p.name,
      handCount: p.hand.length,
      passed: p.passed,
      rank: p.rank,
      hand: i===pidx ? p.hand : undefined,
    })),
    lastCards: G.lastCards,
    lastPlayer: G.lastPlayer,
    currentTurn: G.currentTurn,
    rankOrder: G.rankOrder,
    revolution: G.revolution,
    elevenBack: G.elevenBack,
    gameOver: G.gameOver,
    log: G.log.slice(-8),
    shibariSuits: G.shibariSuits,
    kazuShibariNum: G.kazuShibariNum,
    prevPlay: G.prevPlay,
    sevenPassActive: G.sevenPassActive,
    sevenPassMax: G.sevenPassMax,
    sevenPassFrom: G.sevenPassFrom,
    sevenPassTo: G.sevenPassTo,
    tenDiscardActive: G.tenDiscardActive,
    tenDiscardMax: G.tenDiscardMax,
    tenDiscardFrom: G.tenDiscardFrom,
    myIndex: pidx,
  };
}

function broadcastState(room) {
  const G = room.G;
  room.players.forEach((p, i) => {
    const sock = io.sockets.sockets.get(p.id);
    if (sock) sock.emit('state', stateForPlayer(G, i));
  });
}

function addLog(G, msg) {
  G.log.push(msg);
  if (G.log.length > 30) G.log.shift();
}

// ===== 上がり判定 =====
function checkFinished(room, pidx, cards, jokerRank) {
  const G = room.G;
  const p = G.players[pidx];
  if (p.hand.length > 0) return false;
  const rev = effRev(G);
  if (isForbiddenWin(cards, rev, jokerRank)) {
    addLog(G, `⚠️${p.name}:反則上がり`);
    p.rank = 99;
    G.rankOrder.push(pidx);
  } else {
    const ri = G.rankOrder.filter(i=>G.players[i].rank!==99).length;
    p.rank = ri;
    G.rankOrder.push(pidx);
    addLog(G, `🏆${p.name}:${['大富豪','富豪','貧民','大貧民'][Math.min(ri,3)]}！`);
  }
  if (G.rankOrder.length >= 3) {
    for (let i=0;i<4;i++) {
      if (G.players[i].rank===null) { G.players[i].rank=99; G.rankOrder.push(i); }
    }
    const nrm = G.rankOrder.filter(i=>G.players[i].rank!==99);
    const pen = G.rankOrder.filter(i=>G.players[i].rank===99);
    nrm.forEach((idx,ri) => G.players[idx].rank=ri);
    pen.forEach((idx,ri) => G.players[idx].rank=3-ri);
    G.gameOver = true;
    G.rankOrder = [0,1,2,3].sort((a,b)=>G.players[a].rank-G.players[b].rank);
  }
  return true;
}

function doPassLogic(room, pidx) {
  const G = room.G;
  const alive = G.players.filter(p=>p.rank===null&&!p.passed);
  if (!alive.length || (alive.length===1 && G.lastPlayer>=0 && alive[0]===G.players[G.lastPlayer])) {
    let lp = G.lastPlayer>=0 ? G.lastPlayer : pidx;
    if (G.players[lp].rank!==null) { lp=(lp+1)%4; for(let t=0;t<4;t++){if(G.players[lp].rank===null)break;lp=(lp+1)%4;} }
    resetField(G, lp);
  } else {
    G.currentTurn = nextAlive(G, pidx);
  }
  broadcastState(room);
}

function resetField(G, turnPidx) {
  G.lastCards=[]; G.lastPlayer=-1; G.shibariSuits=[]; G.kazuShibariNum=null;
  G.elevenBack=false; G.prevPlay=null;
  G.players.forEach(p=>p.passed=false);
  G.pendingEffects=null;
  let t = turnPidx;
  for(let i=0;i<4;i++){if(G.players[t].rank===null)break;t=(t+1)%4;}
  G.currentTurn=t;
}

function applyEffects(room, pidx, has8, has5, hasJ, effects) {
  const G = room.G;
  if (has8) {
    effects.push('🎴 8切り！');
    resetField(G, pidx);
    broadcastState(room);
    return;
  }
  if (hasJ) {
    G.elevenBack = !G.elevenBack;
    effects.push(G.elevenBack?'🔁 11バック！':'🔁 11バック解除');
  }
  if (has5) {
    effects.push(`5スキップ×${has5}！`);
    let n=(pidx+1)%4, skipped=0;
    for(let t=0;t<4&&skipped<has5;t++){
      if(G.players[n].rank===null&&!G.players[n].passed){G.players[n].passed=true;addLog(G,`${G.players[n].name}をスキップ`);skipped++;}
      n=(n+1)%4;
    }
    doPassLogic(room, pidx);
    return;
  }
  G.currentTurn = nextAlive(G, pidx);
  broadcastState(room);
}

// ===== Socket.io =====
io.on('connection', (socket) => {
  console.log('connected', socket.id);

  // ルーム作成
  socket.on('createRoom', ({ name }) => {
    let code;
    do { code = makeCode(); } while (rooms[code]);
    rooms[code] = {
      code,
      players: [{ id: socket.id, name: name||'プレイヤー1' }],
      G: null,
    };
    socket.join(code);
    socket.data.roomCode = code;
    socket.data.playerIndex = 0;
    socket.emit('roomCreated', { code, players: rooms[code].players.map(p=>p.name) });
    console.log('room created', code);
  });

  // ルーム参加
  socket.on('joinRoom', ({ code, name }) => {
    const room = rooms[code];
    if (!room) { socket.emit('error','ルームが見つかりません'); return; }
    if (room.players.length >= 4) { socket.emit('error','満員です'); return; }
    if (room.G) { socket.emit('error','ゲームはすでに開始されています'); return; }

    const pname = name || `プレイヤー${room.players.length+1}`;
    room.players.push({ id: socket.id, name: pname });
    socket.join(code);
    socket.data.roomCode = code;
    socket.data.playerIndex = room.players.length - 1;

    io.to(code).emit('playerJoined', { players: room.players.map(p=>p.name) });

    // 4人揃ったら開始
    if (room.players.length === 4) {
      setTimeout(() => startGame(room), 800);
    }
  });

  // カードを出す
  socket.on('playCards', ({ cardIds, jokerRank }) => {
    const room = rooms[socket.data.roomCode];
    if (!room || !room.G) return;
    const G = room.G;
    const pidx = socket.data.playerIndex;
    if (G.currentTurn !== pidx || G.gameOver) return;
    if (G.players[pidx].rank !== null) return;

    const cards = cardIds.map(id => G.players[pidx].hand.find(c=>c.id===id)).filter(Boolean);
    if (!cards.length) return;
    if (!canPlay(cards, G, jokerRank)) { socket.emit('error','出せません'); return; }

    // 手札から取る
    cards.forEach(c => {
      const i = G.players[pidx].hand.findIndex(h=>h.id===c.id);
      if (i>=0) G.players[pidx].hand.splice(i,1);
    });

    const p = G.players[pidx];
    const isSP3 = cards.length===1 && cards[0].suit==='♠' && cards[0].num==='3' && G.lastCards.length===1 && G.lastCards[0].isJoker;
    const effects = [];

    if (!isSP3 && isRevolution(cards)) {
      G.revolution = !G.revolution;
      effects.push(G.revolution?'🔄 革命！':'🔄 革命返し！');
    }
    if (!isSP3 && G.lastCards.length && !cards.some(c=>c.isJoker)) {
      const ns = calcShibari(G.lastCards, cards);
      if (ns.length>0) { G.shibariSuits=ns; effects.push(`🔒 ${ns.join('')}縛り！`); }
    }
    if (!isSP3 && !cards.some(c=>c.isJoker)) {
      const revNow=effRev(G), willJ=cards.some(c=>c.num==='J'), revAfter=willJ?!revNow:revNow;
      const kz=calcKazuShibari(G.lastCards,cards,G.kazuShibariNum,jokerRank,revNow,revAfter);
      if (kz!==null&&kz!==G.kazuShibariNum) { G.kazuShibariNum=kz; effects.push('🔢 数字縛り！'); }
    }

    const cardStr = cards.map(c=>{
      if(c.isJoker&&jokerRank!==undefined){const n=r2n(jokerRank);return `★(${n||'?'})`;}
      return c.isJoker?'★JOK':c.num+c.suit;
    }).join(',');
    addLog(G, `${p.name}: ${cardStr}`);
    if (effects.length) addLog(G, effects.join(' '));

    if (isSP3) {
      addLog(G,'♠3返し！');
      checkFinished(room, pidx, cards, undefined);
      if (G.gameOver) { broadcastState(room); return; }
      resetField(G, pidx);
      broadcastState(room);
      return;
    }

    if (G.lastCards.length>0) {
      G.prevPlay = { cards:[...G.lastCards], playerName: G.lastPlayer>=0?G.players[G.lastPlayer].name:'' };
    }
    G.players.forEach(pl=>pl.passed=false);
    G.lastCards = [...cards];
    G.lastPlayer = pidx;

    const effRanks = getEffRanks(cards, jokerRank);
    const has8  = effRanks.includes(NR['8']);
    const has7  = effRanks.filter(r=>r===NR['7']).length;
    const has10 = effRanks.filter(r=>r===NR['10']).length;
    const has5  = effRanks.filter(r=>r===NR['5']).length;
    const hasJ  = effRanks.includes(NR['J']);

    checkFinished(room, pidx, cards, jokerRank);
    if (G.gameOver) { broadcastState(room); return; }

    // 上がり後はスキップ
    if (p.rank !== null) {
      applyEffects(room, pidx, has8, has5, hasJ, effects);
      return;
    }

    // 7渡し
    if (has7 > 0) {
      addLog(G, `7渡し×${has7}！`);
      G.sevenPassActive=true; G.sevenPassMax=has7;
      G.sevenPassFrom=pidx; G.sevenPassTo=nextAlive(G,pidx); G.sevenPassNextTurn=nextAlive(G,pidx);
      G.pendingEffects={pidx,has8,has5,hasJ};
      broadcastState(room);
      return;
    }
    // 10捨て
    if (has10 > 0) {
      addLog(G, `10捨て×${has10}！`);
      G.tenDiscardActive=true; G.tenDiscardMax=has10;
      G.tenDiscardFrom=pidx; G.tenDiscardNextTurn=nextAlive(G,pidx);
      G.pendingEffects={pidx,has8,has5,hasJ};
      broadcastState(room);
      return;
    }

    applyEffects(room, pidx, has8, has5, hasJ, effects);
  });

  // パス
  socket.on('pass', () => {
    const room = rooms[socket.data.roomCode];
    if (!room || !room.G) return;
    const G = room.G;
    const pidx = socket.data.playerIndex;
    if (G.currentTurn!==pidx || G.gameOver || !G.lastCards.length) return;
    G.players[pidx].passed = true;
    addLog(G, `${G.players[pidx].name}:パス`);
    doPassLogic(room, pidx);
  });

  // 7渡し
  socket.on('sevenPass', ({ cardIds }) => {
    const room = rooms[socket.data.roomCode];
    if (!room||!room.G||!room.G.sevenPassActive) return;
    const G = room.G;
    const from = G.sevenPassFrom;
    if (socket.data.playerIndex !== from) return;

    const give = cardIds.map(id=>G.players[from].hand.find(c=>c.id===id)).filter(Boolean);
    give.forEach(c=>{const i=G.players[from].hand.findIndex(h=>h.id===c.id);if(i>=0)G.players[from].hand.splice(i,1);});
    G.players[G.sevenPassTo].hand = sortHand([...G.players[G.sevenPassTo].hand,...give]);
    G.players[from].hand = sortHand(G.players[from].hand);
    addLog(G, `7渡し:${G.players[from].name}→${G.players[G.sevenPassTo].name}に${give.length}枚`);
    G.sevenPassActive = false;

    if (G.players[from].hand.length===0 && G.players[from].rank===null) {
      const ri=G.rankOrder.filter(i=>G.players[i].rank!==99).length;
      G.players[from].rank=ri; G.rankOrder.push(from);
      addLog(G,`🏆${G.players[from].name}:${['大富豪','富豪','貧民','大貧民'][Math.min(ri,3)]}！`);
      if(G.rankOrder.length>=3){finishAll(G);}
    }

    const pe = G.pendingEffects; G.pendingEffects=null;
    if (pe) applyEffects(room, pe.pidx, pe.has8, pe.has5, pe.hasJ, []);
    else {
      let t=G.sevenPassNextTurn;
      for(let i=0;i<4;i++){if(G.players[t].rank===null)break;t=(t+1)%4;}
      G.currentTurn=t; broadcastState(room);
    }
  });

  // 10捨て
  socket.on('tenDiscard', ({ cardIds }) => {
    const room = rooms[socket.data.roomCode];
    if (!room||!room.G||!room.G.tenDiscardActive) return;
    const G = room.G;
    const from = G.tenDiscardFrom;
    if (socket.data.playerIndex !== from) return;

    const dis = cardIds.map(id=>G.players[from].hand.find(c=>c.id===id)).filter(Boolean);
    dis.forEach(c=>{const i=G.players[from].hand.findIndex(h=>h.id===c.id);if(i>=0)G.players[from].hand.splice(i,1);});
    addLog(G, `10捨て:${G.players[from].name}が${dis.length}枚捨てた`);
    G.tenDiscardActive = false;

    if (G.players[from].hand.length===0 && G.players[from].rank===null) {
      const ri=G.rankOrder.filter(i=>G.players[i].rank!==99).length;
      G.players[from].rank=ri; G.rankOrder.push(from);
      addLog(G,`🏆${G.players[from].name}:${['大富豪','富豪','貧民','大貧民'][Math.min(ri,3)]}！`);
      if(G.rankOrder.length>=3){finishAll(G);}
    }

    const pe = G.pendingEffects; G.pendingEffects=null;
    if (pe) applyEffects(room, pe.pidx, pe.has8, pe.has5, pe.hasJ, []);
    else {
      let t=G.tenDiscardNextTurn;
      for(let i=0;i<4;i++){if(G.players[t].rank===null)break;t=(t+1)%4;}
      G.currentTurn=t; broadcastState(room);
    }
  });

  // 次のゲーム開始
  socket.on('nextGame', () => {
    const room = rooms[socket.data.roomCode];
    if (!room||!room.G||!room.G.gameOver) return;
    if (socket.data.playerIndex !== 0) return; // ホストのみ
    startGame(room);
  });

  socket.on('disconnect', () => {
    const code = socket.data.roomCode;
    const room = rooms[code];
    if (!room) return;
    const pname = room.players[socket.data.playerIndex]?.name||'?';
    if (!room.G || room.G.gameOver) {
      // ゲーム前なら退出
      room.players = room.players.filter(p=>p.id!==socket.id);
      if (room.players.length===0) { delete rooms[code]; return; }
      io.to(code).emit('playerJoined', { players: room.players.map(p=>p.name) });
    } else {
      io.to(code).emit('playerLeft', { name: pname });
    }
  });
});

function finishAll(G) {
  for(let i=0;i<4;i++) if(G.players[i].rank===null){G.players[i].rank=99;G.rankOrder.push(i);}
  const nrm=G.rankOrder.filter(i=>G.players[i].rank!==99);
  const pen=G.rankOrder.filter(i=>G.players[i].rank===99);
  nrm.forEach((idx,ri)=>G.players[idx].rank=ri);
  pen.forEach((idx,ri)=>G.players[idx].rank=3-ri);
  G.gameOver=true;
  G.rankOrder=[0,1,2,3].sort((a,b)=>G.players[a].rank-G.players[b].rank);
}

function startGame(room) {
  // rankOrderからprevRanks生成（前ラウンドの順位）
  const prevRankOrder = room.G?.rankOrder?.length===4 ? room.G.rankOrder : null;
  initGame(room);
  if (prevRankOrder) {
    // rankOrder = [1位pidx, 2位pidx, 3位pidx, 4位pidx]
    doExchange(room.G, prevRankOrder);
    addLog(room.G, 'カード交換完了！');
  }
  addLog(room.G, `第${room.G.round}ラウンド開始！♦3を持つ人から`);
  broadcastState(room);
  io.to(room.code).emit('gameStart');
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
