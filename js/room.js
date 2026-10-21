import { state, APP_VERSION } from './state.js';
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
  await saveRoom(r, 'createRoom');
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
  }, 'join', playerId);
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
    }, 'leave', leftPlayerId);
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
  restoreReloadCarry();
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
      await saveRoom(r, 'dealRoundFallback');
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

// Players who don't know to refresh stay on an old build for the whole
// evening. Every whole-room write stamps its APP_VERSION into room.writeLog,
// so if anyone in the room has written from a newer build, this one reloads
// to pick it up. The hand (cards, order, rows, pin) is all in Firebase, and
// the localStorage session makes rejoin() put the player back in the room;
// what only lives in this tab - the selected cards, which round-end screen
// is up - is carried across in RELOAD_CARRY_KEY. The reload waits while a
// move is in progress or saving, a card is being dragged, or any dialog is
// open (e.g. the joker-position choice), so nothing half-done is lost.
// A few tries per target version, a minute apart: a stale old build that
// comes back from the reload (the CDN not caught up yet) doesn't reload
// again in a loop, but isn't stuck on the old build for the evening either.
const RELOAD_CARRY_KEY = 'remi-reload-carry';
const RELOAD_TRIES_KEY = 'remi-reload-tries';
const RELOAD_MAX_TRIES = 3;
const RELOAD_RETRY_MS = 60000;
let reloadPending = false;

function versionNum(v) {
  const m = /^v?(\d+)\.(\d+)/.exec(v || '');
  return m ? Number(m[1]) * 10000 + Number(m[2]) : 0;
}

function reloadIfOutdated(r) {
  reloadIfNewer((r.writeLog || []).reduce((best, w) => (versionNum(w.v) > versionNum(best) ? w.v : best), APP_VERSION));
}

function reloadIfNewer(newest) {
  if (reloadPending || versionNum(newest) <= versionNum(APP_VERSION)) return;
  let tries;
  try {
    tries = JSON.parse(localStorage.getItem(RELOAD_TRIES_KEY) || 'null');
  } catch (e) { return; }
  if (tries && tries.v === newest && (tries.n >= RELOAD_MAX_TRIES || Date.now() - tries.at < RELOAD_RETRY_MS)) return;
  reloadPending = true;
  refetchBuild().then(() => reloadWhenIdle(newest, tries && tries.v === newest ? tries.n + 1 : 1));
}

// The writeLog check only fires once someone in the room has made a move
// from the new build, and not at all on the home screen, so also ask the
// server directly: every minute, and whenever the tab comes back into view
// (a phone woken up mid-evening). The query string gets past the browser's
// and the CDN's caches.
export function startVersionWatch() {
  const check = async () => {
    if (reloadPending) return;
    try {
      const res = await fetch(`${new URL('./state.js', import.meta.url).href}?v=${Date.now()}`, { cache: 'no-store' });
      const m = /APP_VERSION\s*=\s*'([^']+)'/.exec(await res.text());
      if (m) reloadIfNewer(m[1]);
    } catch (e) {}
  };
  setInterval(check, RELOAD_RETRY_MS);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
}

// GitHub Pages lets browsers keep files for 10 minutes, and a plain reload
// doesn't recheck the modules, so it would just bring the old build back.
// Fetching the page and every module with cache:'reload' first replaces the
// cached copies, so the reload picks up the new ones.
async function refetchBuild() {
  const urls = [location.href, ...performance.getEntriesByType('resource').map(e => e.name)
    .filter(u => { const url = new URL(u); return url.origin === location.origin && !url.search && url.pathname.endsWith('.js'); })];
  await Promise.all(urls.map(u => fetch(u, { cache: 'reload' }).catch(() => {})));
}

function reloadWhenIdle(newest, tryNum) {
  // Also waits out typing (a name or room code on the home screen).
  const typing = document.activeElement && document.activeElement.tagName === 'INPUT';
  if (state.busy || state.handDragActive || state.awaitingWriteId || typing || document.querySelector('.modal-overlay')) {
    setTimeout(() => reloadWhenIdle(newest, tryNum), 500);
    return;
  }
  try {
    localStorage.setItem(RELOAD_TRIES_KEY, JSON.stringify({ v: newest, n: tryNum, at: Date.now() }));
    localStorage.setItem(RELOAD_CARRY_KEY, JSON.stringify({
      roomCode: state.session.roomCode,
      playerId: state.session.playerId,
      at: Date.now(),
      selectedIds: [...state.selectedIds],
      roundEndStage: state.roundEndStage,
      lastRoundEndRound: state.lastRoundEndRound,
      scoreHistoryScrollTop: state.scoreHistoryScrollTop,
    }));
  } catch (e) { return; }
  stopSync();
  location.reload();
}

// Called once from rejoin(): puts back what reloadWhenIdle saved, if it's
// for this player in this room and from just now.
function restoreReloadCarry() {
  let carry;
  try {
    carry = JSON.parse(localStorage.getItem(RELOAD_CARRY_KEY) || 'null');
    localStorage.removeItem(RELOAD_CARRY_KEY);
  } catch (e) { return; }
  if (!carry || carry.roomCode !== state.session.roomCode || carry.playerId !== state.session.playerId
      || Date.now() - carry.at > 60000) return;
  state.selectedIds = new Set(carry.selectedIds || []);
  state.roundEndStage = carry.roundEndStage || 'announce';
  state.lastRoundEndRound = carry.lastRoundEndRound == null ? null : carry.lastRoundEndRound;
  state.scoreHistoryScrollTop = carry.scoreHistoryScrollTop == null ? null : carry.scoreHistoryScrollTop;
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
  reloadIfOutdated(r);
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
