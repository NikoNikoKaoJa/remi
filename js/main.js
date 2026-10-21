import { state, resolveDbUrl } from './state.js';
import { mySession, rejoin, startVersionWatch } from './room.js';
import { render } from './render.js';

// ===== Boot =====
(async function boot() {
  state.dbUrl = resolveDbUrl();
  if (state.dbUrl) {
    const roomFromLink = new URLSearchParams(location.search).get('room');
    const s = mySession();
    const linkPointsElsewhere = roomFromLink && s && s.roomCode
      && s.roomCode.toUpperCase() !== roomFromLink.toUpperCase();
    if (!linkPointsElsewhere) await rejoin();
  }
  render();
  startVersionWatch();
  // Makes every load check the server for newer files instead of waiting out
  // GitHub Pages' 10-minute cache (see sw.js).
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register(new URL('../sw.js', import.meta.url)).catch(() => {});
  }
})();
