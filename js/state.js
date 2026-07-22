// ===== App state =====
// Single mutable state container. Modules import `state` and read/write its
// fields directly (an exported `let` binding can't be reassigned by importers,
// so a shared object is what lets many modules do `state.room = r` etc).

export const APP_VERSION = 'v0.25';

export const state = {
  session: { playerId: null, name: null, roomCode: null },
  room: null,
  dbUrl: null, // resolved at boot from ?db= query param or localStorage
  pollTimer: null,
  toastTimer: null,
  busy: false, // guards against double actions while writing to storage
  selectedIds: new Set(),
  dismissedQuadAnnouncements: loadDismissedQuadAnnouncements(), // announcement ids this browser has already OK'd
  addToMeldTarget: null, // {ownerIdx, meldIdx} or null
  roundEndStage: 'announce', // local-only sub-stage of room.phase === 'round_end': 'announce' | 'scores'
  lastRoundEndRound: null, // room.round value roundEndStage was last reset for
  handDragActive: false, // true while a hand-card reorder drag is in progress - suppresses poll-triggered re-renders that would tear down the mid-drag DOM
  suppressNextCardClick: false, // set right before a reorder drag's synthetic click fires, so it doesn't also toggle card selection
};

export function resolveDbUrl() {
  const params = new URLSearchParams(location.search);
  const fromQuery = params.get('db');
  if (fromQuery) {
    const decoded = decodeURIComponent(fromQuery);
    localStorage.setItem('remi-db-url', decoded);
    return decoded;
  }
  return localStorage.getItem('remi-db-url');
}

export function loadDismissedQuadAnnouncements() {
  try {
    const raw = localStorage.getItem('remi-dismissed-quads');
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch (e) { return new Set(); }
}
export function saveDismissedQuadAnnouncements() {
  localStorage.setItem('remi-dismissed-quads', JSON.stringify([...state.dismissedQuadAnnouncements]));
}
