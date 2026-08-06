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
export async function saveRoom(r) {
  if (!state.dbUrl) return;
  r.updatedAt = Date.now();
  const body = JSON.stringify(r);
  // Doubles as the baseline the polling loop diffs against (see startPolling
  // in js/room.js), so the poll right after our own write sees "unchanged"
  // and skips a pointless full re-render.
  state.roomSnapshot = body;
  await fetch(`${state.dbUrl}/rooms/${r.code}.json`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body,
  });
}

export async function deleteRoom(code) {
  if (!state.dbUrl) return;
  await fetch(`${state.dbUrl}/rooms/${code}.json`, { method: 'DELETE' });
}
