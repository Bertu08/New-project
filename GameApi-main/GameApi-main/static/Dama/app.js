const API_KEY = '3cf54f7a-8887-44c5-8739-75116039b698341d0937019d448d8641d2d18aafb5e9';
const API_BASE = window.location.origin;
const POLL_MS = 2500;

const state = {
  lobbies: [],
  activeLobbyId: null,
  activeLobby: null,
  players: [],
  rawMoves: [],
  moves: [],
  chatMessages: [],
  chatFilter: 'all',
  unreadPrivateCount: 0,
  board: [],
  finalBoard: [],
  selectedCell: null,
  legalTargets: [],
  chainMove: null,
  replayIndex: null,
  pendingMoveSubmission: false,
  terminatingGame: false,
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
  state.board = createInitialBoard();
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
  if (state.chainMove || state.pendingMoveSubmission) {
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
      state.chatMessages = [];
      state.unreadPrivateCount = 0;
      state.board = createInitialBoard();
      renderAllPanels();
    }
  } catch (error) {
    toast(`Errore elenco lobby: ${error.message}`, 'danger');
  }
}

async function openLobby(lobbyId) {
  state.activeLobbyId = lobbyId;
  state.selectedCell = null;
  state.legalTargets = [];
  state.chainMove = null;
  state.replayIndex = null;
  state.chatFilter = ui.chatFilter.value || 'all';
  await refreshActiveLobby();
  renderLobbies();
}

async function refreshActiveLobby() {
  if (!state.activeLobbyId) return;

  const prevSelection = state.selectedCell ? { ...state.selectedCell } : null;
  const prevMoveCount = state.moves.length;
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
    restoreSelectionIfPossible(prevSelection, prevMoveCount);
    await ensureGameTermination();
    renderAllPanels();
    if (state.chatMessages.length > prevChatCount) {
      ui.chatList.scrollTop = ui.chatList.scrollHeight;
    }
  } catch (error) {
    toast(`Errore aggiornamento lobby: ${error.message}`, 'danger');
  }
}

function restoreSelectionIfPossible(prevSelection, prevMoveCount) {
  if (!prevSelection) return;

  // If new moves arrived, the board state changed and the previous selection is no longer reliable.
  if (state.moves.length !== prevMoveCount) return;

  const role = getCurrentRole();
  if (role.kind !== 'player') return;
  if (role.color !== currentTurnColor()) return;

  const piece = state.board[prevSelection.row]?.[prevSelection.col];
  if (!piece || piece.color !== role.color) return;

  const legalTargets = legalMovesForPiece(prevSelection.row, prevSelection.col, role.color);
  if (legalTargets.length === 0) return;

  state.selectedCell = prevSelection;
  state.legalTargets = legalTargets;
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

function renderPrivateBadge() {
  if (!state.activeLobbyId || state.unreadPrivateCount <= 0) {
    ui.chatPrivateBadge.classList.add('d-none');
    return;
  }
  ui.chatPrivateBadge.textContent = `Nuovi privati: ${state.unreadPrivateCount}`;
  ui.chatPrivateBadge.classList.remove('d-none');
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
          <button class="btn btn-sm btn-outline-success" data-open-lobby="${lobby.id}">Apri</button>
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

  let badgeClass = 'text-bg-secondary';
  let badgeText = 'Spettatore';
  if (role.kind === 'player') {
    badgeClass = role.color === 'white' ? 'text-bg-light border' : 'text-bg-dark';
    badgeText = `Giocatore ${role.color === 'white' ? 'Bianco' : 'Nero'}`;
  }

  ui.statusBadgeWrap.innerHTML = `
    <span class="badge ${badgeClass} me-2">${badgeText}</span>
    <span class="badge text-bg-warning">${playersFull ? 'Lobby piena (2/2)' : `Posti liberi (${state.players.length}/2)`}</span>
  `;

  ui.joinBtn.disabled = role.kind !== 'visitor';

  if (state.activeLobby.status === 'terminated') {
    ui.joinBtn.disabled = true;
  }

  ui.chatSendBtn.disabled = !canCurrentUserSendChat();

  const turnColor = currentTurnColor();
  const turnLabel = turnColor === 'white' ? 'Bianco' : 'Nero';
  if (state.activeLobby.status === 'terminated') {
    const winner = detectWinner(state.finalBoard);
    const winnerLabel = winner === 'white' ? 'Bianco' : winner === 'black' ? 'Nero' : 'Nessuno';
    ui.turnInfo.textContent = `Partita terminata - Vincitore: ${winnerLabel}`;
  } else {
    ui.turnInfo.textContent = `Turno: ${turnLabel}`;
  }
}

function renderPlayers() {
  if (!state.activeLobby) {
    ui.playerList.innerHTML = '<p class="small text-secondary m-0">Seleziona una lobby.</p>';
    return;
  }

  const rows = state.players.map((player, index) => {
    const colorLabel = index === 0 ? 'Bianco' : index === 1 ? 'Nero' : 'Spettatore';
    const colorClass = index === 0 ? 'text-bg-light border' : index === 1 ? 'text-bg-dark' : 'text-bg-secondary';
    return `
      <div class="d-flex justify-content-between align-items-center mb-2">
        <div>
          <div class="fw-medium">${escapeHtml(player.name)}</div>
          <div class="small text-secondary">${player.id.slice(0, 8)}...</div>
        </div>
        <span class="badge ${colorClass}">${colorLabel}</span>
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
  const isMyTurn = role.kind === 'player' && role.color === currentTurnColor();
  const hasTwoPlayers = state.players.length >= 2;
  const isTerminated = state.activeLobby?.status === 'terminated';
  const isReplayMode = state.replayIndex !== null;
  const boardLocked = state.pendingMoveSubmission;

  for (let row = 0; row < 8; row += 1) {
    for (let col = 0; col < 8; col += 1) {
      const cell = document.createElement('button');
      const isDark = (row + col) % 2 === 1;
      cell.className = `cell ${isDark ? 'dark' : 'light'}`;
      cell.type = 'button';
      cell.dataset.row = String(row);
      cell.dataset.col = String(col);

      const piece = state.board[row][col];

      if (piece) {
        const pieceEl = document.createElement('div');
        pieceEl.className = `piece ${piece.color} ${piece.king ? 'king' : ''}`;
        cell.appendChild(pieceEl);
      }

      const selected = state.selectedCell && state.selectedCell.row === row && state.selectedCell.col === col;
      if (selected) {
        cell.classList.add('selected');
      }

      if (state.legalTargets.some(t => t.to.row === row && t.to.col === col)) {
        cell.classList.add('legal');
      }

      if (piece && isDark && hasTwoPlayers && isMyTurn && role.kind === 'player' && piece.color === role.color && !isTerminated && !isReplayMode && !boardLocked) {
        const available = legalMovesForPiece(row, col, role.color);
        if (available.length > 0) {
          cell.classList.add('selectable');
        }
      }

      cell.addEventListener('click', () => onBoardCellClick(row, col));
      ui.board.appendChild(cell);
    }
  }
}

function onBoardCellClick(row, col) {
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
  if (role.color !== currentTurnColor()) {
    toast('Non e il tuo turno', 'warning');
    return;
  }

  const clickedPiece = state.board[row][col];

  if (state.chainMove && clickedPiece && clickedPiece.color === role.color) {
    toast('Completa prima la sequenza di cattura con la pedina selezionata', 'info');
    return;
  }

  if (clickedPiece && clickedPiece.color === role.color) {
    const legal = legalMovesForPiece(row, col, role.color);
    state.selectedCell = { row, col };
    state.legalTargets = legal;
    renderBoard();
    return;
  }

  if (!state.selectedCell) return;

  const targetMove = state.legalTargets.find(m => m.to.row === row && m.to.col === col);
  if (!targetMove) return;

  performMoveStep(targetMove);
}

function performMoveStep(move) {
  const role = getCurrentRole();
  if (role.kind !== 'player') return;

  if (!state.chainMove) {
    state.chainMove = {
      color: role.color,
      from: { ...move.from },
      steps: []
    };
  }

  const applied = applyMoveToBoard(state.board, move);
  if (!applied) {
    state.chainMove = null;
    state.selectedCell = null;
    state.legalTargets = [];
    toast('Mossa non valida', 'warning');
    return;
  }

  state.chainMove.steps.push({
    from: { ...move.from },
    to: { ...move.to },
    captured: move.captured ? { ...move.captured } : null,
    promoted: !!move.promoted
  });

  if (move.captured) {
    const moreCaptures = captureMovesForPiece(move.to.row, move.to.col, role.color);
    if (moreCaptures.length > 0) {
      state.selectedCell = { ...move.to };
      state.legalTargets = moreCaptures;
      renderBoard();
      return;
    }
  }

  submitChainMove();
}

async function submitChainMove() {
  const role = getCurrentRole();
  if (role.kind !== 'player') return;
  if (!state.chainMove || state.chainMove.steps.length === 0) return;
  if (state.pendingMoveSubmission) return;

  const firstStep = state.chainMove.steps[0];
  const lastStep = state.chainMove.steps[state.chainMove.steps.length - 1];
  const captures = state.chainMove.steps
    .filter(step => !!step.captured)
    .map(step => ({ ...step.captured }));

  const payload = {
    playerId: role.player.id,
    data: {
      from: firstStep.from,
      to: lastStep.to,
      captured: captures[0] || null,
      captures,
      sequence: state.chainMove.steps,
      color: role.color,
      promoted: !!lastStep.promoted
    }
  };

  state.pendingMoveSubmission = true;
  try {
    const response = await apiFetch(`/games/${state.activeLobbyId}/moves`, {
      method: 'POST',
      body: JSON.stringify(payload)
    });

    const moveId = response?.move?.id;
    if (!moveId) {
      throw new Error('Il server non ha confermato la mossa');
    }

    const synced = await waitForMoveSync(moveId);
    if (!synced) {
      throw new Error('Mossa inviata ma non sincronizzata, ricarica stato in corso');
    }

    state.chainMove = null;
    state.selectedCell = null;
    state.legalTargets = [];
    await refreshActiveLobby();
  } catch (error) {
    state.chainMove = null;
    state.selectedCell = null;
    state.legalTargets = [];
    toast(error.message, 'danger');
    try {
      await refreshActiveLobby();
    } catch {
      rebuildBoardFromMoves();
      renderAllPanels();
    }
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

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function rebuildBoardFromMoves() {
  state.finalBoard = buildBoardFromMoves(state.moves);
  const visibleMoves = getVisibleMovesForReplay();
  state.board = buildBoardFromMoves(visibleMoves);
  state.selectedCell = null;
  state.legalTargets = [];
}

function buildBoardFromMoves(moves) {
  const board = createInitialBoard();

  for (const move of moves) {
    const ok = applyMoveToBoard(board, move.data);
    if (!ok) {
      console.warn('Mossa non valida durante replay:', move);
      break;
    }
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
  const next = Math.max(0, current - 1);

  state.replayIndex = next;
  rebuildBoardFromMoves();
  renderAllPanels();
}

function goReplayForward() {
  if (!state.activeLobby || state.activeLobby.status !== 'terminated') return;

  const total = state.moves.length;
  const current = state.replayIndex === null ? total : state.replayIndex;
  const next = Math.min(total, current + 1);

  if (next >= total) {
    state.replayIndex = null;
  } else {
    state.replayIndex = next;
  }

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

  const winnerColor = detectWinner(state.finalBoard);
  if (!winnerColor) {
    return;
  }

  state.terminatingGame = true;
  try {
    await apiFetch(`/games/${state.activeLobbyId}`, {
      method: 'PUT',
      body: JSON.stringify({
        status: 'terminated',
        winnerColor
      })
    });
    state.activeLobby.status = 'terminated';
    toast(`Partita terminata: vince ${winnerColor === 'white' ? 'Bianco' : 'Nero'}`, 'success');
  } catch (error) {
    toast(`Errore terminazione partita: ${error.message}`, 'danger');
  } finally {
    state.terminatingGame = false;
  }
}

function detectWinner(board) {
  const whitePieces = countPieces(board, 'white');
  const blackPieces = countPieces(board, 'black');

  if (whitePieces === 0) return 'black';
  if (blackPieces === 0) return 'white';

  const whiteMoves = allLegalMovesOnBoard(board, 'white');
  const blackMoves = allLegalMovesOnBoard(board, 'black');

  if (whiteMoves.length === 0) return 'black';
  if (blackMoves.length === 0) return 'white';

  return null;
}

function countPieces(board, color) {
  let count = 0;
  for (let row = 0; row < 8; row += 1) {
    for (let col = 0; col < 8; col += 1) {
      if (board[row][col]?.color === color) count += 1;
    }
  }
  return count;
}

function createInitialBoard() {
  const board = Array.from({ length: 8 }, () => Array(8).fill(null));

  for (let row = 0; row < 3; row += 1) {
    for (let col = 0; col < 8; col += 1) {
      if ((row + col) % 2 === 1) {
        board[row][col] = { color: 'black', king: false };
      }
    }
  }

  for (let row = 5; row < 8; row += 1) {
    for (let col = 0; col < 8; col += 1) {
      if ((row + col) % 2 === 1) {
        board[row][col] = { color: 'white', king: false };
      }
    }
  }

  return board;
}

function legalMovesForPiece(row, col, color) {
  const piece = state.board[row][col];
  if (!piece || piece.color !== color) return [];

  const all = allLegalMovesOnBoard(state.board, color);
  return all.filter(m => m.from.row === row && m.from.col === col);
}

function captureMovesForPiece(row, col, color) {
  const piece = state.board[row][col];
  if (!piece || piece.color !== color) return [];
  return pieceMovesOnBoard(state.board, row, col, piece).filter(m => !!m.captured);
}

function allLegalMovesOnBoard(board, color) {
  const moves = [];
  for (let row = 0; row < 8; row += 1) {
    for (let col = 0; col < 8; col += 1) {
      const piece = board[row][col];
      if (!piece || piece.color !== color) continue;
      moves.push(...pieceMovesOnBoard(board, row, col, piece));
    }
  }

  const captures = moves.filter(m => !!m.captured);
  return captures.length > 0 ? captures : moves;
}

function pieceMovesOnBoard(board, row, col, piece) {
  const directions = piece.king
    ? [[-1, -1], [-1, 1], [1, -1], [1, 1]]
    : piece.color === 'white'
      ? [[-1, -1], [-1, 1]]
      : [[1, -1], [1, 1]];

  const list = [];

  for (const [dr, dc] of directions) {
    const r1 = row + dr;
    const c1 = col + dc;
    const r2 = row + 2 * dr;
    const c2 = col + 2 * dc;

    if (insideBoard(r1, c1) && !board[r1][c1]) {
      const promoted = reachesPromotionRow(piece.color, r1, piece.king);
      list.push({
        from: { row, col },
        to: { row: r1, col: c1 },
        captured: null,
        promoted
      });
    }

    if (insideBoard(r2, c2) && !board[r2][c2]) {
      const middle = board[r1][c1];
      if (middle && middle.color !== piece.color) {
        const promoted = reachesPromotionRow(piece.color, r2, piece.king);
        list.push({
          from: { row, col },
          to: { row: r2, col: c2 },
          captured: { row: r1, col: c1 },
          promoted
        });
      }
    }
  }

  return list;
}

function applyMoveToBoard(board, data) {
  if (Array.isArray(data?.sequence) && data.sequence.length > 0) {
    for (const step of data.sequence) {
      const ok = applySingleMoveToBoard(board, step);
      if (!ok) return false;
    }
    return true;
  }

  return applySingleMoveToBoard(board, data);
}

function applySingleMoveToBoard(board, data) {
  if (!data?.from || !data?.to) return false;
  const from = data.from;
  const to = data.to;

  if (!insideBoard(from.row, from.col) || !insideBoard(to.row, to.col)) return false;
  const piece = board[from.row][from.col];
  if (!piece || board[to.row][to.col]) return false;

  board[from.row][from.col] = null;
  board[to.row][to.col] = { ...piece };

  if (data.captured && insideBoard(data.captured.row, data.captured.col)) {
    board[data.captured.row][data.captured.col] = null;
  }

  if (data.promoted || reachesPromotionRow(piece.color, to.row, piece.king)) {
    board[to.row][to.col].king = true;
  }

  return true;
}

function currentTurnColor() {
  return state.moves.length % 2 === 0 ? 'white' : 'black';
}

function getCurrentRole() {
  if (!state.activeLobbyId) return { kind: 'visitor' };

  const joined = state.joinedPlayersByLobby[state.activeLobbyId];
  if (!joined) return { kind: 'visitor' };

  const player = state.players.find(p => p.id === joined.playerId);
  if (!player) return { kind: 'visitor' };

  const index = state.players.findIndex(p => p.id === player.id);
  if (index === 0) return { kind: 'player', color: 'white', player };
  if (index === 1) return { kind: 'player', color: 'black', player };
  return { kind: 'spectator', player };
}

function setJoinedPlayer(lobbyId, playerId, nickname) {
  state.joinedPlayersByLobby[lobbyId] = { playerId, nickname };
  localStorage.setItem('damaJoinedPlayers', JSON.stringify(state.joinedPlayersByLobby));
}

function loadJoinedPlayers() {
  try {
    const raw = localStorage.getItem('damaJoinedPlayers');
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function loadChatReadByLobby() {
  try {
    const raw = localStorage.getItem('damaChatReadByLobby');
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveChatReadByLobby() {
  localStorage.setItem('damaChatReadByLobby', JSON.stringify(state.chatReadByLobby));
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

function sortMovesByTimestamp(moves) {
  return [...moves].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
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

function toEpoch(value) {
  const epoch = new Date(value).getTime();
  return Number.isFinite(epoch) ? epoch : 0;
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
    const seat = index === 0 ? ' (Bianco)' : index === 1 ? ' (Nero)' : ' (Spettatore)';
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

function formatTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '--:--';
  return date.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
}

function moveToHumanString(data) {
  if (Array.isArray(data?.sequence) && data.sequence.length > 0) {
    const first = data.sequence[0];
    const hasCapture = data.sequence.some(step => !!step.captured);
    const sep = hasCapture ? 'x' : '-';
    const cells = [toCellName(first.from.row, first.from.col), ...data.sequence.map(step => toCellName(step.to.row, step.to.col))];
    const promo = data.sequence[data.sequence.length - 1]?.promoted ? ' (promozione)' : '';
    return `${cells.join(sep)}${promo}`;
  }

  if (!data?.from || !data?.to) return 'Mossa non valida';
  const sep = data.captured ? 'x' : '-';
  const from = toCellName(data.from.row, data.from.col);
  const to = toCellName(data.to.row, data.to.col);
  const promo = data.promoted ? ' (promozione)' : '';
  return `${from}${sep}${to}${promo}`;
}

function toCellName(row, col) {
  const file = String.fromCharCode(97 + col);
  const rank = 8 - row;
  return `${file}${rank}`;
}

function reachesPromotionRow(color, row, isKing) {
  if (isKing) return false;
  return (color === 'white' && row === 0) || (color === 'black' && row === 7);
}

function insideBoard(row, col) {
  return row >= 0 && row < 8 && col >= 0 && col < 8;
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