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
  const pending = state.room.quadAnnouncements.filter(a => !state.dismissedQuadAnnouncements.has(a.id));
  if (pending.length === 0) return;
  // Once the round is over the swept cards can't matter to anyone, so an
  // announcement nobody got round to dismissing is just noise - retire it
  // silently instead of popping it over the winner/score screens (or, worse,
  // greeting everyone with it at the start of the next round).
  if (state.room.phase !== 'playing') {
    pending.forEach(a => state.dismissedQuadAnnouncements.add(a.id));
    saveDismissedQuadAnnouncements();
    return;
  }
  showQuadAnnouncementModal(pending[0]);
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
// winnerId (round-end screen only - the "Stanje" modal passes nothing) marks
// the winner: their name in the header, and their new total on the LAST row,
// which is the round that just finished. Nothing else - the older rows are
// history and say nothing about who just won.
export function buildScoreHistoryTable(room, winnerId = null) {
  const table = document.createElement('table');
  table.className = 'score-table score-history-table' + (winnerId ? ' round-end-history-winner' : '');
  const n = room.players.length;
  const history = room.scoreHistory || [];
  const cls = p => (p.id === winnerId ? ' class="winner-col"' : '');
  const headRow = document.createElement('tr');
  headRow.innerHTML = room.players.map(p => `<th${cls(p)}>${p.name}</th>`).join('');
  table.appendChild(headRow);
  history.forEach((entry, i) => {
    const last = i === history.length - 1;
    const tr = document.createElement('tr');
    if (n > 0 && entry.round > 1 && (entry.round - 1) % n === 0) tr.classList.add('circle-start');
    // The number goes in its own <span class="num"> so CSS can right-align the
    // digits inside a fixed-width box that stays centered under the name.
    tr.innerHTML = room.players.map(p => `<td${last ? cls(p) : ''}><span class="num">${entry.totals[p.id] ?? 0}</span></td>`).join('');
    table.appendChild(tr);
  });
  return table;
}

// The same history table, but split into a fixed names row plus a separately
// scrolling body - for screens where the history can outgrow the space (the
// round-end scores screen). Returns { block, bodyWrap } so the caller can
// manage bodyWrap's scroll position.
//
// Why a split table rather than `position:sticky` on the <th>: a sticky header
// scrolls rows underneath itself, so it needs an opaque background of its own,
// and the panel is a translucent gradient over the felt - any flat colour shows
// as a visible band. Lifting the row out of the scrolling box means it sits on
// the panel like ordinary text, with no background to match.
export function buildScoreHistoryBlock(room, winnerId = null) {
  // Measure what the browser picks for each column with the real content, so
  // the two tables can be locked to identical widths.
  const probe = document.createElement('div');
  probe.className = 'score-history-probe';
  const table = buildScoreHistoryTable(room, winnerId);
  probe.appendChild(table);
  document.body.appendChild(probe);
  const widths = [...table.rows[0].cells].map(c => c.getBoundingClientRect().width);
  const tableWidth = table.getBoundingClientRect().width;
  probe.remove();

  const headTable = document.createElement('table');
  headTable.className = table.className + ' hist-head';
  headTable.appendChild(table.rows[0]); // moves the names row out of the body table
  table.classList.add('hist-body');

  const colgroup = () => {
    const cg = document.createElement('colgroup');
    widths.forEach(w => {
      const col = document.createElement('col');
      col.style.width = w + 'px';
      cg.appendChild(col);
    });
    return cg;
  };
  [headTable, table].forEach(t => {
    t.insertBefore(colgroup(), t.firstChild);
    t.style.tableLayout = 'fixed';
    t.style.width = tableWidth + 'px';
    // Both tables must start at the same left edge; .round-end-history-winner
    // centres itself, which would offset them from each other.
    t.style.marginLeft = '0';
    t.style.marginRight = '0';
  });

  const bodyWrap = document.createElement('div');
  bodyWrap.className = 'hist-body-wrap';
  bodyWrap.appendChild(table);

  const block = document.createElement('div');
  block.className = 'hist-block';
  block.style.width = tableWidth + 'px';
  block.appendChild(headTable);
  block.appendChild(bodyWrap);

  return { block, bodyWrap, tableWidth };
}

// Gives the scrollbar a strip of its own to the right of the table, so it can't
// shrink the body table and shift its columns out of line with the names row.
// Must run after the block is in the document; overlay scrollbars measure 0 and
// cost nothing.
export function reserveScrollbarStrip(block, bodyWrap, tableWidth) {
  const sbw = bodyWrap.offsetWidth - bodyWrap.clientWidth;
  if (sbw > 0) {
    block.style.width = (tableWidth + sbw) + 'px';
    bodyWrap.style.width = (tableWidth + sbw) + 'px';
  }
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
    // label is either plain text or a DOM node (e.g. a row of real cards
    // built by buildMeldGroupEl/buildPartitionPreviewEl) to show instead.
    if (opt.label instanceof Node) {
      b.style.display = 'flex';
      b.style.justifyContent = 'center';
      b.style.padding = '12px 10px';
      b.appendChild(opt.label);
    } else {
      b.textContent = opt.label;
      b.style.display = 'block';
    }
    b.style.width = '100%';
    b.style.marginBottom = '8px';
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

// Renders one meld option as real mini cards, in the exact order the caller
// wants them shown (e.g. via engine.js's sortMeldForDisplay/runWindowPreviewCards)
// - used as a showChoiceModal option's `label` instead of a text description.
export function buildMeldGroupEl(cardsInDisplayOrder) {
  const cardsDiv = document.createElement('div');
  cardsDiv.className = 'meld-cards';
  cardsInDisplayOrder.forEach(c => cardsDiv.appendChild(cardEl(c, { mini: true })));
  const wrap = document.createElement('div');
  wrap.className = 'meld-group';
  wrap.appendChild(cardsDiv);
  return wrap;
}

// Renders a full partition option (several meld groups side by side).
export function buildPartitionPreviewEl(groupsInDisplayOrder) {
  const wrap = document.createElement('div');
  wrap.style.display = 'flex';
  wrap.style.flexWrap = 'wrap';
  wrap.style.gap = '10px';
  wrap.style.justifyContent = 'center';
  groupsInDisplayOrder.forEach(cards => wrap.appendChild(buildMeldGroupEl(cards)));
  return wrap;
}
