// ===== App state =====
// Single mutable state container. Modules import `state` and read/write its
// fields directly (an exported `let` binding can't be reassigned by importers,
// so a shared object is what lets many modules do `state.room = r` etc).

export const APP_VERSION = 'v1.19';

export const state = {
  session: { playerId: null, name: null, roomCode: null },
  room: null,
  dbUrl: null, // resolved at boot from ?db= query param or localStorage
  pollTimer: null, // sync loop's fallback timer (fallback poll + cut-reveal check) - see startSync in js/room.js
  roomStream: null, // EventSource on the room in Firebase - the primary way other players' moves arrive
  roomSnapshot: null, // JSON of the room as last saved/loaded - the sync loop diffs against it to skip no-op re-renders
  deferredRoom: undefined, // newest incoming room held back while busy/mid-drag - receiveRoom retries it shortly
  deferredRoomTimer: null,
  awaitingWriteId: null, // writeId of our last save until Firebase echoes it back; older incoming rooms are ignored meanwhile
  toastTimer: null,
  busy: false, // guards against double actions while writing to storage
  selectedIds: new Set(),
  dismissedQuadAnnouncements: loadDismissedQuadAnnouncements(), // announcement ids this browser has already OK'd
  roundEndStage: 'announce', // local-only sub-stage of room.phase === 'round_end': 'announce' | 'scores'
  lastRoundEndRound: null, // room.round value roundEndStage was last reset for
  // Where the player scrolled the round-end history table, preserved across the
  // polling re-renders of that screen. null = not scrolled yet, so open on the
  // newest round (reset per round in renderRoundEnd).
  scoreHistoryScrollTop: null,
  handDragActive: false, // true while a hand-card reorder drag is in progress - suppresses poll-triggered re-renders that would tear down the mid-drag DOM
  suppressNextCardClick: false, // set right before a reorder drag's synthetic click fires, so it doesn't also toggle card selection
};

// The game's own Firebase DB, so nobody has to paste it on first visit. A ?db=
// link or a previously saved URL still takes precedence.
export const DEFAULT_DB_URL = 'https://remi-8ed0e-default-rtdb.firebaseio.com';

export function resolveDbUrl() {
  const params = new URLSearchParams(location.search);
  const fromQuery = params.get('db');
  if (fromQuery) {
    const decoded = decodeURIComponent(fromQuery);
    localStorage.setItem('remi-db-url', decoded);
    return decoded;
  }
  return localStorage.getItem('remi-db-url') || DEFAULT_DB_URL;
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
