const API_KEY = '6a19c3d4-5aa0-41c8-98b9-24bf6d45bf88f8bb67b5d85f42c2b92b5553120f3e11';
const API_BASE = window.location.origin;
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
const HOME_LANES = {
  green: [[3, 1], [3, 2]],
  red: [[1, 3], [2, 3]],
  yellow: [[5, 3], [4, 3]],
  blue: [[3, 5], [3, 4]]
};

const state = {
  lobbies: [],
  activeLobbyId: null,
  activeLobby: null,
  players: [],
  moves: [],
  joinedPlayersByLobby: loadJoinedPlayers(),
  previousPositions: null,
  pendingRoll: null,
  movablePawnIndexes: [],
  selectedPawnIndex: null,
  refreshInFlight: false
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
  toastWrap: document.getElementById('toastWrap')
};

bootstrapApp();

function bootstrapApp() {
  bindEvents();
  renderBoard();
  refreshAll();
}

function bindEvents() {
  ui.createLobbyForm.addEventListener('submit', onCreateLobby);
  ui.refreshLobbiesBtn.addEventListener('click', refreshAll);
  ui.joinForm.addEventListener('submit', onJoinLobby);
  ui.rollDiceBtn.addEventListener('click', onRollDice);
  ui.board.addEventListener('click', onBoardClick);
  document.addEventListener('visibilitychange', onVisibilityChange);
  window.addEventListener('focus', onWindowFocus);
}

async function onCreateLobby(event) {
  event.preventDefault();
  const name = ui.lobbyName.value.trim();
  if (!name) return;

  try {
    const result = await apiFetch('/games', {
      method: 'POST',
      body: JSON.stringify({ name })
    });
    ui.lobbyName.value = '';
    toast('Partita creata', 'success');
    await refreshLobbies();
    if (result?.game?.id) {
      await openLobby(result.game.id);
    }
  } catch (error) {
    toast(error.message, 'danger');
  }
}

async function onJoinLobby(event) {
  event.preventDefault();

  if (!state.activeLobbyId) {
    toast('Seleziona prima una lobby', 'warning');
    return;
  }

  const nickname = ui.nickname.value.trim();
  if (!nickname) {
    toast('Inserisci un nickname', 'warning');
    return;
  }

  const normalized = nickname.toLowerCase();
  const existing = state.players.find(player => player.name.trim().toLowerCase() === normalized);
  if (existing) {
    setJoinedPlayer(state.activeLobbyId, existing.id, existing.name);
    ui.nickname.value = '';
    toast('Riconnesso al giocatore esistente', 'success');
    renderAll();
    return;
  }

  try {
    if (state.players.length >= MAX_PLAYERS) {
      toast('La lobby e piena', 'warning');
      return;
    }

    const result = await apiFetch(`/games/${state.activeLobbyId}/players`, {
      method: 'POST',
      body: JSON.stringify({ name: nickname })
    });

    setJoinedPlayer(state.activeLobbyId, result.player.id, result.player.name);
    ui.nickname.value = '';
    toast('Ingresso effettuato', 'success');
    await refreshActiveLobby();
  } catch (error) {
    toast(error.message, 'danger');
  }
}

async function onRollDice() {
  const role = currentRole();
  if (role.kind !== 'player') {
    toast('Devi entrare come giocatore', 'warning');
    return;
  }

  if (!state.activeLobby || state.activeLobby.status === 'terminated') {
    toast('La partita e terminata', 'warning');
    return;
  }

  if (state.players.length < 2) {
    toast('Servono almeno 2 giocatori', 'warning');
    return;
  }

  const turn = currentTurnPlayer();
  if (!turn || turn.id !== role.player.id) {
    toast('Non e il tuo turno', 'warning');
    return;
  }

  if (state.pendingRoll !== null) {
    toast('Scegli prima quale pedina muovere', 'info');
    return;
  }

  const roll = 1 + Math.floor(Math.random() * 6);
  const pawnPositions = buildPawnPositions();
  const myPawns = pawnPositions[role.player.id] || Array(PAWNS_PER_PLAYER).fill(-1);
  const movable = getMovablePawnIndexes(myPawns, roll);

  ui.diceValue.textContent = String(roll);

  if (!movable.length) {
    await submitPawnMove(role, roll, 0, true);
    return;
  }

  if (movable.length === 1) {
    await submitPawnMove(role, roll, movable[0], false);
    return;
  }

  state.pendingRoll = roll;
  state.movablePawnIndexes = movable;
  state.selectedPawnIndex = movable[0];
  renderAll();
  toast(`Hai tirato ${roll}. Scegli una pedina.`, 'info');
}

async function onBoardClick(event) {
  const piece = event.target.closest('[data-piece-index]');
  if (!piece) return;

  const role = currentRole();
  if (role.kind !== 'player' || state.pendingRoll === null) return;

  const ownerId = piece.dataset.playerId;
  const pawnIndex = Number(piece.dataset.pieceIndex);
  if (ownerId !== role.player.id) return;
  if (!state.movablePawnIndexes.includes(pawnIndex)) return;

  state.selectedPawnIndex = pawnIndex;
  renderAll();
  await submitPawnMove(role, state.pendingRoll, pawnIndex, false);
}

async function submitPawnMove(role, roll, pawnIndex, skipped) {
  const pawnPositions = buildPawnPositions();
  const pawns = pawnPositions[role.player.id] || Array(PAWNS_PER_PLAYER).fill(-1);
  const currentPos = pawns[pawnIndex] ?? -1;
  let nextPos = currentPos;
  let finished = false;
  let enteredBoard = false;

  if (!skipped) {
    if (currentPos === -1) {
      if (roll === 6) {
        nextPos = 0;
        enteredBoard = true;
      }
    } else {
      nextPos = currentPos + roll;
      if (nextPos > TRACK_LENGTH) {
        nextPos = currentPos;
      } else if (nextPos === TRACK_LENGTH) {
        finished = true;
      }
    }
  }

  try {
    const response = await apiFetch(`/games/${state.activeLobbyId}/moves`, {
      method: 'POST',
      body: JSON.stringify({
        playerId: role.player.id,
        data: {
          type: 'turn',
          roll,
          color: role.color,
          pawnIndex,
          from: currentPos,
          to: nextPos,
          enteredBoard,
          finished,
          skipped
        }
      })
    });

    resetPendingSelection();

    if (allPawnsFinishedAfterMove(role.player.id, pawnIndex, nextPos, skipped)) {
      await apiFetch(`/games/${state.activeLobbyId}`, {
        method: 'PUT',
        body: JSON.stringify({ status: 'terminated' })
      });
      toast(`Vince ${role.player.name}!`, 'success');
    } else if (skipped) {
      toast(`Hai tirato ${roll}, nessuna pedina muovibile`, 'secondary');
    } else if (response?.move?.id) {
      toast(`Hai mosso la pedina ${pawnIndex + 1}`, 'info');
    }

    await refreshActiveLobby();
  } catch (error) {
    resetPendingSelection();
    renderAll();
    toast(error.message, 'danger');
  }
}

async function refreshAll() {
  if (state.refreshInFlight) return;
  state.refreshInFlight = true;

  try {
    await refreshLobbies();
    if (state.activeLobbyId) {
      await refreshActiveLobby();
    } else {
      renderAll();
    }
  } finally {
    state.refreshInFlight = false;
  }
}

async function refreshLobbies() {
  try {
    const response = await apiFetch('/games');
    state.lobbies = response.games || [];

    if (state.activeLobbyId && !state.lobbies.some(game => game.id === state.activeLobbyId)) {
      state.activeLobbyId = null;
    state.activeLobby = null;
    state.players = [];
    state.moves = [];
    resetPendingSelection();
  }
  } catch (error) {
    toast(error.message, 'danger');
  }

  renderLobbies();
}

async function openLobby(lobbyId) {
  state.activeLobbyId = lobbyId;
  await refreshActiveLobby();
}

async function refreshActiveLobby() {
  if (!state.activeLobbyId) return;

  try {
    const [lobbyRes, playersRes, movesRes] = await Promise.all([
      apiFetch(`/games/${state.activeLobbyId}`),
      apiFetch(`/games/${state.activeLobbyId}/players`),
      apiFetch(`/games/${state.activeLobbyId}/moves`)
    ]);

    state.activeLobby = lobbyRes.game;
    state.players = playersRes.players || [];
    state.moves = sortMovesByTimestamp(movesRes.moves || []).filter(move => move?.data?.type === 'turn');
    restoreJoinedPlayerByNickname();
  } catch (error) {
    toast(error.message, 'danger');
  }

  renderAll();
}

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
    const activeClass = lobby.id === state.activeLobbyId ? 'active' : '';
    const seats = Array.isArray(lobby.players) ? lobby.players.length : 0;
    return `
      <div class="lobby-item ${activeClass}">
        <div class="d-flex justify-content-between align-items-start gap-2 mb-2">
          <div>
            <div class="fw-bold">${escapeHtml(lobby.name)}</div>
            <div class="small text-secondary">${lobby.status === 'terminated' ? 'Terminata' : 'Attiva'}</div>
          </div>
          <span class="badge text-bg-light">${seats}/4</span>
        </div>
        <button class="btn btn-outline-primary btn-sm" type="button" data-lobby-id="${lobby.id}">Apri</button>
      </div>
    `;
  }).join('');

  ui.lobbyList.querySelectorAll('[data-lobby-id]').forEach(button => {
    button.addEventListener('click', () => openLobby(button.dataset.lobbyId));
  });
}

function renderHeader() {
  if (!state.activeLobby) {
    ui.activeLobbyTitle.textContent = 'Seleziona una lobby';
    ui.lobbyStatus.textContent = 'Crea o apri una partita per iniziare.';
    ui.turnBadge.textContent = 'In attesa';
    ui.turnBadge.className = 'turn-badge neutral';
    ui.rollDiceBtn.disabled = true;
    ui.winnerText.textContent = 'Il primo che raggiunge il centro vince.';
    ui.diceValue.textContent = '-';
    return;
  }

  ui.activeLobbyTitle.textContent = state.activeLobby.name;
  const role = currentRole();
  const turnPlayer = currentTurnPlayer();
  const winner = winnerPlayer();

  if (winner) {
    ui.lobbyStatus.textContent = `Partita conclusa. Ha vinto ${winner.name}.`;
    ui.turnBadge.textContent = 'Partita finita';
    ui.turnBadge.className = 'turn-badge neutral';
    ui.winnerText.textContent = `${winner.name} ha raggiunto il centro.`;
  } else if (state.players.length < 2) {
    ui.lobbyStatus.textContent = 'In attesa di almeno 2 giocatori.';
    ui.turnBadge.textContent = 'Attesa giocatori';
    ui.turnBadge.className = 'turn-badge neutral';
    ui.winnerText.textContent = 'Il primo che raggiunge il centro vince.';
  } else if (turnPlayer) {
    const color = playerColorById(turnPlayer.id);
    ui.lobbyStatus.textContent = `Turno di ${turnPlayer.name}. Lancia il dado e avanza.`;
    ui.turnBadge.textContent = `Turno: ${turnPlayer.name}`;
    ui.turnBadge.className = `turn-badge ${color}`;
    ui.winnerText.textContent = role.kind === 'player'
      ? state.pendingRoll !== null
        ? `Hai tirato ${state.pendingRoll}: scegli una delle tue 4 pedine.`
        : `Tu giochi con il colore ${role.color}.`
      : 'Osserva l\'andamento della partita in tempo reale.';
  }

  ui.rollDiceBtn.disabled = !canCurrentUserPlay();
}

function renderPlayers() {
  ui.playerCount.textContent = `${state.players.length}/4`;

  if (!state.players.length) {
    ui.playerList.innerHTML = '<div class="muted-box">Ancora nessun giocatore.</div>';
    return;
  }

  const pawnPositions = buildPawnPositions();
  const winner = winnerPlayer();
  ui.playerList.innerHTML = state.players.map((player, index) => {
    const color = PLAYER_COLORS[index] || 'green';
    const role = currentRole();
    const joined = role.kind === 'player' && role.player.id === player.id;
    const pawns = pawnPositions[player.id] || Array(PAWNS_PER_PLAYER).fill(-1);
    const inBase = pawns.filter(pos => pos < 0).length;
    const inCenter = pawns.filter(pos => pos >= TRACK_LENGTH).length;
    const onTrack = pawns.filter(pos => pos >= 0 && pos < TRACK_LENGTH).length;
    const label = `Base ${inBase} · Pista ${onTrack} · Centro ${inCenter}`;
    const badge = winner?.id === player.id
      ? '<span class="badge text-bg-success">Vincitore</span>'
      : joined
        ? '<span class="badge text-bg-primary">Tu</span>'
        : `<span class="badge text-bg-light">${color}</span>`;

    return `
      <div class="player-item">
        <div class="player-meta">
          <span class="player-chip ${color}"></span>
          <div>
            <div class="fw-semibold">${escapeHtml(player.name)}</div>
            <div class="small text-secondary">${label}</div>
          </div>
        </div>
        ${badge}
      </div>
    `;
  }).join('');
}

function renderMoves() {
  if (!state.moves.length) {
    ui.moveList.innerHTML = '<li class="text-secondary">Nessuna mossa registrata.</li>';
    return;
  }

  ui.moveList.innerHTML = state.moves.map(move => {
    const player = state.players.find(item => item.id === move.playerId);
    const data = move.data || {};
    const name = player ? player.name : 'Giocatore';
    const pawnLabel = `pedina ${Number(data.pawnIndex) + 1}`;
    const action = data.skipped
      ? `ha tirato ${data.roll} ma non poteva muovere nessuna pedina`
      : data.finished
        ? `ha tirato ${data.roll} e ha portato la ${pawnLabel} al centro`
        : data.enteredBoard
          ? `ha tirato 6 e ha fatto entrare in pista la ${pawnLabel}`
          : data.from === data.to
            ? `ha tirato ${data.roll} ma la ${pawnLabel} resta ferma`
            : `ha tirato ${data.roll} e ha spostato la ${pawnLabel} alla casella ${Number(data.to) + 1}`;

    return `<li><strong>${escapeHtml(name)}</strong> ${action}</li>`;
  }).join('');
}

function renderBoard() {
  const pawnPositions = buildPawnPositions();
  const piecesByCell = new Map();
  const basePieces = new Map();
  const centerPieces = [];
  const finishedPlayers = [];
  const movedIds = new Set();
  const currentTurn = currentTurnPlayer();

  if (state.previousPositions) {
    for (const player of state.players) {
      const previous = state.previousPositions[player.id] || [];
      const current = pawnPositions[player.id] || [];
      for (let index = 0; index < PAWNS_PER_PLAYER; index += 1) {
        if (previous[index] !== current[index]) {
          movedIds.add(`${player.id}:${index}`);
        }
      }
    }
  }

  state.players.forEach((player, index) => {
    const color = PLAYER_COLORS[index] || 'green';
    const pawns = pawnPositions[player.id] || Array(PAWNS_PER_PLAYER).fill(-1);
    if (pawns.every(position => position >= TRACK_LENGTH)) {
      finishedPlayers.push(player.name);
    }

    pawns.forEach((position, pawnIndex) => {
      const key = `${player.id}:${pawnIndex}`;
      const isMovable = currentTurn?.id === player.id && state.movablePawnIndexes.includes(pawnIndex) && state.pendingRoll !== null;
      const isSelected = currentTurn?.id === player.id && state.selectedPawnIndex === pawnIndex && state.pendingRoll !== null;
      const pieceMarkup = buildPieceMarkup(player.id, pawnIndex, color, movedIds.has(key), currentTurn?.id === player.id, isMovable, isSelected);

      if (position >= TRACK_LENGTH) {
        centerPieces.push(pieceMarkup);
        return;
      }

      if (position >= 0) {
        const existing = piecesByCell.get(position) || [];
        existing.push(pieceMarkup);
        piecesByCell.set(position, existing);
      } else {
        const existing = basePieces.get(color) || [];
        existing.push(pieceMarkup);
        basePieces.set(color, existing);
      }
    });
  });

  const trackMap = new Map(TRACK_COORDS.map((coords, index) => [coords.join(','), index]));
  const laneMap = new Map();
  Object.entries(HOME_LANES).forEach(([color, cells]) => {
    cells.forEach((coords, index) => laneMap.set(coords.join(','), { color, index }));
  });

  ui.board.innerHTML = Array.from({ length: 49 }, (_, linearIndex) => {
    const row = Math.floor(linearIndex / 7);
    const col = linearIndex % 7;
    const key = `${row},${col}`;

    if (row === 3 && col === 3) {
      return `<div class="board-cell center-cell"><div class="piece-stack">${centerPieces.join('')}</div></div>`;
    }

    if (trackMap.has(key)) {
      const trackIndex = trackMap.get(key);
      const color = PLAYER_COLORS[Math.floor(trackIndex / 6)] || 'green';
      const pieces = piecesByCell.get(trackIndex) || [];
      const isCurrent = currentTurn && (pawnPositions[currentTurn.id] || []).includes(trackIndex);

      return `
        <div class="board-cell path ${color} ${isCurrent ? 'current' : ''}">
          <span class="cell-index">${trackIndex + 1}</span>
          <div class="piece-stack">
            ${pieces.join('')}
          </div>
        </div>
      `;
    }

    if (laneMap.has(key)) {
      const lane = laneMap.get(key);
      const pieces = basePieces.get(lane.color) || [];
      return `
        <div class="board-cell home-lane ${lane.color}">
          <div class="piece-stack">
            ${lane.index === 0 ? `<div class="piece-stack base-grid">${pieces.join('')}</div>` : ''}
          </div>
        </div>
      `;
    }

    return '<div class="board-cell empty"></div>';
  }).join('');

  if (finishedPlayers.length > 0) {
    ui.winnerText.textContent = `Al centro: ${finishedPlayers.join(', ')}.`;
  }

  state.previousPositions = pawnPositions;
}

function currentTurnPlayer() {
  if (state.players.length < 2 || !state.activeLobby || state.activeLobby.status === 'terminated') {
    return null;
  }
  const index = state.moves.length % state.players.length;
  return state.players[index] || null;
}

function winnerPlayer() {
  const pawnPositions = buildPawnPositions();
  return state.players.find(player => (pawnPositions[player.id] || []).every(position => position >= TRACK_LENGTH)) || null;
}

function buildPawnPositions() {
  const positions = {};
  state.players.forEach(player => {
    positions[player.id] = Array(PAWNS_PER_PLAYER).fill(-1);
  });

  for (const move of state.moves) {
    const pawnIndex = Number(move?.data?.pawnIndex);
    if (!Number.isInteger(pawnIndex) || pawnIndex < 0 || pawnIndex >= PAWNS_PER_PLAYER) continue;
    if (typeof move?.data?.to === 'number') {
      positions[move.playerId][pawnIndex] = move.data.to;
    }
  }

  return positions;
}

function currentRole() {
  if (!state.activeLobbyId) return { kind: 'visitor' };
  const joined = state.joinedPlayersByLobby[state.activeLobbyId];
  if (!joined) return { kind: 'visitor' };

  const player = state.players.find(item => item.id === joined.playerId);
  if (!player) return { kind: 'visitor' };

  const color = playerColorById(player.id);
  return { kind: 'player', player, color };
}

function canCurrentUserPlay() {
  const role = currentRole();
  const turnPlayer = currentTurnPlayer();
  return role.kind === 'player' &&
    !!turnPlayer &&
    turnPlayer.id === role.player.id &&
    state.activeLobby &&
    state.activeLobby.status !== 'terminated' &&
    state.pendingRoll === null;
}

function playerColorById(playerId) {
  const index = state.players.findIndex(player => player.id === playerId);
  return PLAYER_COLORS[index] || 'green';
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

  const exists = state.players.some(player => player.id === joined.playerId);
  if (exists) return;

  const normalized = joined.nickname.trim().toLowerCase();
  const match = state.players.find(player => player.name.trim().toLowerCase() === normalized);
  if (match) {
    setJoinedPlayer(state.activeLobbyId, match.id, match.name);
  }
}

function loadJoinedPlayers() {
  try {
    const raw = localStorage.getItem('ludoJoinedPlayers') 
              ?? sessionStorage.getItem('ludoJoinedPlayers');
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

async function apiFetch(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': API_KEY,
      ...(options.headers || {})
    }
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : null;

  if (!response.ok) {
    throw new Error(data?.error || `HTTP ${response.status}`);
  }

  return data;
}

function sortMovesByTimestamp(moves) {
  return [...moves].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function buildPieceMarkup(playerId, pawnIndex, color, moved, current, canPlay, selected) {
  return `<span class="piece ${color} ${moved ? 'moved' : ''} ${current ? 'current-turn' : ''} ${canPlay ? 'can-play selectable' : ''} ${selected ? 'selected' : ''}" data-player-id="${playerId}" data-piece-index="${pawnIndex}" title="Pedina ${pawnIndex + 1}"></span>`;
}

function getMovablePawnIndexes(pawns, roll) {
  const movable = [];
  pawns.forEach((position, index) => {
    if (position < 0 && roll === 6) {
      movable.push(index);
      return;
    }

    if (position >= 0 && position < TRACK_LENGTH && position + roll <= TRACK_LENGTH) {
      movable.push(index);
    }
  });
  return movable;
}

function resetPendingSelection() {
  state.pendingRoll = null;
  state.movablePawnIndexes = [];
  state.selectedPawnIndex = null;
}

function onVisibilityChange() {
  if (!document.hidden) {
    refreshAll();
  }
}

function onWindowFocus() {
  refreshAll();
}

function allPawnsFinishedAfterMove(playerId, pawnIndex, nextPos, skipped) {
  const pawnPositions = buildPawnPositions();
  const myPawns = [...(pawnPositions[playerId] || Array(PAWNS_PER_PLAYER).fill(-1))];
  if (!skipped) {
    myPawns[pawnIndex] = nextPos;
  }
  return myPawns.every(position => position >= TRACK_LENGTH);
}

function toast(message, type = 'primary') {
  const item = document.createElement('div');
  item.className = `toast align-items-center text-bg-${type} border-0`;
  item.role = 'status';
  item.ariaLive = 'polite';
  item.ariaAtomic = 'true';
  item.innerHTML = `
    <div class="d-flex">
      <div class="toast-body">${escapeHtml(message)}</div>
      <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast" aria-label="Chiudi"></button>
    </div>
  `;
  ui.toastWrap.appendChild(item);
  const toastInstance = new bootstrap.Toast(item, { delay: 2200 });
  item.addEventListener('hidden.bs.toast', () => item.remove());
  toastInstance.show();
}

const diceObserver = new MutationObserver(() => {
  ui.diceValue.classList.remove('rolled');
  void ui.diceValue.offsetWidth;
  ui.diceValue.classList.add('rolled');
});

diceObserver.observe(ui.diceValue, { childList: true });
