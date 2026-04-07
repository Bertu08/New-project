const API_KEY = 'b86316fd-127b-4442-9a29-7ba303b2973a8aea482b559f4766acdb63b2843ae7a5';
const API_BASE = window.location.origin;
const POLL_MS = 2500;

const WIN_LINES = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6]
];

const state = {
  lobbies: [],
  activeLobbyId: null,
  activeLobby: null,
  players: [],
  rawMoves: [],
  moves: [],
  board: Array(9).fill(null),
  finalBoard: Array(9).fill(null),
  winLine: [],
  replayIndex: null,
  pendingMoveSubmission: false,
  terminatingGame: false,
  chatMessages: [],
  chatFilter: 'all',
  unreadPrivateCount: 0,
  joinedPlayersByLobby: loadJoinedPlayers(),
  chatReadByLobby: loadChatReadByLobby(),
  pollHandle: null
};

const ui = {
  createLobbyForm: document.getElementById('createLobbyForm'),
  lobbyName: document.getElementById('lobbyName'),
  refreshLobbiesBtn: document.getElementById('refreshLobbiesBtn'),
  lobbyList: document.getElementById('lobbyList'),
  activeLobbyTitle: document.getElementById('activeLobbyTitle'),
  statusBadgeWrap: document.getElementById('statusBadgeWrap'),
  joinForm: document.getElementById('joinForm'),
  nickname: document.getElementById('nickname'),
  joinBtn: document.getElementById('joinBtn'),
  turnInfo: document.getElementById('turnInfo'),
  board: document.getElementById('board'),
  playerList: document.getElementById('playerList'),
  moveList: document.getElementById('moveList'),
  prevMoveBtn: document.getElementById('prevMoveBtn'),
  nextMoveBtn: document.getElementById('nextMoveBtn'),
  replayInfo: document.getElementById('replayInfo'),
  liveBtn: document.getElementById('liveBtn'),
  chatList: document.getElementById('chatList'),
  chatForm: document.getElementById('chatForm'),
  chatFilter: document.getElementById('chatFilter'),
  chatPrivateBadge: document.getElementById('chatPrivateBadge'),
  chatRecipient: document.getElementById('chatRecipient'),
  chatInput: document.getElementById('chatInput'),
  chatSendBtn: document.getElementById('chatSendBtn'),
  toastWrap: document.getElementById('toastWrap')
};

bootstrapApp();

function bootstrapApp() {
  bindEvents();
  renderBoard();
  refreshAll();
  state.pollHandle = setInterval(refreshAll, POLL_MS);
}

function bindEvents() {
  ui.createLobbyForm.addEventListener('submit', onCreateLobby);
  ui.refreshLobbiesBtn.addEventListener('click', refreshAll);
  ui.joinForm.addEventListener('submit', onJoinLobby);
  ui.prevMoveBtn.addEventListener('click', goReplayBackward);
  ui.nextMoveBtn.addEventListener('click', goReplayForward);
  ui.liveBtn.addEventListener('click', goReplayLive);
  ui.chatForm.addEventListener('submit', onSendChat);
  ui.chatFilter.addEventListener('change', onChatFilterChange);
  ui.chatList.addEventListener('click', markActiveLobbyChatRead);
  ui.chatInput.addEventListener('focus', markActiveLobbyChatRead);
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
    toast('Lobby creata con successo', 'success');
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

  const normalizedNickname = nickname.toLowerCase();
  const existingPlayer = state.players.find(player => player.name.trim().toLowerCase() === normalizedNickname);
  if (existingPlayer) {
    setJoinedPlayer(state.activeLobbyId, existingPlayer.id, existingPlayer.name);
    ui.nickname.value = '';
    toast('Riconnesso al tuo giocatore nella lobby', 'success');
    await refreshActiveLobby();
    return;
  }

  try {
    if (state.players.length >= 2) {
      toast('La lobby e piena: verrai aggiunto come spettatore con chat attiva', 'info');
    }

    const result = await apiFetch(`/games/${state.activeLobbyId}/players`, {
      method: 'POST',
      body: JSON.stringify({ name: nickname })
    });

    setJoinedPlayer(state.activeLobbyId, result.player.id, nickname);
    ui.nickname.value = '';
    toast('Ti sei unito alla lobby', 'success');
    await refreshActiveLobby();
  } catch (error) {
    toast(error.message, 'danger');
  }
}

async function refreshAll() {
  if (state.pendingMoveSubmission) {
    return;
  }

  await refreshLobbies();
  if (state.activeLobbyId) {
    await refreshActiveLobby();
  }
}

async function refreshLobbies() {
  try {
    const response = await apiFetch('/games');
    state.lobbies = response.games || [];
    renderLobbies();

    if (!state.activeLobbyId && state.lobbies.length > 0) {
      await openLobby(state.lobbies[0].id);
    }

    if (state.activeLobbyId && !state.lobbies.find(g => g.id === state.activeLobbyId)) {
      state.activeLobbyId = null;
      state.activeLobby = null;
      state.players = [];
      state.rawMoves = [];
      state.moves = [];
      state.board = Array(9).fill(null);
      state.finalBoard = Array(9).fill(null);
      state.winLine = [];
      state.replayIndex = null;
      state.chatMessages = [];
      state.unreadPrivateCount = 0;
      renderAllPanels();
    }
  } catch (error) {
    toast(`Errore elenco lobby: ${error.message}`, 'danger');
  }
}

async function openLobby(lobbyId) {
  state.activeLobbyId = lobbyId;
  state.replayIndex = null;
  state.chatFilter = ui.chatFilter.value || 'all';
  await refreshActiveLobby();
  renderLobbies();
}

async function refreshActiveLobby() {
  if (!state.activeLobbyId) return;

  const prevChatCount = state.chatMessages.length;

  try {
    const [lobbyRes, playersRes, movesRes] = await Promise.all([
      apiFetch(`/games/${state.activeLobbyId}`),
      apiFetch(`/games/${state.activeLobbyId}/players`),
      apiFetch(`/games/${state.activeLobbyId}/moves`)
    ]);

    state.activeLobby = lobbyRes.game;
    state.players = playersRes.players || [];
    restoreJoinedPlayerByNickname();

    state.rawMoves = sortMovesByTimestamp(movesRes.moves || []);
    state.moves = state.rawMoves.filter(isGameplayEvent);
    state.chatMessages = extractVisibleChatMessages(state.rawMoves);
    state.unreadPrivateCount = countUnreadPrivateMessages(state.rawMoves);

    if (state.activeLobby.status !== 'terminated') {
      state.replayIndex = null;
    } else if (state.replayIndex !== null) {
      state.replayIndex = clampReplayIndex(state.replayIndex);
    }

    rebuildBoardFromMoves();
    await ensureGameTermination();
    renderAllPanels();

    if (state.chatMessages.length > prevChatCount) {
      ui.chatList.scrollTop = ui.chatList.scrollHeight;
    }
  } catch (error) {
    toast(`Errore aggiornamento lobby: ${error.message}`, 'danger');
  }
}

function renderAllPanels() {
  renderHeaderInfo();
  renderPlayers();
  renderMoves();
  renderReplayControls();
  renderPrivateBadge();
  renderChatRecipients();
  renderChat();
  renderBoard();
}

function renderLobbies() {
  if (state.lobbies.length === 0) {
    ui.lobbyList.innerHTML = '<p class="text-secondary small m-0">Nessuna lobby disponibile.</p>';
    return;
  }

  ui.lobbyList.innerHTML = '';
  const groups = [
    { key: 'starting', title: 'Partite in avvio (in attesa di giocatori)' },
    { key: 'live', title: 'LIVE' },
    { key: 'terminated', title: 'Terminate' }
  ];

  groups.forEach(group => {
    const groupedLobbies = state.lobbies
      .filter(lobby => lobbyGroupKey(lobby) === group.key)
      .sort((a, b) => toEpoch(b.updatedAt || b.createdAt) - toEpoch(a.updatedAt || a.createdAt));

    const section = document.createElement('section');
    section.className = 'mb-3';
    section.innerHTML = `<div class="small fw-semibold text-secondary text-uppercase mb-2">${escapeHtml(group.title)}</div>`;

    if (groupedLobbies.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'text-secondary small m-0';
      empty.textContent = 'Nessuna lobby in questo gruppo.';
      section.appendChild(empty);
      ui.lobbyList.appendChild(section);
      return;
    }

    groupedLobbies.forEach(lobby => {
      const div = document.createElement('div');
      div.className = `lobby-item ${lobby.id === state.activeLobbyId ? 'active' : ''}`;
      div.innerHTML = `
        <div class="d-flex justify-content-between align-items-start gap-2">
          <div>
            <div class="fw-semibold">${escapeHtml(lobby.name)}</div>
            <div class="small text-secondary">ID: ${lobby.id.slice(0, 8)}...</div>
          </div>
          <button class="btn btn-sm btn-outline-info" data-open-lobby="${lobby.id}">Apri</button>
        </div>
      `;
      section.appendChild(div);
    });

    ui.lobbyList.appendChild(section);
  });

  ui.lobbyList.querySelectorAll('[data-open-lobby]').forEach(btn => {
    btn.addEventListener('click', async () => {
      await openLobby(btn.dataset.openLobby);
    });
  });
}

function lobbyGroupKey(lobby) {
  if (lobby?.status === 'terminated') {
    return 'terminated';
  }

  const playerCount = Array.isArray(lobby?.players) ? lobby.players.length : 0;
  if (playerCount < 2) {
    return 'starting';
  }

  return 'live';
}

function renderHeaderInfo() {
  if (!state.activeLobby) {
    ui.activeLobbyTitle.textContent = 'Nessuna lobby selezionata';
    ui.statusBadgeWrap.innerHTML = '';
    ui.joinBtn.disabled = true;
    ui.turnInfo.textContent = '-';
    ui.chatSendBtn.disabled = true;
    return;
  }

  const role = getCurrentRole();
  ui.activeLobbyTitle.textContent = `${state.activeLobby.name} (${state.activeLobby.id.slice(0, 8)}...)`;
  const playersFull = state.players.length >= 2;

  let roleBadge = '<span class="badge text-bg-secondary me-2">Spettatore</span>';
  if (role.kind === 'player') {
    const seat = role.symbol === 'X' ? 'Giocatore X' : 'Giocatore O';
    const cls = role.symbol === 'X' ? 'text-bg-warning text-dark' : 'text-bg-info text-dark';
    roleBadge = `<span class="badge ${cls} me-2">${seat}</span>`;
  }

  ui.statusBadgeWrap.innerHTML = `
    ${roleBadge}
    <span class="badge text-bg-light border">${playersFull ? 'Lobby piena (2/2)' : `Posti liberi (${state.players.length}/2)`}</span>
  `;

  ui.joinBtn.disabled = role.kind !== 'visitor';
  if (state.activeLobby.status === 'terminated') {
    ui.joinBtn.disabled = true;
  }

  ui.chatSendBtn.disabled = !canCurrentUserSendChat();

  const turn = currentTurnSymbol();
  if (state.activeLobby.status === 'terminated') {
    const verdict = evaluateWinner(state.finalBoard);
    if (verdict.winner) {
      ui.turnInfo.textContent = `Partita terminata - Vince ${verdict.winner}`;
    } else {
      ui.turnInfo.textContent = 'Partita terminata - Pareggio';
    }
  } else {
    ui.turnInfo.textContent = `Turno: ${turn}`;
  }
}

function renderPlayers() {
  if (!state.activeLobby) {
    ui.playerList.innerHTML = '<p class="small text-secondary m-0">Seleziona una lobby.</p>';
    return;
  }

  const rows = state.players.map((player, index) => {
    const seat = index === 0 ? 'X' : index === 1 ? 'O' : 'Spettatore';
    const cls = index === 0
      ? 'text-bg-warning text-dark'
      : index === 1
        ? 'text-bg-info text-dark'
        : 'text-bg-secondary';
    return `
      <div class="d-flex justify-content-between align-items-center mb-2">
        <div>
          <div class="fw-medium">${escapeHtml(player.name)}</div>
          <div class="small text-secondary">${player.id.slice(0, 8)}...</div>
        </div>
        <span class="badge ${cls}">${seat}</span>
      </div>
    `;
  });

  ui.playerList.innerHTML = rows.length > 0
    ? rows.join('')
    : '<p class="small text-secondary m-0">Nessun giocatore in lobby.</p>';
}

function renderMoves() {
  if (!state.moves.length) {
    ui.moveList.innerHTML = '<li class="text-secondary">Nessuna mossa</li>';
    return;
  }

  ui.moveList.innerHTML = state.moves.map((move, idx) => {
    const text = moveToHumanString(move.data);
    return `<li><span class="text-secondary">#${idx + 1}</span> ${escapeHtml(text)}</li>`;
  }).join('');
}

function renderBoard() {
  ui.board.innerHTML = '';

  const role = getCurrentRole();
  const isMyTurn = role.kind === 'player' && role.symbol === currentTurnSymbol();
  const hasTwoPlayers = state.players.length >= 2;
  const isTerminated = state.activeLobby?.status === 'terminated';
  const isReplayMode = state.replayIndex !== null;

  for (let index = 0; index < 9; index += 1) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'cell';

    const symbol = state.board[index];
    if (symbol) {
      btn.textContent = symbol;
      btn.classList.add(symbol.toLowerCase());
    }

    const isWinCell = state.winLine.includes(index);
    if (isWinCell) {
      btn.classList.add('win');
    }

    const playable = !symbol && role.kind === 'player' && isMyTurn && hasTwoPlayers && !isTerminated && !isReplayMode && !state.pendingMoveSubmission;
    if (playable) {
      btn.classList.add('playable');
    }

    btn.addEventListener('click', () => onBoardCellClick(index));
    ui.board.appendChild(btn);
  }
}

function onBoardCellClick(index) {
  if (!state.activeLobbyId) return;
  if (state.activeLobby?.status === 'terminated') return;
  if (state.replayIndex !== null) return;
  if (state.pendingMoveSubmission) {
    toast('Attendi conferma della mossa dal server', 'info');
    return;
  }

  const role = getCurrentRole();
  if (role.kind !== 'player') return;

  if (state.players.length < 2) {
    toast('In attesa del secondo giocatore', 'info');
    return;
  }

  if (role.symbol !== currentTurnSymbol()) {
    toast('Non e il tuo turno', 'warning');
    return;
  }

  if (state.board[index]) {
    return;
  }

  submitMove(index, role);
}

async function submitMove(index, role) {
  state.pendingMoveSubmission = true;

  try {
    const row = Math.floor(index / 3);
    const col = index % 3;

    const response = await apiFetch(`/games/${state.activeLobbyId}/moves`, {
      method: 'POST',
      body: JSON.stringify({
        playerId: role.player.id,
        data: {
          type: 'play',
          row,
          col,
          index,
          symbol: role.symbol
        }
      })
    });

    const moveId = response?.move?.id;
    if (!moveId) {
      throw new Error('Il server non ha confermato la mossa');
    }

    const synced = await waitForMoveSync(moveId);
    if (!synced) {
      throw new Error('Mossa inviata ma non sincronizzata, ricarica stato in corso');
    }

    await refreshActiveLobby();
  } catch (error) {
    toast(error.message, 'danger');
    await refreshActiveLobby();
  } finally {
    state.pendingMoveSubmission = false;
  }
}

async function waitForMoveSync(moveId) {
  const maxAttempts = 8;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const movesRes = await apiFetch(`/games/${state.activeLobbyId}/moves`);
    const moves = sortMovesByTimestamp(movesRes.moves || []);
    if (moves.some(move => move.id === moveId)) {
      return true;
    }

    await delay(250);
  }

  return false;
}

function rebuildBoardFromMoves() {
  state.finalBoard = buildBoardFromMoves(state.moves);
  const visibleMoves = getVisibleMovesForReplay();
  state.board = buildBoardFromMoves(visibleMoves);
  state.winLine = evaluateWinner(state.board).line;
}

function buildBoardFromMoves(moves) {
  const board = Array(9).fill(null);

  for (const move of moves) {
    const index = Number(move?.data?.index);
    if (!Number.isInteger(index) || index < 0 || index > 8) {
      continue;
    }

    if (board[index]) {
      continue;
    }

    board[index] = move.data.symbol === 'O' ? 'O' : 'X';
  }

  return board;
}

function getVisibleMovesForReplay() {
  if (!state.activeLobby || state.activeLobby.status !== 'terminated') {
    return state.moves;
  }

  if (state.replayIndex === null) {
    return state.moves;
  }

  return state.moves.slice(0, state.replayIndex);
}

function renderReplayControls() {
  if (!state.activeLobby || state.activeLobby.status !== 'terminated') {
    ui.prevMoveBtn.disabled = true;
    ui.nextMoveBtn.disabled = true;
    ui.liveBtn.disabled = true;
    ui.replayInfo.textContent = 'Live';
    return;
  }

  const total = state.moves.length;
  const atIndex = state.replayIndex === null ? total : state.replayIndex;

  ui.prevMoveBtn.disabled = atIndex <= 0;
  ui.nextMoveBtn.disabled = atIndex >= total;
  ui.liveBtn.disabled = state.replayIndex === null;
  ui.replayInfo.textContent = state.replayIndex === null
    ? `Finale (${total}/${total})`
    : `Replay (${atIndex}/${total})`;
}

function goReplayBackward() {
  if (!state.activeLobby || state.activeLobby.status !== 'terminated') return;

  const total = state.moves.length;
  const current = state.replayIndex === null ? total : state.replayIndex;
  state.replayIndex = Math.max(0, current - 1);

  rebuildBoardFromMoves();
  renderAllPanels();
}

function goReplayForward() {
  if (!state.activeLobby || state.activeLobby.status !== 'terminated') return;

  const total = state.moves.length;
  const current = state.replayIndex === null ? total : state.replayIndex;
  const next = Math.min(total, current + 1);

  state.replayIndex = next >= total ? null : next;
  rebuildBoardFromMoves();
  renderAllPanels();
}

function goReplayLive() {
  if (!state.activeLobby || state.activeLobby.status !== 'terminated') return;

  state.replayIndex = null;
  rebuildBoardFromMoves();
  renderAllPanels();
}

function clampReplayIndex(index) {
  const total = state.moves.length;
  return Math.min(Math.max(index, 0), total);
}

async function ensureGameTermination() {
  if (!state.activeLobby || state.activeLobby.status === 'terminated' || state.terminatingGame) {
    return;
  }

  if (state.players.length < 2) {
    return;
  }

  const verdict = evaluateWinner(state.finalBoard);
  const isBoardFull = state.finalBoard.every(cell => !!cell);

  if (!verdict.winner && !isBoardFull) {
    return;
  }

  state.terminatingGame = true;
  try {
    await apiFetch(`/games/${state.activeLobbyId}`, {
      method: 'PUT',
      body: JSON.stringify({
        status: 'terminated',
        result: verdict.winner || 'draw'
      })
    });

    state.activeLobby.status = 'terminated';
    if (verdict.winner) {
      toast(`Partita terminata: vince ${verdict.winner}`, 'success');
    } else {
      toast('Partita terminata: pareggio', 'success');
    }
  } catch (error) {
    toast(`Errore terminazione partita: ${error.message}`, 'danger');
  } finally {
    state.terminatingGame = false;
  }
}

function evaluateWinner(board) {
  for (const line of WIN_LINES) {
    const [a, b, c] = line;
    if (board[a] && board[a] === board[b] && board[a] === board[c]) {
      return { winner: board[a], line };
    }
  }

  return { winner: null, line: [] };
}

function currentTurnSymbol() {
  return state.moves.length % 2 === 0 ? 'X' : 'O';
}

function getCurrentRole() {
  if (!state.activeLobbyId) return { kind: 'visitor' };

  const joined = state.joinedPlayersByLobby[state.activeLobbyId];
  if (!joined) return { kind: 'visitor' };

  const player = state.players.find(p => p.id === joined.playerId);
  if (!player) return { kind: 'visitor' };

  const index = state.players.findIndex(p => p.id === player.id);
  if (index === 0) return { kind: 'player', symbol: 'X', player };
  if (index === 1) return { kind: 'player', symbol: 'O', player };
  return { kind: 'spectator', player };
}

function setJoinedPlayer(lobbyId, playerId, nickname) {
  state.joinedPlayersByLobby[lobbyId] = { playerId, nickname };
  localStorage.setItem('trisJoinedPlayers', JSON.stringify(state.joinedPlayersByLobby));
}

function restoreJoinedPlayerByNickname() {
  if (!state.activeLobbyId) return;

  const joined = state.joinedPlayersByLobby[state.activeLobbyId];
  if (!joined || !joined.nickname) return;

  const playerStillPresent = state.players.some(player => player.id === joined.playerId);
  if (playerStillPresent) return;

  const normalizedNickname = joined.nickname.trim().toLowerCase();
  const matched = state.players.find(player => player.name.trim().toLowerCase() === normalizedNickname);
  if (!matched) return;

  setJoinedPlayer(state.activeLobbyId, matched.id, matched.name);
}

function loadJoinedPlayers() {
  try {
    const raw = localStorage.getItem('trisJoinedPlayers');
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function loadChatReadByLobby() {
  try {
    const raw = localStorage.getItem('trisChatReadByLobby');
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveChatReadByLobby() {
  localStorage.setItem('trisChatReadByLobby', JSON.stringify(state.chatReadByLobby));
}

function renderPrivateBadge() {
  if (!state.activeLobbyId || state.unreadPrivateCount <= 0) {
    ui.chatPrivateBadge.classList.add('d-none');
    return;
  }

  ui.chatPrivateBadge.textContent = `Nuovi privati: ${state.unreadPrivateCount}`;
  ui.chatPrivateBadge.classList.remove('d-none');
}

function isGameplayEvent(move) {
  return move?.data?.type !== 'chat';
}

function extractVisibleChatMessages(events) {
  const role = getCurrentRole();
  if (role.kind === 'visitor') {
    return [];
  }

  const meId = role.player.id;
  return events
    .filter(item => item?.data?.type === 'chat' && typeof item?.data?.text === 'string')
    .filter(item => {
      const target = item.data.toPlayerId || null;
      return !target || target === meId || item.playerId === meId;
    });
}

function countUnreadPrivateMessages(events) {
  const role = getCurrentRole();
  if (role.kind === 'visitor') return 0;

  const myId = role.player.id;
  const lastRead = state.chatReadByLobby[state.activeLobbyId] || null;
  const lastReadTime = toEpoch(lastRead);

  return events
    .filter(item => item?.data?.type === 'chat')
    .filter(item => item?.data?.toPlayerId === myId && item.playerId !== myId)
    .filter(item => toEpoch(item.timestamp) > lastReadTime)
    .length;
}

function onChatFilterChange() {
  state.chatFilter = ui.chatFilter.value;
  renderChat();
}

function markActiveLobbyChatRead() {
  if (!state.activeLobbyId) return;

  const role = getCurrentRole();
  if (role.kind === 'visitor') return;

  const myId = role.player.id;
  const newestPrivateToMe = state.rawMoves
    .filter(item => item?.data?.type === 'chat')
    .filter(item => item?.data?.toPlayerId === myId && item.playerId !== myId)
    .sort((a, b) => toEpoch(b.timestamp) - toEpoch(a.timestamp))[0];

  if (!newestPrivateToMe) return;

  state.chatReadByLobby[state.activeLobbyId] = newestPrivateToMe.timestamp;
  saveChatReadByLobby();
  state.unreadPrivateCount = 0;
  renderPrivateBadge();
}

function renderChatRecipients() {
  if (!state.activeLobbyId) {
    ui.chatRecipient.innerHTML = '<option value="__all__">Tutti i presenti</option>';
    return;
  }

  const role = getCurrentRole();
  const myId = role.kind === 'visitor' ? null : role.player.id;
  const options = ['<option value="__all__">Tutti i presenti</option>'];

  state.players.forEach((player, index) => {
    if (player.id === myId) return;
    const seat = index === 0 ? ' (X)' : index === 1 ? ' (O)' : ' (Spettatore)';
    options.push(`<option value="${player.id}">${escapeHtml(player.name)}${seat}</option>`);
  });

  const previous = ui.chatRecipient.value;
  ui.chatRecipient.innerHTML = options.join('');
  if (previous && ui.chatRecipient.querySelector(`option[value="${previous}"]`)) {
    ui.chatRecipient.value = previous;
  }
}

function renderChat() {
  if (!state.activeLobbyId) {
    ui.chatList.innerHTML = '<p class="small text-secondary m-0">Seleziona una lobby.</p>';
    return;
  }

  const filteredMessages = filterChatMessages(state.chatMessages, state.chatFilter);

  if (filteredMessages.length === 0) {
    const role = getCurrentRole();
    ui.chatList.innerHTML = role.kind === 'visitor'
      ? '<p class="small text-secondary m-0">Unisciti alla partita per leggere e scrivere in chat.</p>'
      : '<p class="small text-secondary m-0">Nessun messaggio per questo filtro.</p>';
    return;
  }

  ui.chatList.innerHTML = filteredMessages.map(msg => {
    const text = msg.data.text || '';
    const isPrivate = !!msg.data.toPlayerId;
    const sender = state.players.find(p => p.id === msg.playerId);
    const senderName = sender?.name || 'Utente';
    const visibility = isPrivate
      ? `Privato: ${chatDestinationLabel(msg.data.toPlayerId)}`
      : 'Pubblico';

    return `
      <article class="chat-item ${isPrivate ? 'private' : ''}">
        <div class="chat-meta">${escapeHtml(senderName)} • ${escapeHtml(visibility)} • ${escapeHtml(formatTime(msg.timestamp))}</div>
        <p class="chat-text">${escapeHtml(text)}</p>
      </article>
    `;
  }).join('');
}

function filterChatMessages(messages, filter) {
  if (filter === 'public') {
    return messages.filter(msg => !msg?.data?.toPlayerId);
  }
  if (filter === 'private') {
    return messages.filter(msg => !!msg?.data?.toPlayerId);
  }
  return messages;
}

function chatDestinationLabel(playerId) {
  if (!playerId) return 'Tutti';
  const target = state.players.find(p => p.id === playerId);
  return target ? target.name : 'Utente';
}

function canCurrentUserSendChat() {
  if (!state.activeLobbyId || !state.activeLobby || state.activeLobby.status === 'terminated') {
    return false;
  }

  const role = getCurrentRole();
  return role.kind !== 'visitor';
}

async function onSendChat(event) {
  event.preventDefault();

  if (!state.activeLobbyId) {
    toast('Seleziona prima una lobby', 'warning');
    return;
  }

  const role = getCurrentRole();
  if (role.kind === 'visitor') {
    toast('Per scrivere in chat devi prima unirti alla partita', 'warning');
    return;
  }

  const text = ui.chatInput.value.trim();
  if (!text) {
    toast('Scrivi un messaggio prima di inviare', 'warning');
    return;
  }

  const toPlayerId = ui.chatRecipient.value === '__all__' ? null : ui.chatRecipient.value;

  try {
    await apiFetch(`/games/${state.activeLobbyId}/moves`, {
      method: 'POST',
      body: JSON.stringify({
        playerId: role.player.id,
        data: {
          type: 'chat',
          text,
          toPlayerId
        }
      })
    });

    ui.chatInput.value = '';
    markActiveLobbyChatRead();
    await refreshActiveLobby();
  } catch (error) {
    toast(error.message, 'danger');
  }
}

function moveToHumanString(data) {
  if (!Number.isInteger(data?.index)) {
    return 'Mossa non valida';
  }

  const symbol = data.symbol === 'O' ? 'O' : 'X';
  const row = Math.floor(data.index / 3) + 1;
  const col = (data.index % 3) + 1;
  return `${symbol} -> r${row} c${col}`;
}

function formatTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '--:--';
  return date.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
}

function toEpoch(value) {
  const epoch = new Date(value).getTime();
  return Number.isFinite(epoch) ? epoch : 0;
}

function sortMovesByTimestamp(moves) {
  return [...moves].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
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

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data?.error || `HTTP ${response.status}`;
    throw new Error(message);
  }

  return data;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function toast(message, variant = 'secondary') {
  const item = document.createElement('div');
  item.className = `toast align-items-center text-bg-${variant} border-0`;
  item.role = 'alert';
  item.ariaLive = 'assertive';
  item.ariaAtomic = 'true';
  item.innerHTML = `
    <div class="d-flex">
      <div class="toast-body">${escapeHtml(message)}</div>
      <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast" aria-label="Close"></button>
    </div>
  `;

  ui.toastWrap.appendChild(item);
  const t = new bootstrap.Toast(item, { delay: 2800 });
  t.show();
  item.addEventListener('hidden.bs.toast', () => item.remove());
}
