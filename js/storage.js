import { state } from './state.js';

// ===== External storage (Firebase Realtime Database REST API) =====
// No Claude account needed - uses a free Firebase project's public REST endpoint instead.

export async function loadRoom(code) {
  if (!state.dbUrl) return null;
  try {
    const res = await fetch(`${state.dbUrl}/rooms/${code}.json`);
    if (!res.ok) return null;
    const data = await res.json();
    return data ? hydrateRoom(data) : null;
  } catch (e) { return null; }
}

// Firebase Realtime Database silently converts empty objects/arrays ({} or [])
// to null when saving. This restores sane defaults after loading so the rest
// of the app never has to special-case null vs {} vs [].
export function hydrateRoom(r) {
  if (!r.scores) r.scores = {};
  if (!r.scoreHistory) r.scoreHistory = [];
  if (!r.players) r.players = [];
  if (!r.hands) r.hands = {};
  if (!r.stock) r.stock = [];
  if (!r.discard) r.discard = [];
  if (!r.melds) r.melds = [];
  if (!r.openedPlayers) r.openedPlayers = [];
  if (!r.log) r.log = [];
  if (!r.quadAnnouncements) r.quadAnnouncements = [];
  if (!r.readyForNextRound) r.readyForNextRound = [];
  if (!r.handOrders) r.handOrders = {};
  r.players.forEach(p => { if (!r.hands[p.id]) r.hands[p.id] = []; });
  return r;
}
export async function saveRoom(r) {
  if (!state.dbUrl) return;
  r.updatedAt = Date.now();
  await fetch(`${state.dbUrl}/rooms/${r.code}.json`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(r),
  });
}
