import { state } from './state.js';
import { loadRoom, saveRoom } from './storage.js';
import { showToast } from './ui.js';
import { render } from './render.js';
import { applyPendingRound, CUT_REVEAL_MS } from './actions.js';

// ===== Room lifecycle =====

export function newRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 4; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}
export function uid() { return 'pl_' + Math.random().toString(36).slice(2, 10); }

export async function mySession() {
  try {
    const raw = localStorage.getItem('my-remi-session');
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}
export async function saveSession() {
  localStorage.setItem('my-remi-session', JSON.stringify(state.session));
}

export async function createRoom(name) {
  const code = newRoomCode();
  state.session = { playerId: uid(), name, roomCode: code };
  await saveSession();
  const r = {
    code,
    phase: 'lobby',
    players: [{ id: state.session.playerId, name }],
    dealerIndex: 0,
    round: 0,
    scores: {},
    createdAt: Date.now(),
  };
  await saveRoom(r);
  state.room = r;
  startPolling();
  render();
}

export async function joinRoom(code, name) {
  code = code.toUpperCase().trim();
  const r = await loadRoom(code);
  if (!r) { showToast('Nema sobe sa tim kodom.'); return; }
  if (r.phase !== 'lobby') { showToast('Igra je vec pocela u toj sobi.'); return; }
  if (r.players.length >= 4) { showToast('Soba je puna (max 4 igraca).'); return; }
  state.session = { playerId: uid(), name, roomCode: code };
  await saveSession();
  r.players.push({ id: state.session.playerId, name });
  await saveRoom(r);
  state.room = r;
  startPolling();
  render();
}

export async function leaveRoom() {
  clearInterval(state.pollTimer);
  const leftRoom = state.room;
  const leftPlayerId = state.session.playerId;
  localStorage.removeItem('my-remi-session');
  state.session = { playerId: null, name: null, roomCode: null };
  state.room = null;
  history.replaceState(null, '', location.pathname);
  render();
  if (leftRoom && leftPlayerId) {
    leftRoom.players = leftRoom.players.filter(p => p.id !== leftPlayerId);
    await saveRoom(leftRoom);
  }
}

export async function rejoin() {
  const s = await mySession();
  if (!s || !s.roomCode) return false;
  const r = await loadRoom(s.roomCode);
  if (!r) return false;
  if (!r.players.find(p => p.id === s.playerId)) return false;
  state.session = s;
  state.room = r;
  startPolling();
  return true;
}

export function startPolling() {
  clearInterval(state.pollTimer);
  state.pollTimer = setInterval(async () => {
    if (!state.session.roomCode || state.busy) return;
    const r = await loadRoom(state.session.roomCode);
    if (!r) return;
    if (state.session.playerId && !r.players.find(p => p.id === state.session.playerId)) {
      clearInterval(state.pollTimer);
      localStorage.removeItem('my-remi-session');
      state.session = { playerId: null, name: null, roomCode: null };
      state.room = null;
      showToast('Host je resetovao igru. Pridruzi se ponovo preko linka.');
      render();
      return;
    }
    if (r.phase === 'cutting' && r.pendingRound && r.cutRevealedAt && Date.now() - r.cutRevealedAt > CUT_REVEAL_MS) {
      applyPendingRound(r);
      await saveRoom(r);
    }
    // Skip the (expensive, full-DOM-rebuild) render() when nothing actually
    // changed - otherwise every idle poll tears down and recreates every card
    // element, which drops the browser's :hover state on whatever card the
    // mouse happens to be resting on and makes it visibly flicker.
    const changed = JSON.stringify(r) !== JSON.stringify(state.room);
    state.room = r;
    if (changed) render();
  }, 2200);
}
