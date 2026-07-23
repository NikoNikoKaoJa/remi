import { state, saveDismissedQuadAnnouncements } from './state.js';
import { cardEl, rankLabel } from './cards.js';

// ===== Toast / modal DOM helpers =====

export function showToast(msg, ms) {
  const el = document.getElementById('toast');
  if (el) el.remove();
  const t = document.createElement('div');
  t.id = 'toast'; t.className = 'toast'; t.textContent = msg;
  // On the game screen, anchor the toast just above the talon/otpad piles
  // (where attention already is) instead of the page's fixed bottom edge,
  // which is easy to miss. Other screens (lobby, etc.) have no anchor, so
  // they keep the old fixed-to-viewport placement.
  const anchor = document.getElementById('toast-anchor');
  if (anchor) anchor.appendChild(t);
  else { t.classList.add('toast-fixed'); document.getElementById('remi-root').appendChild(t); }
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => t.remove(), ms || 2600);
}

export function checkQuadAnnouncement() {
  if (!state.room || !state.room.quadAnnouncements) return;
  const pending = state.room.quadAnnouncements.find(a => !state.dismissedQuadAnnouncements.has(a.id));
  if (pending) showQuadAnnouncementModal(pending);
}

export function showQuadAnnouncementModal(announcement) {
  if (document.getElementById('quad-modal')) return; // already showing one
  const overlay = document.createElement('div');
  overlay.id = 'quad-modal';
  overlay.className = 'modal-overlay';
  const box = document.createElement('div');
  box.className = 'modal-box';
  const h = document.createElement('h3');
  h.textContent = 'Cetiri karte uklonjene sa stola!';
  h.style.marginBottom = '10px';
  box.appendChild(h);
  const p = document.createElement('div');
  p.className = 'small';
  p.style.marginBottom = '14px';
  p.textContent = `Kompletirana grupa (${rankLabel(announcement.rank)}) je sklonjena sa stola i vise se ne moze koristiti.`;
  box.appendChild(p);
  const cardsRow = document.createElement('div');
  cardsRow.style.display = 'flex';
  cardsRow.style.justifyContent = 'center';
  cardsRow.style.gap = '8px';
  cardsRow.style.marginBottom = '18px';
  announcement.cards.forEach(c => {
    const cd = cardEl(c, {});
    cd.classList.add('quad-highlight');
    cardsRow.appendChild(cd);
  });
  box.appendChild(cardsRow);
  const okBtn = document.createElement('button');
  okBtn.className = 'btn btn-gold';
  okBtn.textContent = 'OK';
  okBtn.style.width = '100%';
  okBtn.onclick = () => {
    state.dismissedQuadAnnouncements.add(announcement.id);
    saveDismissedQuadAnnouncements();
    overlay.remove();
    checkQuadAnnouncement();
  };
  box.appendChild(okBtn);
  overlay.appendChild(box);
  document.getElementById('remi-root').appendChild(overlay);
}

// Builds the "paper scoresheet" style table: one row per finished round, one
// column per player, showing the CUMULATIVE total after that round (not the
// round's delta - matches how players track scores by hand on paper). A
// thicker top border marks the start of a new "krug" (every player has dealt
// once) - purely informational, no effect on scoring.
export function buildScoreHistoryTable(room) {
  const table = document.createElement('table');
  table.className = 'score-table score-history-table';
  const n = room.players.length;
  const headRow = document.createElement('tr');
  headRow.innerHTML = '<th>#</th>' + room.players.map(p => `<th>${p.name}</th>`).join('');
  table.appendChild(headRow);
  (room.scoreHistory || []).forEach(entry => {
    const tr = document.createElement('tr');
    if (n > 0 && entry.round > 1 && (entry.round - 1) % n === 0) tr.classList.add('circle-start');
    tr.innerHTML = `<td class="name round-num">${entry.round}</td>` +
      room.players.map(p => `<td>${entry.totals[p.id] ?? 0}</td>`).join('');
    table.appendChild(tr);
  });
  return table;
}

export function showScoreHistoryModal(room) {
  const existing = document.getElementById('score-history-modal');
  if (existing) existing.remove();
  const overlay = document.createElement('div');
  overlay.id = 'score-history-modal';
  overlay.className = 'modal-overlay';
  const box = document.createElement('div');
  box.className = 'modal-box modal-box-wide';
  const h = document.createElement('h3');
  h.textContent = 'Rezultat';
  h.style.marginBottom = '10px';
  box.appendChild(h);
  const wrap = document.createElement('div');
  wrap.className = 'score-history-wrap';
  wrap.appendChild(buildScoreHistoryTable(room));
  box.appendChild(wrap);
  const closeBtn = document.createElement('button');
  closeBtn.className = 'btn btn-gold';
  closeBtn.textContent = 'Zatvori';
  closeBtn.style.width = '100%';
  closeBtn.style.marginTop = '14px';
  closeBtn.onclick = () => overlay.remove();
  box.appendChild(closeBtn);
  overlay.appendChild(box);
  document.getElementById('remi-root').appendChild(overlay);
}

export function showChoiceModal(title, options, onPick) {
  const existing = document.getElementById('choice-modal');
  if (existing) existing.remove();
  const overlay = document.createElement('div');
  overlay.id = 'choice-modal';
  overlay.className = 'modal-overlay';
  const box = document.createElement('div');
  box.className = 'modal-box';
  const h = document.createElement('h3');
  h.textContent = title;
  h.style.marginBottom = '14px';
  box.appendChild(h);
  options.forEach(opt => {
    const b = document.createElement('button');
    b.className = 'btn btn-gold';
    b.textContent = opt.label;
    b.style.width = '100%';
    b.style.marginBottom = '8px';
    b.style.display = 'block';
    b.onclick = () => { overlay.remove(); onPick(opt); };
    box.appendChild(b);
  });
  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'btn btn-ghost';
  cancelBtn.textContent = 'Otkazi';
  cancelBtn.style.width = '100%';
  cancelBtn.onclick = () => overlay.remove();
  box.appendChild(cancelBtn);
  overlay.appendChild(box);
  document.getElementById('remi-root').appendChild(overlay);
}
