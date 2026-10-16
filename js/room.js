import { state } from './state.js';
import { loadRoom, saveRoom, hydrateRoom, roomFingerprint, updateRoomAtomically } from './storage.js';
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

export function mySession() {
  try {
    const raw = localStorage.getItem('my-remi-session');
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}
export function saveSession() {
  localStorage.setItem('my-remi-session', JSON.stringify(state.session));
}
// Forgets which room this browser is in - after leaving it, or when it's gone.
export function clearSession() {
  localStorage.removeItem('my-remi-session');
  state.session = { playerId: null, name: null, roomCode: null };
  state.room = null;
}

export async function createRoom(name) {
  const code = newRoomCode();
  state.session = { playerId: uid(), name, roomCode: code };
  saveSession();
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
  const playerId = uid();
  const { room, error } = await updateRoomAtomically(code, r => {
    if (!r) return 'Nema sobe sa tim kodom.';
    if (r.phase !== 'lobby') return 'Igra je vec pocela u toj sobi.';
    if (r.players.length >= 4) return 'Soba je puna (max 4 igraca).';
    r.players.push({ id: playerId, name });
  });
  if (room === undefined) { showToast('Nije uspelo - proveri internet vezu.'); return; }
  if (error) { showToast(error); return; }
  state.session = { playerId, name, roomCode: code };
  saveSession();
  state.room = room;
  startSync();
  render();
}

export async function leaveRoom() {
  stopSync();
  const leftRoom = state.room;
  const leftPlayerId = state.session.playerId;
  clearSession();
  history.replaceState(null, '', location.pathname);
  render();
  // From a fresh copy: ours may have missed a join (or the start), which a
  // write of it would undo.
  if (leftRoom && leftPlayerId) {
    await updateRoomAtomically(leftRoom.code, r => {
      if (!r) return 'gone';
      r.players = r.players.filter(p => p.id !== leftPlayerId);
    });
  }
}

export async function rejoin() {
  const s = mySession();
  if (!s || !s.roomCode) return false;
  const r = await loadRoom(s.roomCode);
  if (!r) return false;
  if (!r.players.find(p => p.id === s.playerId)) return false;
  state.session = s;
  state.room = r;
  state.roomSnapshot = roomFingerprint(r);
  startSync();
  return true;
}

// ===== Sync =====
// Other players' moves arrive over a Firebase REST stream (EventSource): the
// server pushes every change to the room as it happens. A slow timer backs
// it up - re-fetching only while the stream is down, and running the
// cut-reveal fallback, which is triggered by time passing, not by a change.

const FALLBACK_TICK_MS = 2200;
// Firebase sends a keep-alive every 30s. A stream that's been silent much
// longer than that is dead even if it still reads OPEN (phone slept, network
// switched) - and an OPEN one never triggers the fallback fetch - so it's
// reopened instead of leaving this screen frozen on an old room.
const STREAM_SILENT_MS = 75000;

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
  let lastEventAt = Date.now();
  const stream = new EventSource(`${state.dbUrl}/rooms/${code}.json`);
  const onEvent = (merge) => (e) => {
    lastEventAt = Date.now();
    let msg;
    try { msg = JSON.parse(e.data); } catch (err) { return; }
    raw = applyAtPath(raw, msg.path, msg.data, merge);
    // A structuredClone because hydrateRoom and every action mutate the room
    // in place, while `raw` has to stay exactly what the server sent.
    receiveRoom(raw == null ? null : hydrateRoom(structuredClone(raw)));
  };
  stream.addEventListener('put', onEvent(false));
  stream.addEventListener('patch', onEvent(true));
  stream.addEventListener('keep-alive', () => { lastEventAt = Date.now(); });
  state.roomStream = stream;

  state.pollTimer = setInterval(async () => {
    if (!state.session.roomCode) return;
    if (Date.now() - lastEventAt > STREAM_SILENT_MS) { startSync(); return; }
    const r = state.room;
    if (!state.busy && r && r.phase === 'cutting' && r.pendingRound && r.cutRevealedAt
        && Date.now() - r.cutRevealedAt > CUT_REVEAL_MS) {
      state.busy = true;
      applyPendingRound(r);
      await saveRoom(r);
      state.busy = false;
      render();
    }
    if (stream.readyState !== EventSource.OPEN || state.echoLost) {
      state.echoLost = false;
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
    clearSession();
    showToast('Host je resetovao igru. Pridruzi se ponovo preko linka.');
    render();
    return;
  }
  // We saved and Firebase hasn't sent that write back yet, so this is the
  // room from before it - showing it would make our move vanish until the
  // next update. Our own echo (or saveRoom giving up on it) ends the wait.
  // The echo is NOT necessarily what's on screen: a hand-layout PATCH comes
  // back merged onto whatever else the server has - e.g. the other player's
  // discard that arrived (and was skipped here) while we waited - so it goes
  // through the normal compare-and-render below like any other room.
  // Otherwise that discard is never shown and both players see it as the
  // other's turn.
  if (state.awaitingWriteId) {
    if (r.writeId !== state.awaitingWriteId) return;
    state.awaitingWriteId = null;
  }
  // Skip the (expensive, full-DOM-rebuild) render() when nothing actually
  // changed - otherwise every no-op update tears down and recreates every
  // card element, which drops the browser's :hover state on whatever card
  // the mouse happens to be resting on and makes it visibly flicker.
  const snapshot = roomFingerprint(r);
  const changed = snapshot !== state.roomSnapshot;
  state.roomSnapshot = snapshot;
  state.room = r;
  if (changed) render();
}
