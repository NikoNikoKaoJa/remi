import { state } from './state.js';
import { loadRoom, saveRoom, hydrateRoom } from './storage.js';
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
  startSync();
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
  startSync();
  render();
}

export async function leaveRoom() {
  stopSync();
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
  state.roomSnapshot = JSON.stringify(r);
  startSync();
  return true;
}

// ===== Sync =====
// Other players' moves arrive over a Firebase REST stream (EventSource): the
// server pushes every change to the room as it happens. A slow timer backs
// it up - re-fetching only while the stream is down, and running the
// cut-reveal fallback, which is triggered by time passing, not by a change.

const FALLBACK_TICK_MS = 2200;

export function stopSync() {
  clearInterval(state.pollTimer);
  if (state.roomStream) { state.roomStream.close(); state.roomStream = null; }
}

export function startSync() {
  stopSync();
  const code = state.session.roomCode;
  // The stream sends the whole room first ('put' at "/"), then each change
  // as a 'put' (replace) or 'patch' (merge) at a path inside it; `raw` is the
  // room as Firebase has it, kept up to date from those.
  let raw;
  const stream = new EventSource(`${state.dbUrl}/rooms/${code}.json`);
  const onEvent = (merge) => (e) => {
    let msg;
    try { msg = JSON.parse(e.data); } catch (err) { return; }
    raw = applyAtPath(raw, msg.path, msg.data, merge);
    // A structuredClone because hydrateRoom and every action mutate the room
    // in place, while `raw` has to stay exactly what the server sent.
    receiveRoom(raw == null ? null : hydrateRoom(structuredClone(raw)));
  };
  stream.addEventListener('put', onEvent(false));
  stream.addEventListener('patch', onEvent(true));
  state.roomStream = stream;

  state.pollTimer = setInterval(async () => {
    if (!state.session.roomCode) return;
    const r = state.room;
    if (!state.busy && r && r.phase === 'cutting' && r.pendingRound && r.cutRevealedAt
        && Date.now() - r.cutRevealedAt > CUT_REVEAL_MS) {
      state.busy = true;
      applyPendingRound(r);
      await saveRoom(r);
      state.busy = false;
      render();
    }
    if (stream.readyState !== EventSource.OPEN) {
      const loaded = await loadRoom(code);
      if (loaded !== undefined) receiveRoom(loaded); // undefined = request failed - try again next tick
    }
  }, FALLBACK_TICK_MS);
}

// Sets `value` at a Firebase path ("/", "/hands/pl_x", ...) inside `obj`
// (null deletes). A 'patch' is a set of such writes, keyed by path relative
// to its own. Returns the (possibly new) root.
function applyAtPath(obj, path, value, merge) {
  if (merge) {
    Object.entries(value || {}).forEach(([k, v]) => { obj = applyAtPath(obj, `${path}/${k}`, v, false); });
    return obj;
  }
  const keys = path.split('/').filter(Boolean);
  if (keys.length === 0) return value;
  const root = obj || {};
  let node = root;
  keys.slice(0, -1).forEach(k => { if (node[k] == null || typeof node[k] !== 'object') node[k] = {}; node = node[k]; });
  const last = keys[keys.length - 1];
  if (value == null) delete node[last];
  else node[last] = value;
  return root;
}

// A move already on screen never reached Firebase (see commitMove in
// js/actions.js): put the screen back to the room as the server has it. If
// that fetch fails too, the stream (or fallback poll) does it once the
// connection is back - saveRoom has stopped waiting for its echo either way.
export async function resyncAfterFailedSave() {
  if (!state.session.roomCode) return;
  showToast('Potez nije sacuvan - proveri internet vezu.');
  const loaded = await loadRoom(state.session.roomCode);
  if (loaded !== undefined) receiveRoom(loaded);
}

// Applies a room that just arrived from Firebase (stream or fallback poll).
function receiveRoom(r) {
  if (state.session.roomCode == null) return;
  // Mid-action or mid-drag: the room object is being worked on (or the hand
  // DOM is mid-gesture), so hold the update and look at it again shortly.
  // Only the newest one is kept - each carries the whole room.
  if (state.busy || state.handDragActive) {
    state.deferredRoom = r;
    clearTimeout(state.deferredRoomTimer);
    state.deferredRoomTimer = setTimeout(() => {
      const next = state.deferredRoom;
      state.deferredRoom = undefined;
      if (next !== undefined) receiveRoom(next);
    }, 150);
    return;
  }
  if (r === null || (state.session.playerId && !r.players.find(p => p.id === state.session.playerId))) {
    stopSync();
    localStorage.removeItem('my-remi-session');
    state.session = { playerId: null, name: null, roomCode: null };
    state.room = null;
    showToast('Host je resetovao igru. Pridruzi se ponovo preko linka.');
    render();
    return;
  }
  // We saved and Firebase hasn't sent that write back yet, so this is the
  // room from before it - showing it would make our move vanish until the
  // next update. Our own echo (or saveRoom giving up on it) ends the wait.
  // The echo itself is what's already on screen, so it only resets the
  // baseline (Firebase reorders keys, so its JSON differs from what we sent).
  if (state.awaitingWriteId) {
    if (r.writeId !== state.awaitingWriteId) return;
    state.awaitingWriteId = null;
    state.roomSnapshot = JSON.stringify(r);
    return;
  }
  // Skip the (expensive, full-DOM-rebuild) render() when nothing actually
  // changed - otherwise every no-op update tears down and recreates every
  // card element, which drops the browser's :hover state on whatever card
  // the mouse happens to be resting on and makes it visibly flicker.
  const snapshot = JSON.stringify(r);
  const changed = snapshot !== state.roomSnapshot;
  state.roomSnapshot = snapshot;
  state.room = r;
  if (changed) render();
}
