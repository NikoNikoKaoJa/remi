import { state } from './state.js';

// ===== External storage (Firebase Realtime Database REST API) =====
// No Claude account needed - uses a free Firebase project's public REST endpoint instead.

// Returns the room, `null` if it's confirmed gone (deleted / never existed),
// or `undefined` if the request itself failed (network blip) - callers that
// need to tell "room was deleted" apart from "couldn't check right now"
// (e.g. the polling loop deciding whether to kick a player out) rely on that
// distinction.
export async function loadRoom(code) {
  if (!state.dbUrl) return undefined;
  try {
    const res = await fetch(`${state.dbUrl}/rooms/${code}.json`);
    if (!res.ok) return undefined;
    const data = await res.json();
    return data ? hydrateRoom(data) : null;
  } catch (e) { return undefined; }
}

// Firebase Realtime Database silently converts empty objects/arrays ({} or [])
// to null when saving, so every always-present collection has to be restored
// after a load. ANY new field of that kind must be added here - this is also
// what applyPendingRound (js/actions.js) re-defaults a round-tripped
// pendingRound with, so the two can't drift apart.
export const ROOM_COLLECTION_DEFAULTS = {
  scores: () => ({}),
  scoreHistory: () => [],
  players: () => [],
  hands: () => ({}),
  stock: () => [],
  discard: () => [],
  melds: () => [],
  openedPlayers: () => [],
  turnMeldIds: () => [],
  roundWinMeldIds: () => [],
  log: () => [],
  quadAnnouncements: () => [],
  readyForNextRound: () => [],
  handOrders: () => ({}),
  pinnedCardIds: () => ({}),
};

// Fills in whichever of the above `keys` (default: all of them) are missing.
export function applyCollectionDefaults(obj, keys = Object.keys(ROOM_COLLECTION_DEFAULTS)) {
  keys.forEach(k => { if (!obj[k]) obj[k] = ROOM_COLLECTION_DEFAULTS[k](); });
  return obj;
}

export function hydrateRoom(r) {
  applyCollectionDefaults(r);
  r.players.forEach(p => { if (!r.hands[p.id]) r.hands[p.id] = []; });
  return r;
}
// Moves are shown before they're saved (see commitMove in js/actions.js), so
// a player can make the next move while the last one is still uploading.
// Each room's writes therefore go out one at a time, in order - two PUTs in
// flight at once could land the wrong way round - and a queued write that a
// newer one has already replaced is skipped, since every write carries the
// whole room.
const saveQueues = {};
const latestWriteIds = {};

// Resolves true once the room is saved (or a newer write took this one's
// place), false if this was the newest write and it didn't make it.
export function saveRoom(r) {
  if (!state.dbUrl) return Promise.resolve(true);
  r.updatedAt = Date.now();
  // Tags this write so incoming updates can be told apart from the room as
  // it was BEFORE it (see receiveRoom in js/room.js): until our own write
  // comes back from Firebase, anything else that arrives is older than what
  // we already show, and applying it would briefly undo our move.
  const writeId = Math.random().toString(36).slice(2, 10);
  r.writeId = writeId;
  state.awaitingWriteId = writeId;
  const body = JSON.stringify(r);
  // Doubles as the baseline the sync loop diffs against (see receiveRoom),
  // so our own write coming back doesn't trigger a pointless re-render.
  state.roomSnapshot = body;
  // Stop waiting for the echo if the write failed (the server still has the
  // older room, so it's the truth now) or it never shows up - e.g. another
  // player overwrote it before our copy of the stream saw it.
  const giveUp = () => { if (state.awaitingWriteId === writeId) state.awaitingWriteId = null; };
  const code = r.code;
  latestWriteIds[code] = writeId;
  const send = async () => {
    if (latestWriteIds[code] !== writeId) return true;
    try {
      const res = await fetch(`${state.dbUrl}/rooms/${code}.json`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body,
      });
      if (res.ok) { setTimeout(giveUp, 5000); return true; }
    } catch (e) { /* network error - same as a refused write */ }
    giveUp();
    return latestWriteIds[code] !== writeId;
  };
  const result = (saveQueues[code] || Promise.resolve()).then(send);
  saveQueues[code] = result;
  return result;
}

export async function deleteRoom(code) {
  if (!state.dbUrl) return;
  await fetch(`${state.dbUrl}/rooms/${code}.json`, { method: 'DELETE' });
}
