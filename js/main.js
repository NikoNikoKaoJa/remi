import { state, resolveDbUrl } from './state.js';
import { mySession, rejoin } from './room.js';
import { render } from './render.js';

// ===== Boot =====
(async function boot() {
  state.dbUrl = resolveDbUrl();
  if (state.dbUrl) {
    const roomFromLink = new URLSearchParams(location.search).get('room');
    const s = await mySession();
    const linkPointsElsewhere = roomFromLink && s && s.roomCode
      && s.roomCode.toUpperCase() !== roomFromLink.toUpperCase();
    const ok = linkPointsElsewhere ? false : await rejoin();
    render();
    if (!ok) render();
  } else {
    render();
  }
})();
