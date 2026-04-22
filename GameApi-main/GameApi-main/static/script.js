const API_KEY = '6b226d88-aae9-4e04-9260-025aef47ea8bb43630f78a87420fb320896feb5028ee';
const API_BASE = 'http://127.0.0.1:3000';
const MAX_PLAYERS = 4;
const TRACK_LENGTH = 24;
const PAWNS_PER_PLAYER = 4;
const PLAYER_COLORS = ['green', 'red', 'yellow', 'blue'];
const TRACK_COORDS = [
  [3, 0], [2, 0], [1, 0], [0, 0], [0, 1], [0, 2],
  [0, 3], [0, 4], [0, 5], [0, 6], [1, 6], [2, 6],
  [3, 6], [4, 6], [5, 6], [6, 6], [6, 5], [6, 4],
  [6, 3], [6, 2], [6, 1], [6, 0], [5, 0], [4, 0]
];

const START_POSITIONS = { green: 0, red: 6, yellow: 12, blue: 18 };

const HOME_LANE_POSITIONS = {
  green:  [24, 25, 26, 27],
  red:    [28, 29, 30, 31],
  yellow: [32, 33, 34, 35],
  blue:   [36, 37, 38, 39]
};

const HOME_LANES = {
  green:  [[3, 1], [3, 2], [3, 3], [2, 3]],
  red:    [[1, 3], [2, 3], [3, 3], [3, 4]],
  yellow: [[5, 3], [4, 3], [3, 3], [3, 2]],
  blue:   [[3, 5], [3, 4], [3, 3], [4, 3]]
};

const state = {
  lobbies: [],
  activeLobbyId: null,
  activeLobby: null,
  players: [],
  moves: [],
  allMoves: [],
  joinedPlayersByLobby: loadJoinedPlayers(),
  previousPositions: null,
  pendingRoll: null,
  movablePawnIndexes: [],
  selectedPawnIndex: null,
  refreshInFlight: false,
  syncInterval: null,
  submitting: false
};

const ui = {
  createLobbyForm: document.getElementById('createLobbyForm'),
  lobbyName: document.getElementById('lobbyName'),
  refreshLobbiesBtn: document.getElementById('refreshLobbiesBtn'),
  lobbyList: document.getElementById('lobbyList'),
  activeLobbyTitle: document.getElementById('activeLobbyTitle'),
  lobbyStatus: document.getElementById('lobbyStatus'),
  turnBadge: document.getElementById('turnBadge'),
  joinForm: document.getElementById('joinForm'),
  nickname: document.getElementById('nickname'),
  joinBtn: document.getElementById('joinBtn'),
  rollDiceBtn: document.getElementById('rollDiceBtn'),
  diceValue: document.getElementById('diceValue'),
  board: document.getElementById('board'),
  winnerText: document.getElementById('winnerText'),
  playerCount: document.getElementById('playerCount'),
  playerList: document.getElementById('playerList'),
  moveList: document.getElementById('moveList'),
  toastWrap: document.getElementById('toastWrap'),
  deleteGameBtn: document.getElementById('deleteGameBtn'),
  pawnPicker: document.getElementById('pawnPicker')
};

bootstrapApp();

function bootstrapApp() {
  bindEvents();
  renderBoard();
  refreshAll();
  startSyncInterval();
}

function startSyncInterval() {
  if (state.syncInterval) clearInterval(state.syncInterval);
  state.syncInterval = setInterval(() => {
    // Non sincronizzare MAI mentre l'utente sta scegliendo la pedina o inviando
    if (state.activeLobbyId && !state.refreshInFlight && !state.submitting && state.pendingRoll === null) {
      refreshActiveLobby(true);
    }
  }, 2000);
}

function bindEvents() {
  ui.createLobbyForm.addEventListener('submit', onCreateLobby);
  ui.refreshLobbiesBtn.addEventListener('click', refreshAll);
  ui.joinForm.addEventListener('submit', onJoinLobby);
  ui.rollDiceBtn.addEventListener('click', onRollDice);
  document.addEventListener('click', onPieceClick);
  ui.deleteGameBtn.addEventListener('click', onDeleteGame);
  ui.playerList.addEventListener('click', onPlayerListClick);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && state.pendingRoll === null && !state.submitting) refreshAll();
  });
  window.addEventListener('focus', () => {
    if (state.pendingRoll === null && !state.submitting) refreshAll();
  });
  window.addEventListener('beforeunload', () => {
    if (state.syncInterval) clearInterval(state.syncInterval);
  });
}

// ─── PAWN PICKER ────────────────────────────────────────────

function showPawnPicker(movablePawnIndexes, pawnPositions, role) {
  const picker = ui.pawnPicker;
  if (!picker) return;
  picker.innerHTML = '';
  picker.classList.remove('hidden');

  const title = document.createElement('p');
  title.className = 'picker-title';
  title.textContent = `Dado ${state.pendingRoll} — scegli la pedina da muovere`;
  picker.appendChild(title);

  const grid = document.createElement('div');
  grid.className = 'picker-grid';

  movablePawnIndexes.forEach(pawnIndex => {
    const pos = (pawnPositions[role.player.id] || [])[pawnIndex] ?? -1;
    let posLabel;
    if (pos < 0) posLabel = 'In base';
    else if (pos < TRACK_LENGTH) posLabel = `Casella ${pos + 1}`;
    else posLabel = `Home ${pos - HOME_LANE_POSITIONS[role.color][0] + 1}`;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `picker-btn ${state.selectedPawnIndex === pawnIndex ? 'selected' : ''}`;
    btn.dataset.pawnIndex = String(pawnIndex);
    btn.innerHTML = `
      <span class="picker-piece piece color-${role.color}"></span>
      <span class="picker-label">
        <strong>Pedina ${pawnIndex + 1}</strong>
        <small>${posLabel}</small>
      </span>`;

    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const idx = Number(btn.dataset.pawnIndex);
      state.selectedPawnIndex = idx;
      picker.querySelectorAll('.picker-btn').forEach(b =>
        b.classList.toggle('selected', Number(b.dataset.pawnIndex) === idx));
      await confirmPawnMove(idx);
    });
    grid.appendChild(btn);
  });

  picker.appendChild(grid);
}

function hidePawnPicker() {
  if (ui.pawnPicker) {
    ui.pawnPicker.innerHTML = '';
    ui.pawnPicker.classList.add('hidden');
  }
}

async function confirmPawnMove(pawnIndex) {
  if (state.pendingRoll === null) return;
  const role = currentRole();
  if (role.kind !== 'player') return;
  const roll = state.pendingRoll;
  hidePawnPicker();
  resetPendingSelection();
  await submitPawnMove(role, roll, pawnIndex, false);
}

// ─── EVENT HANDLERS ──────────────────────────────────────────

async function onPieceClick(event) {
  const piece = event.target.closest('[data-piece-index]');
  if (!piece) return;
  const role = currentRole();
  if (role.kind !== 'player' || state.pendingRoll === null) return;
  const ownerId = piece.dataset.playerId;
  const pawnIndex = Number(piece.dataset.pieceIndex);
  if (ownerId !== role.player.id) return;
  if (!state.movablePawnIndexes.includes(pawnIndex)) return;
  event.stopPropagation();
  const roll = state.pendingRoll;
  hidePawnPicker();
  resetPendingSelection();
  await submitPawnMove(role, roll, pawnIndex, false);
}

async function onCreateLobby(event) {
  event.preventDefault();
  const name = ui.lobbyName.value.trim();
  if (!name) return;
  try {
    const result = await apiFetch('/games', { method: 'POST', body: JSON.stringify({ name }) });
    ui.lobbyName.value = '';
    toast('Partita creata', 'success');
    await refreshLobbies();
    if (result?.game?.id) await openLobby(result.game.id);
  } catch (error) { toast(error.message, 'danger'); }
}

async function onJoinLobby(event) {
  event.preventDefault();
  if (!state.activeLobbyId) { toast('Seleziona prima una lobby', 'warning'); return; }
  const nickname = ui.nickname.value.trim();
  if (!nickname) { toast('Inserisci un nickname', 'warning'); return; }
  const normalized = nickname.toLowerCase();
  const existing = state.players.find(p => p.name.trim().toLowerCase() === normalized);
  if (existing) {
    setJoinedPlayer(state.activeLobbyId, existing.id, existing.name);
    ui.nickname.value = '';
    toast('Riconnesso', 'success');
    renderAll();
    return;
  }
  try {
    if (state.players.length >= MAX_PLAYERS) { toast('La lobby è piena', 'warning'); return; }
    const result = await apiFetch(`/games/${state.activeLobbyId}/players`, {
      method: 'POST', body: JSON.stringify({ name: nickname })
    });
    setJoinedPlayer(state.activeLobbyId, result.player.id, result.player.name);
    ui.nickname.value = '';
    toast('Ingresso effettuato', 'success');
    await refreshActiveLobby();
  } catch (error) { toast(error.message, 'danger'); }
}

async function onRollDice() {
  const role = currentRole();
  if (role.kind !== 'player') { toast('Devi entrare come giocatore', 'warning'); return; }
  if (!state.activeLobby || state.activeLobby.status === 'terminated') { toast('Partita terminata', 'warning'); return; }
  if (state.players.length < 2) { toast('Servono almeno 2 giocatori', 'warning'); return; }
  const turn = currentTurnPlayer();
  if (!turn || turn.id !== role.player.id) { toast('Non è il tuo turno', 'warning'); return; }
  if (state.pendingRoll !== null) { toast('Scegli prima una pedina', 'info'); return; }

  const roll = 1 + Math.floor(Math.random() * 6);
  const pawnPositions = buildPawnPositions();
  const myPawns = pawnPositions[role.player.id] || Array(PAWNS_PER_PLAYER).fill(-1);
  const movable = getMovablePawnIndexes(myPawns, roll, role.color);

  ui.diceValue.textContent = String(roll);

  if (!movable.length) {
    await submitPawnMove(role, roll, 0, true);
    return;
  }
  if (movable.length === 1) {
    await submitPawnMove(role, roll, movable[0], false);
    return;
  }

  // Più pedine muovibili → picker
  state.pendingRoll = roll;
  state.movablePawnIndexes = movable;
  state.selectedPawnIndex = movable[0];
  renderBoard();
  showPawnPicker(movable, pawnPositions, role);
}

async function onDeleteGame() {
  if (!state.activeLobbyId) return;
  if (!confirm(`Eliminare la partita "${state.activeLobby?.name}"?`)) return;
  try {
    await eliminaGioco(state.activeLobbyId);
    state.activeLobbyId = null; state.activeLobby = null;
    state.players = []; state.moves = []; state.allMoves = [];
    resetPendingSelection(); hidePawnPicker();
    toast('Partita eliminata', 'success');
    await refreshLobbies(); renderAll();
  } catch (error) { toast(error.message, 'danger'); }
}

async function onDeletePlayer(playerId, playerName) {
  if (!state.activeLobbyId) return;
  if (!confirm(`Rimuovere "${playerName}"?`)) return;
  try {
    await eliminaUtenteDallaPartita(state.activeLobbyId, playerId);
    const joined = state.joinedPlayersByLobby[state.activeLobbyId];
    if (joined?.playerId === playerId) {
      delete state.joinedPlayersByLobby[state.activeLobbyId];
      const data = JSON.stringify(state.joinedPlayersByLobby);
      try { localStorage.setItem('ludoJoinedPlayers', data); } catch {}
      try { sessionStorage.setItem('ludoJoinedPlayers', data); } catch {}
    }
    toast(`${playerName} rimosso`, 'success');
    await refreshActiveLobby();
  } catch (error) { toast(error.message, 'danger'); }
}

function onPlayerListClick(event) {
  const btn = event.target.closest('.delete-player-btn');
  if (!btn) return;
  onDeletePlayer(btn.dataset.playerId, btn.dataset.playerName);
}

// ─── LOGICA MOSSE ────────────────────────────────────────────

async function submitPawnMove(role, roll, pawnIndex, skipped) {
  state.submitting = true;

  const pawnPositions = buildPawnPositions();
  const pawns = pawnPositions[role.player.id] || Array(PAWNS_PER_PLAYER).fill(-1);
  const currentPos = pawns[pawnIndex] ?? -1;
  let nextPos = currentPos;
  let finished = false, enteredBoard = false, enteredHomeLane = false;

  if (!skipped) {
    if (currentPos === -1) {
      if (roll === 6) { nextPos = START_POSITIONS[role.color]; enteredBoard = true; }
    } else if (currentPos >= 0 && currentPos < TRACK_LENGTH) {
      let newPos = currentPos;
      for (let i = 0; i < roll; i++) newPos = (newPos + 1) % TRACK_LENGTH;
      if (hasCompletedLap(currentPos, roll, role.color)) {
        const overshoot = calculateOvershoot(currentPos, roll, role.color);
        const homeLaneIndex = overshoot - 1;
        if (homeLaneIndex >= 0 && homeLaneIndex < 4) {
          nextPos = HOME_LANE_POSITIONS[role.color][homeLaneIndex];
          enteredHomeLane = true;
          if (homeLaneIndex === 3) finished = true;
        } else {
          nextPos = currentPos;
        }
      } else {
        nextPos = newPos;
      }
    } else if (currentPos >= 24) {
      const hlp = HOME_LANE_POSITIONS[role.color];
      const ci = hlp.indexOf(currentPos);
      if (ci !== -1) {
        const ni = ci + roll;
        if (ni <= 3) { nextPos = hlp[ni]; if (ni === 3) finished = true; }
        else nextPos = currentPos;
      }
    }
    if (!enteredBoard && !finished && nextPos >= 0 && nextPos < TRACK_LENGTH) {
      await handleCapture(role.player.id, nextPos);
    }
  }

  try {
    const response = await apiFetch(`/games/${state.activeLobbyId}/moves`, {
      method: 'POST',
      body: JSON.stringify({ //trasformi oggetto js in json
        playerId: role.player.id,
        data: { type: 'turn', roll, color: role.color, pawnIndex, from: currentPos, to: nextPos, enteredBoard, enteredHomeLane, finished, skipped }
      })
    });

    if (allPawnsFinishedAfterMove(role.player.id, pawnIndex, nextPos, skipped)) {
      await apiFetch(`/games/${state.activeLobbyId}`, { method: 'PUT', body: JSON.stringify({ status: 'terminated' }) });
      toast(`🎉 ${role.player.name} ha vinto!`, 'success');
    } else if (skipped) {
      toast(`Dado ${roll} — nessuna pedina muovibile.`, 'secondary');
    } else if (finished) {
      toast(`🎯 Pedina ${pawnIndex + 1} al centro!`, 'success');
    } else if (enteredBoard) {
      toast(`🚀 Pedina ${pawnIndex + 1} entra in pista!`, 'info');
    } else if (response?.move?.id) {
      toast(`Pedina ${pawnIndex + 1} avanzata di ${roll}`, 'info');
    }

    await refreshActiveLobby();
  } catch (error) {
    toast(error.message, 'danger');
    renderAll();
  } finally {
    state.submitting = false;
  }
}

function hasCompletedLap(currentPos, roll, color) {
  const startPos = START_POSITIONS[color];
  const distToStart = (startPos - currentPos + TRACK_LENGTH) % TRACK_LENGTH;
  return distToStart > 0 && roll > distToStart;
}

function calculateOvershoot(currentPos, roll, color) {
  const startPos = START_POSITIONS[color];
  const distToStart = (startPos - currentPos + TRACK_LENGTH) % TRACK_LENGTH;
  return roll - distToStart;
}

async function handleCapture(playerId, position) {
  const pawnPositions = buildPawnPositions();
  for (const other of state.players) {
    if (other.id === playerId) continue;
    const otherPawns = pawnPositions[other.id] || [];
    for (let i = 0; i < otherPawns.length; i++) {
      if (otherPawns[i] === position) {
        toast(`⚔️ Pedina di ${other.name} mangiata!`, 'warning');
        try {
          await apiFetch(`/games/${state.activeLobbyId}/moves`, {
            method: 'POST',
            body: JSON.stringify({
              playerId: other.id,
              data: { type: 'capture', roll: 0, color: playerColorById(other.id), pawnIndex: i, from: position, to: -1, enteredBoard: false, enteredHomeLane: false, finished: false, skipped: false, captured: true }
            })
          });
        } catch (err) { console.error('Errore cattura:', err); }
        break;
      }
    }
  }
}

function getMovablePawnIndexes(pawns, roll, color) {
  const movable = [];
  pawns.forEach((position, index) => {
    if (position < 0) { if (roll === 6) movable.push(index); return; }
    if (position >= 0 && position < TRACK_LENGTH) {
      if (hasCompletedLap(position, roll, color)) {
        const overshoot = calculateOvershoot(position, roll, color);
        if (overshoot >= 1 && overshoot <= 4) movable.push(index);
      } else { movable.push(index); }
      return;
    }
    if (position >= 24 && position < 40) {
      const hlp = HOME_LANE_POSITIONS[color];
      const ci = hlp.indexOf(position);
      if (ci !== -1 && ci + roll <= 3) movable.push(index);
    }
  });
  return movable;
}

// ─── DATA REFRESH ────────────────────────────────────────────

async function refreshAll() {
  if (state.refreshInFlight) return;
  state.refreshInFlight = true;
  try {
    await refreshLobbies();
    if (state.activeLobbyId) await refreshActiveLobby();
    else renderAll();
  } finally { state.refreshInFlight = false; }
}

async function refreshLobbies() {
  try {
    const response = await apiFetch('/games');
    state.lobbies = response.games || [];
    if (state.activeLobbyId && !state.lobbies.some(g => g.id === state.activeLobbyId)) {
      state.activeLobbyId = null; state.activeLobby = null;
      state.players = []; state.moves = []; state.allMoves = [];
      resetPendingSelection(); hidePawnPicker();
    }
  } catch (error) { console.error('refreshLobbies error:', error); }
  renderLobbies();
}

async function openLobby(lobbyId) {
  state.activeLobbyId = lobbyId;
  await refreshActiveLobby();
}

async function refreshActiveLobby(silent = false) {
  if (!state.activeLobbyId) return;
  try {
    const [lobbyRes, playersRes, movesRes] = await Promise.all([
      apiFetch(`/games/${state.activeLobbyId}`),
      apiFetch(`/games/${state.activeLobbyId}/players`),
      apiFetch(`/games/${state.activeLobbyId}/moves`)
    ]);
    const oldLen = state.moves.length;
    state.activeLobby = lobbyRes.game;
    state.players = playersRes.players || [];
    const sorted = sortMovesByTimestamp(movesRes.moves || []);
    state.moves = sorted.filter(m => m?.data?.type === 'turn');
    state.allMoves = sorted.filter(m => m?.data?.type === 'turn' || m?.data?.type === 'capture');
    restoreJoinedPlayerByNickname();
    // Reset pending solo se arrivano nuove mosse dall'esterno e non stiamo inviando noi
    if (state.moves.length > oldLen && !state.submitting) {
      resetPendingSelection();
      hidePawnPicker();
    }
  } catch (error) { if (!silent) console.error('refreshActiveLobby error:', error); }
  renderAll();
}

// ─── RENDER ──────────────────────────────────────────────────

function renderAll() {
  renderLobbies();
  renderHeader();
  renderPlayers();
  renderMoves();
  renderBoard();
}

function renderLobbies() {
  if (!state.lobbies.length) {
    ui.lobbyList.innerHTML = '<div class="muted-box">Nessuna lobby creata.</div>';
    return;
  }
  ui.lobbyList.innerHTML = state.lobbies.map(lobby => {
    const active = lobby.id === state.activeLobbyId ? 'active' : '';
    const seats = Array.isArray(lobby.players) ? lobby.players.length : 0;
    const terminated = lobby.status === 'terminated';
    return `
      <div class="lobby-item ${active}">
        <div class="lobby-item-info">
          <span class="lobby-name">${escapeHtml(lobby.name)}</span>
          <span class="lobby-meta ${terminated ? 'ended' : 'live'}">${terminated ? 'Terminata' : 'Attiva'} · ${seats}/4</span>
        </div>
        <button class="btn-lobby ${active}" type="button" data-lobby-id="${lobby.id}">${active ? '✓' : 'Apri'}</button>
      </div>`;
  }).join('');
  ui.lobbyList.querySelectorAll('[data-lobby-id]').forEach(btn =>
    btn.addEventListener('click', () => openLobby(btn.dataset.lobbyId)));
}

function renderHeader() {
  if (!state.activeLobby) {
    ui.activeLobbyTitle.textContent = 'Seleziona una lobby';
    ui.lobbyStatus.textContent = 'Crea o apri una partita per iniziare.';
    ui.turnBadge.textContent = 'In attesa';
    ui.turnBadge.className = 'turn-badge neutral';
    ui.rollDiceBtn.disabled = true;
    ui.winnerText.textContent = 'Il primo che raggiunge il centro vince.';
    ui.diceValue.textContent = '–';
    ui.deleteGameBtn.style.display = 'none';
    return;
  }
  ui.deleteGameBtn.style.display = '';
  ui.activeLobbyTitle.textContent = state.activeLobby.name;
  const role = currentRole();
  const turnPlayer = currentTurnPlayer();
  const winner = winnerPlayer();

  if (winner) {
    ui.lobbyStatus.textContent = `Partita conclusa — Ha vinto ${winner.name}!`;
    ui.turnBadge.textContent = '🏆 Fine';
    ui.turnBadge.className = 'turn-badge neutral';
    ui.winnerText.textContent = `${winner.name} ha vinto!`;
  } else if (state.players.length < 2) {
    ui.lobbyStatus.textContent = 'In attesa di almeno 2 giocatori.';
    ui.turnBadge.textContent = 'Attesa';
    ui.turnBadge.className = 'turn-badge neutral';
  } else if (turnPlayer) {
    const color = playerColorById(turnPlayer.id);
    ui.turnBadge.textContent = `🎲 ${turnPlayer.name}`;
    ui.turnBadge.className = `turn-badge ${color}`;
    const isMyTurn = role.kind === 'player' && turnPlayer.id === role.player.id;
    if (state.pendingRoll !== null && isMyTurn) {
      ui.lobbyStatus.textContent = `Hai tirato ${state.pendingRoll} — scegli la pedina dal pannello.`;
    } else {
      ui.lobbyStatus.textContent = isMyTurn ? 'È il tuo turno — lancia il dado!' : `Turno di ${turnPlayer.name}.`;
    }
  }
  ui.rollDiceBtn.disabled = !canCurrentUserPlay();
}

function renderPlayers() {
  ui.playerCount.textContent = `${state.players.length}/4`;
  if (!state.players.length) {
    ui.playerList.innerHTML = '<div class="muted-box">Nessun giocatore.</div>';
    return;
  }
  const pos = buildPawnPositions();
  const winner = winnerPlayer();
  const role = currentRole();
  ui.playerList.innerHTML = state.players.map((player, index) => {
    const color = PLAYER_COLORS[index] || 'green';
    const isMe = role.kind === 'player' && role.player.id === player.id;
    const pawns = pos[player.id] || Array(PAWNS_PER_PLAYER).fill(-1);
    const inBase = pawns.filter(p => p < 0).length;
    const inCenter = pawns.filter(p => p >= 39).length;
    const onTrack = pawns.filter(p => p >= 0 && p < 24).length;
    const inHome = pawns.filter(p => p >= 24 && p < 39).length;
    const badge = winner?.id === player.id ? '<span class="p-badge gold">🏆</span>'
      : isMe ? '<span class="p-badge me">Tu</span>' : '';
    return `
      <div class="player-item color-${color}">
        <div class="player-dot color-${color}"></div>
        <div class="player-info">
          <span class="player-name">${escapeHtml(player.name)} ${badge}</span>
          <span class="player-stats">Base ${inBase} · Pista ${onTrack} · Home ${inHome} · Centro ${inCenter}</span>
        </div>
        <button class="btn-danger-sm delete-player-btn" data-player-id="${player.id}" data-player-name="${escapeHtml(player.name)}">✕</button>
      </div>`;
  }).join('');
}

function renderMoves() {
  if (!state.moves.length) {
    ui.moveList.innerHTML = '<li class="move-empty">Nessuna mossa ancora.</li>';
    return;
  }
  ui.moveList.innerHTML = state.moves.slice(-12).reverse().map(move => {
    const player = state.players.find(p => p.id === move.playerId);
    const d = move.data || {};
    const name = player ? player.name : '?';
    const color = player ? playerColorById(player.id) : 'green';
    const pL = `P${Number(d.pawnIndex) + 1}`;
    const from = d.from >= 0 ? d.from + 1 : 'B';
    const to = d.to >= 0 ? d.to + 1 : 'B';
    const action = d.skipped ? `dado ${d.roll}, nessuna mossa`
      : d.finished ? `🎯 ${pL} al centro (${d.roll})`
      : d.enteredBoard ? `🚀 ${pL} entra in pista`
      : d.enteredHomeLane ? `🏠 ${pL} in home lane (${d.roll})`
      : d.from === d.to ? `${pL} resta ferma (${d.roll})`
      : `${pL}: ${from}→${to} (${d.roll})`;
    return `<li class="move-item"><span class="move-dot color-${color}"></span><strong>${escapeHtml(name)}</strong> ${action}</li>`;
  }).join('');
}

function renderBoard() {
  const pawnPositions = buildPawnPositions();
  const piecesByCell = new Map();
  const homeLanePieces = new Map();
  const basePieces = new Map();
  const centerPieces = [];
  const finishedPlayers = [];
  const movedIds = new Set();
  const currentTurn = currentTurnPlayer();

  if (state.previousPositions) {
    for (const player of state.players) {
      const prev = state.previousPositions[player.id] || [];
      const curr = pawnPositions[player.id] || [];
      for (let i = 0; i < PAWNS_PER_PLAYER; i++) {
        if (prev[i] !== curr[i]) movedIds.add(`${player.id}:${i}`);
      }
    }
  }

  state.players.forEach((player, index) => {
    const color = PLAYER_COLORS[index] || 'green';
    const pawns = pawnPositions[player.id] || Array(PAWNS_PER_PLAYER).fill(-1);
    if (pawns.every(p => p >= 39)) finishedPlayers.push(player.name);
    pawns.forEach((position, pawnIndex) => {
      const key = `${player.id}:${pawnIndex}`;
      const isMovable = currentTurn?.id === player.id && state.movablePawnIndexes.includes(pawnIndex) && state.pendingRoll !== null;
      const isSelected = state.selectedPawnIndex === pawnIndex && currentTurn?.id === player.id && state.pendingRoll !== null;
      const markup = buildPieceMarkup(player.id, pawnIndex, color, movedIds.has(key), currentTurn?.id === player.id, isMovable, isSelected);
      if (position >= 39) { centerPieces.push(markup); return; }
      if (position >= 24) { const a = homeLanePieces.get(position) || []; a.push(markup); homeLanePieces.set(position, a); }
      else if (position >= 0) { const a = piecesByCell.get(position) || []; a.push(markup); piecesByCell.set(position, a); }
      else { const a = basePieces.get(color) || []; a.push(markup); basePieces.set(color, a); }
    });
  });

  const trackMap = new Map(TRACK_COORDS.map((c, i) => [c.join(','), i]));
  const homeLaneMap = new Map();
  Object.entries(HOME_LANES).forEach(([color, cells]) => {
    cells.forEach((coords, index) => {
      if (index < 3) homeLaneMap.set(coords.join(','), { color, position: HOME_LANE_POSITIONS[color][index] });
    });
  });

  const baseZones = [
    { cells: [[0,0],[0,1],[1,0],[1,1]], color: 'green' },
    { cells: [[0,5],[0,6],[1,5],[1,6]], color: 'red' },
    { cells: [[5,0],[5,1],[6,0],[6,1]], color: 'yellow' },
    { cells: [[5,5],[5,6],[6,5],[6,6]], color: 'blue' },
  ];

  ui.board.innerHTML = Array.from({ length: 49 }, (_, li) => {
    const row = Math.floor(li / 7), col = li % 7;
    const key = `${row},${col}`;
    if (row === 3 && col === 3) {
      return `<div class="board-cell center-cell"><div class="piece-stack">${centerPieces.join('')}</div></div>`;
    }
    if (trackMap.has(key)) {
      const trackIndex = trackMap.get(key);
      const color = PLAYER_COLORS[Math.floor(trackIndex / 6)] || 'green';
      const pieces = piecesByCell.get(trackIndex) || [];
      const isCurrent = currentTurn && (pawnPositions[currentTurn.id] || []).includes(trackIndex);
      return `<div class="board-cell path color-${color}${isCurrent ? ' current' : ''}"><span class="cell-idx">${trackIndex + 1}</span><div class="piece-stack">${pieces.join('')}</div></div>`;
    }
    if (homeLaneMap.has(key)) {
      const lane = homeLaneMap.get(key);
      const pieces = homeLanePieces.get(lane.position) || [];
      return `<div class="board-cell home-lane color-${lane.color}"><div class="piece-stack">${pieces.join('')}</div></div>`;
    }
    for (const { cells, color } of baseZones) {
      if (cells.some(([r, c]) => r === row && c === col)) {
        const pieces = basePieces.get(color) || [];
        return `<div class="board-cell base-cell color-${color}"><div class="piece-stack base-grid">${pieces.join('')}</div></div>`;
      }
    }
    return '<div class="board-cell empty"></div>';
  }).join('');

  if (finishedPlayers.length > 0) ui.winnerText.textContent = `Al centro: ${finishedPlayers.join(', ')}.`;
  state.previousPositions = pawnPositions;
}

// ─── UTILITIES ───────────────────────────────────────────────

function buildPieceMarkup(playerId, pawnIndex, color, moved, isTurn, canPlay, selected) {
  const cls = ['piece', `color-${color}`, moved && 'moved', isTurn && 'turn', canPlay && 'can-play', selected && 'selected'].filter(Boolean).join(' ');
  return `<span class="${cls}" data-player-id="${playerId}" data-piece-index="${pawnIndex}" title="Pedina ${pawnIndex + 1}"></span>`;
}

function currentTurnPlayer() {
  if (state.players.length < 2 || !state.activeLobby || state.activeLobby.status === 'terminated') return null;
  return state.players[state.moves.length % state.players.length] || null;
}

function winnerPlayer() {
  const pos = buildPawnPositions();
  return state.players.find(p => (pos[p.id] || []).every(v => v >= 39)) || null;
}

function buildPawnPositions() {
  const positions = {};
  state.players.forEach(p => { positions[p.id] = Array(PAWNS_PER_PLAYER).fill(-1); });
  for (const move of state.allMoves) {
    const pi = Number(move?.data?.pawnIndex);
    if (!Number.isInteger(pi) || pi < 0 || pi >= PAWNS_PER_PLAYER) continue;
    if (typeof move?.data?.to === 'number') positions[move.playerId][pi] = move.data.to;
  }
  return positions;
}

function currentRole() {
  if (!state.activeLobbyId) return { kind: 'visitor' };
  const joined = state.joinedPlayersByLobby[state.activeLobbyId];
  if (!joined) return { kind: 'visitor' };
  const player = state.players.find(p => p.id === joined.playerId);
  if (!player) return { kind: 'visitor' };
  return { kind: 'player', player, color: playerColorById(player.id) };
}

function canCurrentUserPlay() {
  const role = currentRole();
  const turn = currentTurnPlayer();
  return role.kind === 'player' && !!turn && turn.id === role.player.id
    && state.activeLobby?.status !== 'terminated'
    && state.pendingRoll === null && !state.submitting;
}

function playerColorById(playerId) {
  const i = state.players.findIndex(p => p.id === playerId);
  return PLAYER_COLORS[i] || 'green';
}

function resetPendingSelection() {
  state.pendingRoll = null;
  state.movablePawnIndexes = [];
  state.selectedPawnIndex = null;
}

function allPawnsFinishedAfterMove(playerId, pawnIndex, nextPos, skipped) {
  const pos = buildPawnPositions();
  const pawns = [...(pos[playerId] || Array(PAWNS_PER_PLAYER).fill(-1))];
  if (!skipped) pawns[pawnIndex] = nextPos;
  return pawns.every(p => p >= 39);
}

function setJoinedPlayer(lobbyId, playerId, nickname) {
  state.joinedPlayersByLobby[lobbyId] = { playerId, nickname };
  const data = JSON.stringify(state.joinedPlayersByLobby);
  try { localStorage.setItem('ludoJoinedPlayers', data); } catch {}
  try { sessionStorage.setItem('ludoJoinedPlayers', data); } catch {}
}

function restoreJoinedPlayerByNickname() {
  const joined = state.joinedPlayersByLobby[state.activeLobbyId];
  if (!joined) return;
  if (state.players.some(p => p.id === joined.playerId)) return;
  const match = state.players.find(p => p.name.trim().toLowerCase() === joined.nickname.trim().toLowerCase());
  if (match) setJoinedPlayer(state.activeLobbyId, match.id, match.name);
}

function loadJoinedPlayers() {
  try {
    const raw = localStorage.getItem('ludoJoinedPlayers') ?? sessionStorage.getItem('ludoJoinedPlayers');
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

async function apiFetch(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', 'X-API-Key': API_KEY, ...(options.headers || {}) }
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(data?.error || `HTTP ${response.status}`);
  return data;
}

function sortMovesByTimestamp(moves) {
  return [...moves].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
}

function escapeHtml(v) {
  return String(v).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
}

function toast(message, type = 'primary') {
  const item = document.createElement('div');
  item.className = `toast align-items-center text-bg-${type} border-0`;
  item.role = 'status'; item.ariaLive = 'polite'; item.ariaAtomic = 'true';
  item.innerHTML = `<div class="d-flex"><div class="toast-body">${escapeHtml(message)}</div><button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button></div>`;
  ui.toastWrap.appendChild(item);
  const t = new bootstrap.Toast(item, { delay: 2500 });
  item.addEventListener('hidden.bs.toast', () => item.remove());
  t.show();
}

const diceObserver = new MutationObserver(() => {
  ui.diceValue.classList.remove('rolled');
  void ui.diceValue.offsetWidth;
  ui.diceValue.classList.add('rolled');
});
diceObserver.observe(ui.diceValue, { childList: true });

async function eliminaGioco(gameId) { return apiFetch(`/games/${gameId}`, { method: 'DELETE' }); }
async function eliminaUtenteDallaPartita(gameId, playerId) { return apiFetch(`/games/${gameId}/players/${playerId}`, { method: 'DELETE' }); 
}