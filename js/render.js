import { state, APP_VERSION } from './state.js';
import { resolveMeld, maliHandValue, cardValueStandard, cardValueMaliHand, computeSelectedSum, sortMeldForDisplay } from './engine.js';
import { cardEl, cardBackEl, sortHand, orderHand, wrapHoverSlot } from './cards.js';
import { saveRoom } from './storage.js';
import { showToast, checkQuadAnnouncement, showScoreHistoryModal, buildScoreHistoryBlock, reserveScrollbarStrip } from './ui.js';
import {
  isMyTurn, myHand, getSelectedCards,
  actionDrawStock, actionTryBottomCard, actionDrawDiscard, actionReplaceJoker,
  actionAddToMeld, actionLayMultipleSelected, actionDiscard,
  findHandOption, actionDeclareHand,
  hostStartGame, hostResetGame,
  actionReadyForScores, actionReadyForNextRound, actionForceNextRound,
  pendingJokerIds,
} from './actions.js';
import { createRoom, joinRoom, leaveRoom } from './room.js';

// ===== Rendering =====
export function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

// Top-right corner badge on every screen's panel - panel needs position:relative (card-panel has it).
function versionBadge() { return el('div', 'version-badge', APP_VERSION); }

// Serbian noun agreement for a card count: 1 -> "1 karta", 2-4 -> "3 karte",
// everything else (0 and 5+) -> "karata". Counts here never exceed 15, so the
// "21 karta"/"22 karte" wrap-around cases can't come up.
function cardCountLabel(n) {
  if (n === 1) return '1 karta';
  if (n >= 2 && n <= 4) return n + ' karte';
  return n + ' karata';
}

// ===== Hand card drag-to-reorder =====
// Pointer Events (not HTML5 drag-and-drop, which is unreliable on mobile
// Safari/Chrome - players mostly join from phones) power a manual reorder:
// press-and-drag a card past a small threshold to pick it up; a floating
// "ghost" clone follows the finger/cursor while the real node is dimmed and
// physically moved among its flex siblings on every move, so the browser's
// own flex-wrap reflow does the "make room" shifting for free. On release,
// the new left-to-right DOM order is saved to room.handOrders so it survives
// reconnects/other devices (see orderHand in cards.js for how it's applied).
const HAND_DRAG_THRESHOLD = 8;

// ===== Drag to play =====
// A drag can END somewhere other than where it began: a hand card dropped on
// the otpad (= discard it) or on a meld group (= krpljenje, add it to the
// meld), or the card under the talon dropped on the hand row (= take it for a
// hand). A render* function marks such an element by calling markDropTarget()
// on it; the drag looks for the nearest marked ancestor under the pointer and,
// if it finds one, runs its handler. The buttons and clicks ("Baci", clicking
// a meld group with cards selected, clicking the card under the talon) still
// do exactly what they did - dragging is an extra route, not a replacement.
//
// Targets are typed by which drag they accept: the hand row accepts a card
// coming off a pile, and must NOT swallow a hand card being dropped back into
// its own row (that's an ordinary reorder).
const DROP_FROM_HAND = 'from-hand';
const DROP_FROM_PILE = 'from-pile';

function markDropTarget(node, kind, onDrop) {
  node._remiDrop = { kind, onDrop };
  node.classList.add('drop-target');
}

function findDropTarget(x, y, kind) {
  let hit = document.elementFromPoint(x, y);
  while (hit) {
    if (hit._remiDrop && hit._remiDrop.kind === kind) return hit;
    hit = hit.parentElement;
  }
  return null;
}

// The id of the joker in `meld` that `card` is the real card for, or null if
// it isn't one. Mirrors actionReplaceJoker's own checks exactly, so a "yes"
// here can't turn into a toast there: a run's joker slot is one rank+suit, a
// set's is a rank plus a suit not already down, and a set's joker has no
// settled identity until 3 real cards are on the table.
function jokerSlotFilledBy(meld, card) {
  if (!card || card.joker) return null;
  const resolved = resolveMeld(meld.cards);
  if (!resolved) return null;
  const real = meld.cards.filter(c => !c.joker);
  if (resolved.type === 'set' && real.length < 3) return null;
  for (const item of resolved.cards) {
    if (!item.isJoker) continue;
    if (item.substitutes.rank !== card.rank) continue;
    if (resolved.type === 'set') {
      if (real.some(c => c.suit === card.suit)) continue;
    } else if (item.substitutes.suit !== card.suit) {
      continue;
    }
    return item.jokerCardId;
  }
  return null;
}

// Drops a single hand card on a meld. actionAddToMeld/actionReplaceJoker both
// work off the current selection, so the dragged card becomes the selection
// for the call - which is also what the player just expressed by dragging it.
//
// A card dropped anywhere on a meld it's the joker's real card for means
// "take the joker" - that's what dragging it there is for, and hitting the
// joker itself is not something anyone can aim at while the dragged ghost is
// covering it. Anything else is an ordinary krpljenje.
//
// This deliberately gives up one rare play on the drag path: extending a run
// with the very card its joker stands for, letting the joker slide to an end
// (5-[6]-7 + the real 6 -> 5-6-7-[4 or 8]). That's still reachable by
// clicking the meld group with the card selected, which is unchanged.
async function dropCardOnMeld(cardId, ownerId, meldIdx) {
  state.selectedIds = new Set([cardId]);
  render();
  const meld = state.room.melds[meldIdx];
  const card = myHand().find(c => c.id === cardId);
  const jokerCardId = meld ? jokerSlotFilledBy(meld, card) : null;
  if (jokerCardId) {
    await actionReplaceJoker(meldIdx, jokerCardId);
    return;
  }
  await actionAddToMeld(ownerId, meldIdx);
}

// The other direction: drag a card off a pile and drop it on the hand row to
// take it. Simpler than the hand drag - nothing reorders, the card either
// lands on the hand (run `onDrop`) or the drag is a no-op - but it uses the
// same ghost so both gestures feel alike. `node` keeps its own onclick; a
// drag sets a short-lived flag so the click that follows pointerup doesn't
// fire the action a second time.
function enablePileDrag(node, onDrop) {
  let startX = 0, startY = 0, dragging = false, ghost = null, offsetX = 0, offsetY = 0, pointerId = null;
  let hoverTarget = null;

  function setHoverTarget(t) {
    if (hoverTarget === t) return;
    if (hoverTarget) hoverTarget.classList.remove('drop-hover');
    hoverTarget = t;
    if (hoverTarget) hoverTarget.classList.add('drop-hover');
  }

  node.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    startX = e.clientX;
    startY = e.clientY;
    dragging = false;
    pointerId = e.pointerId;
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  });

  function onMove(e) {
    if (e.pointerId !== pointerId) return;
    const dx = e.clientX - startX, dy = e.clientY - startY;
    if (!dragging) {
      if (Math.abs(dx) < HAND_DRAG_THRESHOLD && Math.abs(dy) < HAND_DRAG_THRESHOLD) return;
      dragging = true;
      state.handDragActive = true; // same reason as the hand drag: no poll re-render mid-drag
      const rect = node.getBoundingClientRect();
      offsetX = startX - rect.left;
      offsetY = startY - rect.top;
      ghost = node.cloneNode(true);
      ghost.style.position = 'fixed';
      ghost.style.left = rect.left + 'px';
      ghost.style.top = rect.top + 'px';
      ghost.style.width = rect.width + 'px';
      ghost.style.height = rect.height + 'px';
      ghost.style.margin = '0';
      ghost.style.pointerEvents = 'none';
      ghost.style.zIndex = '1000';
      ghost.style.transform = 'scale(1.08)';
      ghost.style.boxShadow = '0 10px 22px rgba(0,0,0,0.5)';
      document.body.appendChild(ghost);
      node.style.opacity = '0.25';
    }
    e.preventDefault();
    ghost.style.left = (e.clientX - offsetX) + 'px';
    ghost.style.top = (e.clientY - offsetY) + 'px';
    setHoverTarget(findDropTarget(e.clientX, e.clientY, DROP_FROM_PILE));
  }

  async function onUp(e) {
    if (e.pointerId !== pointerId) return;
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
    if (!dragging) return;
    node.style.opacity = '';
    if (ghost) { ghost.remove(); ghost = null; }
    state.handDragActive = false;
    const target = findDropTarget(e.clientX, e.clientY, DROP_FROM_PILE);
    setHoverTarget(null);
    node.dataset.justDragged = '1';
    setTimeout(() => { delete node.dataset.justDragged; }, 300);
    if (target) await target._remiDrop.onDrop();
  }
}
// Just enough to bridge the 6px gap between two wrapped rows of cards, so
// the seam between them belongs to one row or the other rather than to
// neither. Anything more starts swallowing the dead space above the hand.
const ROW_BAND_SLACK = 4;

function enableHandReorder(node, container) {
  let startX = 0, startY = 0, dragging = false, ghost = null, offsetX = 0, offsetY = 0, pointerId = null;
  let origNext = null; // the sibling the card sat in front of when the drag started
  let hoverTarget = null; // the drop target (otpad / meld) currently under the pointer

  function setHoverTarget(t) {
    if (hoverTarget === t) return;
    if (hoverTarget) hoverTarget.classList.remove('drop-hover');
    hoverTarget = t;
    if (hoverTarget) hoverTarget.classList.add('drop-hover');
  }

  // Is the pointer actually over the hand row? Anywhere else (the table, the
  // melds, the action bar, off the panel entirely) is not a placement, and
  // the card must go back where it started rather than to whichever end the
  // geometry search happened to fall through to. This asks the browser what
  // is under the pointer instead of measuring the row's box - the row's box
  // is wider than the cards (it's a centered full-width flex container) and
  // taller than they look, so a box test called plenty of clearly-off-row
  // drags "over the row". The ghost is pointer-events:none, so it never
  // answers here itself.
  function overHand(x, y) {
    const hit = document.elementFromPoint(x, y);
    return !!hit && (hit === container || container.contains(hit));
  }

  // The other cards level with the pointer, i.e. the visual row it's over
  // (the hand wraps to a second row on narrow screens). Empty when the
  // pointer is level with no card at all - the strip of container padding
  // just above/below the cards is still "inside" the row element, but
  // dropping there is not a placement, so it must not fall through to the
  // first/last card the way a plain left-to-right search would.
  function cardsLevelWith(y) {
    return [...container.children]
      .filter(ch => ch !== node)
      .map(sib => ({ sib, r: sib.getBoundingClientRect() }))
      .filter(({ r }) => y >= r.top - ROW_BAND_SLACK && y <= r.bottom + ROW_BAND_SLACK);
  }

  // Puts the card back exactly where the drag began.
  function snapBack() {
    if (node.nextSibling !== origNext) container.insertBefore(node, origNext);
  }

  node.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    startX = e.clientX;
    startY = e.clientY;
    dragging = false;
    pointerId = e.pointerId;
    // Listen on window rather than node: once the drag reorders `node`
    // among its siblings, or the finger/cursor strays outside its bounds,
    // an element-scoped listener can miss the eventual pointerup entirely
    // and leave the ghost stranded. setPointerCapture normally routes events
    // back to node, but capture support is inconsistent enough (older
    // WebViews, some automation input paths) that window is the safe default.
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  });

  function onMove(e) {
    if (e.pointerId !== pointerId) return;
    const dx = e.clientX - startX, dy = e.clientY - startY;
    if (!dragging) {
      if (Math.abs(dx) < HAND_DRAG_THRESHOLD && Math.abs(dy) < HAND_DRAG_THRESHOLD) return;
      dragging = true;
      state.handDragActive = true;
      origNext = node.nextSibling;
      const rect = node.getBoundingClientRect();
      offsetX = startX - rect.left;
      offsetY = startY - rect.top;
      ghost = node.cloneNode(true);
      ghost.style.position = 'fixed';
      ghost.style.left = rect.left + 'px';
      ghost.style.top = rect.top + 'px';
      ghost.style.width = rect.width + 'px';
      ghost.style.height = rect.height + 'px';
      ghost.style.margin = '0';
      ghost.style.pointerEvents = 'none';
      ghost.style.zIndex = '1000';
      ghost.style.transform = 'scale(1.08)';
      ghost.style.boxShadow = '0 10px 22px rgba(0,0,0,0.5)';
      document.body.appendChild(ghost);
      node.style.opacity = '0.25';
    }
    e.preventDefault();
    ghost.style.left = (e.clientX - offsetX) + 'px';
    ghost.style.top = (e.clientY - offsetY) + 'px';
    // Over the otpad or a meld the hand row shouldn't preview a reorder at all
    // - the card is leaving the hand, so it stays where it was until the drop
    // is either taken (the action re-renders) or refused (nothing moved).
    const target = findDropTarget(e.clientX, e.clientY, DROP_FROM_HAND);
    setHoverTarget(target);
    if (target) snapBack(); else reflow(e.clientX, e.clientY);
  }

  // Moves `node` next to whichever card of that row the pointer is nearest -
  // this is what makes the row visually "open a gap" at the drop target as
  // the browser's own flex layout reflows.
  function reflow(x, y) {
    // Off the cards: preview the snap-back, so the gap sits where the card
    // came from instead of at an end it would never actually drop into.
    const row = dropRow(x, y);
    if (!row) { snapBack(); return; }
    let target = row[row.length - 1].sib;
    let insertAfter = true;
    for (const { sib, r } of row) {
      if (x < r.left + r.width / 2) { target = sib; insertAfter = false; break; }
    }
    const desired = insertAfter ? target.nextSibling : target;
    if (desired !== node) container.insertBefore(node, desired);
  }

  // The row to drop into, or null if this position isn't a placement at all.
  function dropRow(x, y) {
    if (!overHand(x, y)) return null;
    const row = cardsLevelWith(y);
    return row.length > 0 ? row : null;
  }

  async function onUp(e) {
    if (e.pointerId !== pointerId) return;
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
    if (!dragging) return;
    state.suppressNextCardClick = true;
    node.style.opacity = '';
    if (ghost) { ghost.remove(); ghost = null; }
    state.handDragActive = false;
    const target = findDropTarget(e.clientX, e.clientY, DROP_FROM_HAND);
    setHoverTarget(null);
    if (target) {
      // Played, not reordered: hand out the card and leave handOrders alone.
      // The action re-renders on its own (and on a refused move it toasts and
      // leaves the hand exactly as it was - snapBack already restored it).
      setTimeout(() => { state.suppressNextCardClick = false; }, 300);
      await target._remiDrop.onDrop(node.dataset.cardId);
      return;
    }
    if (!dropRow(e.clientX, e.clientY)) {
      // Dropped off the cards - cancel the reorder. render() rebuilds the
      // row straight from the untouched handOrders, putting the card back
      // exactly where it was when the drag started.
      setTimeout(() => { state.suppressNextCardClick = false; }, 300);
      render();
      return;
    }
    const newOrder = [...container.children].map(ch => ch.dataset.cardId);
    if (!state.room.handOrders) state.room.handOrders = {};
    state.room.handOrders[state.session.playerId] = newOrder;
    await saveRoom(state.room);
    setTimeout(() => { state.suppressNextCardClick = false; }, 300);
    render();
  }
}

function renderBrand(app) {
  const brand = el('div', 'brand');
  brand.innerHTML = `<span class="suits" style="color:#2b2b2b;">♠</span><span class="suits" style="color:#c0392b;">♥</span><h1>REMI</h1><span class="suits" style="color:#c0392b;">♦</span><span class="suits" style="color:#2b2b2b;">♣</span>`;
  app.appendChild(brand);
  app.appendChild(el('div', 'subtitle', 'Izlazak  sa 51 - Mali/Veliki Hand'));
}

export function render() {
  const app = document.getElementById('app');
  app.innerHTML = '';
  // The 'playing' table and the round-end 'announce' sub-stage both render
  // their own top-of-screen row (opponents-row / renderRoundEndPlayersRow)
  // in place of the brand - the 'scores' sub-stage (still inside phase
  // round_end) re-adds the brand itself, see renderRoundScores.
  const isGameScreen = state.dbUrl && state.session.roomCode && state.room &&
    (state.room.phase === 'playing' || state.room.phase === 'round_end');
  if (!isGameScreen) renderBrand(app);

  if (!state.dbUrl) {
    renderDbSetup(app);
  } else if (!state.session.roomCode || !state.room) {
    renderLanding(app);
  } else if (state.room.phase === 'lobby') {
    renderLobby(app);
  } else if (state.room.phase === 'playing') {
    renderGame(app);
  } else if (state.room.phase === 'round_end') {
    renderRoundEnd(app);
  } else if (state.room.phase === 'cutting') {
    renderCutReveal(app);
  }
  app.appendChild(versionBadge());
  checkQuadAnnouncement();
}

function renderDbSetup(app) {
  const panel = el('div', 'card-panel');
  panel.appendChild(el('h2', null, 'Podesavanje (samo prvi put)'));
  panel.appendChild(el('div', 'small', 'Ova igra cuva stanje partije u besplatnoj Firebase bazi (ne treba Claude nalog). Ako je host vec podesio bazu i poslao ti link, samo otvori taj link - ovaj korak ce se preskociti automatski. Ako si host i tek podesavas, nalepi ovde "Database URL" tvog Firebase Realtime Database projekta.'));
  const field = el('div', 'field');
  field.innerHTML = '<label>Firebase Database URL</label>';
  const input = document.createElement('input');
  input.placeholder = 'https://tvoj-projekat-default-rtdb.firebaseio.com';
  field.appendChild(input);
  panel.appendChild(field);
  const btn = el('button', 'btn btn-gold', 'Sacuvaj i nastavi');
  btn.style.width = '100%';
  btn.onclick = () => {
    const v = input.value.trim().replace(/\/$/, '');
    if (!v.startsWith('https://')) { showToast('Unesi validan https:// URL.'); return; }
    localStorage.setItem('remi-db-url', v);
    state.dbUrl = v;
    render();
  };
  panel.appendChild(btn);
  app.appendChild(panel);
  const note = el('div', 'small center', 'Uputstvo za podesavanje Firebase baze je u komentaru na vrhu HTML fajla.');
  note.style.marginTop = '14px';
  app.appendChild(note);
}

function renderLanding(app) {
  const panel = el('div', 'card-panel');
  const nameField = el('div', 'field');
  nameField.innerHTML = '<label>Tvoje ime</label>';
  const nameInput = document.createElement('input');
  nameInput.id = 'name-input';
  nameField.appendChild(nameInput);
  panel.appendChild(nameField);

  const params = new URLSearchParams(location.search);
  const roomFromLink = params.get('room');

  // Only whoever opens the bare site (no ?room= in the URL, i.e. not someone
  // who arrived via a player's invite link) can create a new room - the host.
  // Players always arrive via a shared link that already has ?room=CODE, so
  // that path skips the room-code field entirely (the code is already known)
  // and defaults the name field to "Mira" rather than an empty placeholder.
  if (!roomFromLink) {
    nameInput.placeholder = 'Npr. Niko';

    const createBtn = el('button', 'btn btn-gold', 'Napravi sobu');
    createBtn.style.width = '100%';
    createBtn.onclick = async () => {
      const name = nameInput.value.trim();
      if (!name) { showToast('Unesi ime.'); return; }
      createBtn.disabled = true;
      await createRoom(name);
    };
    panel.appendChild(createBtn);

    panel.appendChild(el('div', 'divider'));

    const joinField = el('div', 'field');
    joinField.innerHTML = '<label>Kod sobe</label>';
    const codeInput = document.createElement('input');
    codeInput.placeholder = 'npr. A1B2';
    codeInput.style.textTransform = 'uppercase';
    codeInput.id = 'code-input';
    joinField.appendChild(codeInput);
    panel.appendChild(joinField);

    const joinBtn = el('button', 'btn btn-gold', 'Pridruzi se sobi');
    joinBtn.style.width = '100%';
    joinBtn.onclick = async () => {
      const name = nameInput.value.trim();
      const code = codeInput.value.trim();
      if (!name) { showToast('Unesi ime.'); return; }
      if (!code) { showToast('Unesi kod sobe.'); return; }
      joinBtn.disabled = true;
      await joinRoom(code, name);
      joinBtn.disabled = false;
    };
    panel.appendChild(joinBtn);
  } else {
    nameInput.value = 'Mira';

    const joinBtn = el('button', 'btn btn-gold', 'Pridruzi se sobi');
    joinBtn.style.width = '100%';
    joinBtn.onclick = async () => {
      const name = nameInput.value.trim();
      if (!name) { showToast('Unesi ime.'); return; }
      joinBtn.disabled = true;
      await joinRoom(roomFromLink, name);
      joinBtn.disabled = false;
    };
    panel.appendChild(joinBtn);
  }

  app.appendChild(panel);

  const note = el('div', 'small center', roomFromLink
    ? 'Do 4 igraca, svako sa svog uredjaja.'
    : 'Do 4 igraca, svako sa svog uredjaja preko istog koda sobe.');
  note.style.marginTop = '14px';
  app.appendChild(note);
}

function renderLobby(app) {
  const panel = el('div', 'card-panel');
  panel.appendChild(el('h2', null, 'Cekaonica'));
  panel.appendChild(el('div', 'small', 'Posalji ovaj link ostalima igracim - kad ga otvore, sve je vec podeseno'));

  const shareUrl = `${location.origin}${location.pathname}?db=${encodeURIComponent(state.dbUrl)}&room=${state.room.code}`;
  const linkBox = el('div', 'field');
  const linkInput = document.createElement('input');
  linkInput.value = shareUrl;
  linkInput.readOnly = true;
  linkInput.style.fontSize = '12px';
  linkBox.appendChild(linkInput);
  panel.appendChild(linkBox);
  const copyBtn = el('button', 'btn btn-outline-gold', 'Kopiraj link');
  copyBtn.style.width = '100%';
  copyBtn.onclick = async () => {
    try { await navigator.clipboard.writeText(shareUrl); showToast('Link kopiran!'); }
    catch (e) { linkInput.select(); showToast('Selektovano - kopiraj sa Ctrl/Cmd+C'); }
  };
  panel.appendChild(copyBtn);

  panel.appendChild(el('div', 'divider'));
  panel.appendChild(el('div', 'small', 'Ili kod sobe za rucni unos:'));
  panel.appendChild(el('div', 'roomcode-display', state.room.code));

  const chips = el('div', 'chip-list');
  state.room.players.forEach((p, i) => {
    const chip = el('div', 'player-chip');
    chip.textContent = p.name;
    if (i === 0) {
      const b = el('span', 'dealer-badge', 'HOST');
      chip.appendChild(b);
    }
    chips.appendChild(chip);
  });
  panel.appendChild(chips);

  panel.appendChild(el('div', 'divider'));

  const isHost = state.room.players[0] && state.room.players[0].id === state.session.playerId;
  if (isHost) {
    if (state.room.players.length < 2) {
      const waitMsg = el('div', 'small center', 'Ceka se jos bar 1 igrac ...');
      waitMsg.style.fontWeight = '700';
      waitMsg.style.color = 'var(--danger)';
      waitMsg.style.marginBottom = '8px';
      waitMsg.style.fontSize = '30px';
      panel.appendChild(waitMsg);
    }
    const startBtn = el('button', 'btn btn-gold', `Zapocni igru (${state.room.players.length} igraca)`);
    startBtn.style.width = '100%';
    startBtn.disabled = state.room.players.length < 2;
    startBtn.onclick = hostStartGame;
    panel.appendChild(startBtn);
  } else {
    panel.appendChild(el('div', 'small', 'Cekamo da host (' + state.room.players[0].name + ') zapocne igru...'));
  }

  const leaveBtn = el('button', 'btn btn-danger', 'Napusti sobu');
  leaveBtn.style.width = '100%';
  leaveBtn.style.marginTop = '10px';
  leaveBtn.onclick = leaveRoom;
  panel.appendChild(leaveBtn);
  app.appendChild(panel);
}

// One player's tile in the top row: name, an "opened" dot, their card count,
// and the DELI badge if they're this round's dealer. Shared by the live table
// (renderOpponents, where `active` marks whose turn it is) and the round-end
// screen (renderRoundEndPlayersRow, where `winner` marks who went out).
function playerTileEl(p, i, { active = false, winner = false } = {}) {
  const c = el('div', 'opp-card' + (active ? ' active' : '') + (winner ? ' winner-highlight' : ''));
  c.style.position = 'relative';
  c.appendChild(el('div', 'name', p.name));
  const handCount = (state.room.hands[p.id] || []).length;
  const meta = el('div', 'meta');
  meta.innerHTML = (state.room.openedPlayers.includes(p.id) ? '<span class="opened-dot"></span>' : '') + ' ' + cardCountLabel(handCount);
  c.appendChild(meta);
  if (i === state.room.dealerIndex) {
    const b = el('span', 'dealer-badge', 'DELI');
    b.style.position = 'absolute'; b.style.top = '-8px'; b.style.right = '8px';
    c.appendChild(b);
  }
  return c;
}

function renderOpponents(app) {
  const rowEl = el('div', 'opponents-row');
  rowEl.style.position = 'relative';
  const stanjeBtn = el('button', 'btn btn-outline-gold', 'Stanje');
  stanjeBtn.style.position = 'absolute';
  stanjeBtn.style.left = '0';
  stanjeBtn.style.top = '50%';
  stanjeBtn.style.transform = 'translateY(-50%)';
  stanjeBtn.onclick = () => showScoreHistoryModal(state.room);
  rowEl.appendChild(stanjeBtn);
  const isHost = state.room.players[0] && state.room.players[0].id === state.session.playerId;
  if (isHost) {
    const resetBtn = el('button', 'btn btn-danger', 'Reset');
    resetBtn.style.position = 'absolute';
    resetBtn.style.right = '0';
    resetBtn.style.top = '50%';
    resetBtn.style.transform = 'translateY(-50%)';
    resetBtn.onclick = hostResetGame;
    rowEl.appendChild(resetBtn);
  }
  state.room.players.forEach((p, i) => {
    if (p.id === state.session.playerId) return;
    rowEl.appendChild(playerTileEl(p, i, { active: state.room.currentPlayerIndex === i }));
  });
  app.appendChild(rowEl);
}

function renderCenterTable(app) {
  const center = el('div', 'center-table');

  const pilesRow = el('div', 'stock-discard-row piles-inline');

  // Stock (with the special bottom card, if any, peeking out from behind it)
  const stockWrap = el('div', 'special-card-wrap');
  const stockClickable = isMyTurn() && state.room.turnPhase === 'draw';
  const hasPeek = state.room.specialBottomCard && !state.room.specialBottomCard.taken;
  const stockStack = el('div', 'pile-stack' + (hasPeek ? ' talon-stack' : ''));
  if (hasPeek) {
    const peekWrap = el('div', 'talon-peek-wrap');
    const peekCard = cardEl(state.room.specialBottomCard.card, {});
    peekWrap.appendChild(peekCard);
    peekWrap.onclick = stockClickable ? () => {
      if (peekWrap.dataset.justDragged) return; // the drag already handled it
      actionTryBottomCard();
    } : null;
    // Dragging the card under the talon into your hand takes it, exactly as
    // clicking it does - actionTryBottomCard still enforces that it's only
    // handed over when a hand is actually available.
    if (stockClickable) enablePileDrag(peekWrap, actionTryBottomCard);
    if (!stockClickable) peekWrap.style.cursor = 'not-allowed';
    stockStack.appendChild(peekWrap);
  }
  const frontCard = state.room.stock.length > 0 ? cardBackEl(false, state.room.stock[0]) : (() => { const d = el('div', 'card back deck-0'); d.style.opacity = '0.3'; return d; })();
  if (hasPeek) frontCard.classList.add('talon-front');
  frontCard.onclick = stockClickable ? actionDrawStock : null;
  if (!stockClickable) stockStack.classList.add('disabled');
  // Taking the card from under the talon has a drag; so does putting it back.
  // Dropping it on the talon is "Vrati kartu ispod talona" - actionDiscard
  // routes that card to returnBottomCard rather than the otpad. Only offered
  // while that card is actually in hand, so the talon isn't a live target for
  // ordinary cards (which actionDiscard would refuse anyway).
  if (isMyTurn() && state.room.turnPhase === 'meld' && state.room.bottomDrawCardId) {
    markDropTarget(stockStack, DROP_FROM_HAND, (cardId) => actionDiscard(cardId));
  }
  stockStack.appendChild(frontCard);
  stockWrap.appendChild(stockStack);
  stockWrap.appendChild(el('div', 'pile-label', `Talon (${state.room.stock.length})`));
  pilesRow.appendChild(stockWrap);

  // Discard
  const discardWrap = el('div', 'special-card-wrap');
  const discardClickable = isMyTurn() && state.room.turnPhase === 'draw' && state.room.discard.length > 0
    && myHand().length !== 1;
  const discardStack = el('div', 'pile-stack' + (discardClickable ? '' : ' disabled'));
  if (state.room.discard.length > 0) {
    discardStack.appendChild(cardEl(state.room.discard[state.room.discard.length - 1], {}));
  } else {
    // Class, not an inline opacity: an empty otpad is still a drop target
    // (that's exactly the state after pulling its last card), and it has to
    // look like one rather than like a 25%-opacity ghost - see .empty-pile.
    discardStack.appendChild(el('div', 'card empty-pile', '—'));
  }
  discardStack.onclick = discardClickable ? actionDrawDiscard : null;
  // Dragging a card from the hand onto the otpad throws it - the same thing
  // the "Baci" button does (which stays where it is). actionDiscard validates,
  // so a card that isn't free to be thrown just toasts as it would on click.
  if (isMyTurn() && state.room.turnPhase === 'meld') {
    markDropTarget(discardStack, DROP_FROM_HAND, (cardId) => actionDiscard(cardId));
  }
  discardWrap.appendChild(discardStack);
  discardWrap.appendChild(el('div', 'pile-label', `Otpad (${state.room.discard.length})`));
  pilesRow.appendChild(discardWrap);

  center.appendChild(pilesRow);

  renderMeldsForPlayers(center, { clickable: true });

  app.appendChild(center);
}

// Melds on table, grouped by owner. `clickable: false` renders a read-only
// snapshot (used on the round-announce screen) with no interactive handlers.
function renderMeldsForPlayers(container, { clickable }) {
  const meldsArea = el('div', 'melds-area');
  state.room.players.forEach((p) => {
    const ownMelds = state.room.melds.map((m, idx) => ({ m, idx })).filter(x => x.m.ownerId === p.id);
    if (ownMelds.length === 0) return;
    meldsArea.appendChild(el('div', 'meld-owner-label', p.name));
    const line = el('div', null);
    ownMelds.forEach(({ m, idx }) => {
      const canTarget = clickable && isMyTurn() && state.room.turnPhase === 'meld' && state.room.openedPlayers.includes(state.session.playerId) && state.selectedIds.size > 0;
      const groupDiv = el('div', 'meld-group' + (canTarget ? ' targetable' : ''));
      const cardsDiv = el('div', 'meld-cards');
      // A set's joker only has an unambiguous identity (and so can be
      // exchanged) once 3 real cards of that rank are already down, leaving
      // exactly one missing suit - with only 2 real cards it could stand for
      // either remaining suit, so it isn't offered as a replace target yet.
      const meldResolved = resolveMeld(m.cards);
      const canReplaceJoker = clickable && isMyTurn() && state.room.turnPhase === 'meld' && state.selectedIds.size === 1;
      const jokerReplaceEligible = canReplaceJoker &&
        (!meldResolved || meldResolved.type !== 'set' || m.cards.filter(cc => !cc.joker).length >= 3);
      // On the read-only round-end snapshot, highlight only the meld(s) the
      // winner actually touched on their winning turn (see roundWinMeldIds in
      // endRoundWithWinner), not their whole table history.
      const isWinnerMeld = !clickable && (state.room.roundWinMeldIds || []).includes(m.id);
      sortMeldForDisplay(m.cards).forEach(c => {
        const cardElement = cardEl(c, { mini: true });
        if (isWinnerMeld) cardElement.classList.add('winner-meld');
        if (c.joker && jokerReplaceEligible) {
          cardElement.classList.add('clickable');
          cardElement.classList.add('joker-replaceable');
          cardElement.onclick = (e) => { e.stopPropagation(); actionReplaceJoker(idx, c.id); };
          cardsDiv.appendChild(wrapHoverSlot(cardElement));
        } else {
          cardsDiv.appendChild(cardElement);
        }
      });
      groupDiv.appendChild(cardsDiv);
      if (canTarget) groupDiv.onclick = () => actionAddToMeld(p.id, idx);
      // Krpljenje by drag: unlike the click path this needs no prior
      // selection (the dragged card IS the selection), so it's offered
      // whenever the player could add cards at all.
      const canDropOn = clickable && isMyTurn() && state.room.turnPhase === 'meld'
        && state.room.openedPlayers.includes(state.session.playerId);
      if (canDropOn) markDropTarget(groupDiv, DROP_FROM_HAND, (cardId) => dropCardOnMeld(cardId, p.id, idx));
      line.appendChild(groupDiv);
    });
    meldsArea.appendChild(line);
  });
  container.appendChild(meldsArea);
}

function renderHandAndActions(app) {
  const handWrap = el('div', 'hand-area');
  const titleRow = el('div', 'hand-title-row');
  const opened_ = state.room.openedPlayers.includes(state.session.playerId);
  let sumText;
  if (!opened_) {
    // Mali hand only ever ends with 14 cards (the 15th gets discarded) - preview
    // the sum for the best 14 (i.e. drop the single highest-value card) rather
    // than the full hand, which may still hold that soon-to-be-discarded card.
    const smallest14 = myHand().slice().sort((a, b) => cardValueMaliHand(a) - cardValueMaliHand(b)).slice(0, 14);
    sumText = `Zbir 14 karata ako ides na mali hand [ ${maliHandValue(smallest14)} ]`;
  } else {
    const standardSum = myHand().reduce((s, c) => s + cardValueStandard(c), 0);
    sumText = `Zbir ruke: ${standardSum}`;
  }
  titleRow.appendChild(el('div', 'small', sumText));
  const countLbl = el('div', 'small', cardCountLabel(myHand().length));
  titleRow.appendChild(countLbl);
  handWrap.appendChild(titleRow);

  const selectedCards = getSelectedCards();
  const myPendingJokers = pendingJokerIds(state.room, state.session.playerId);

  const myTurn = isMyTurn();
  const canPick = myTurn && state.room.turnPhase === 'meld';
  // Reserve the same top space whenever cards are clickable, not just when one
  // is actually selected - a hovered (but unselected) card also lifts via
  // .card-slot:hover and would otherwise overlap the "Zbir ruke" text above.
  const cardsRow = el('div', 'hand-cards' + ((canPick || selectedCards.length > 0) ? ' has-selection' : ''));
  const myHandOrder = (state.room.handOrders || {})[state.session.playerId] || null;
  const myPinnedCardId = (state.room.pinnedCardIds || {})[state.session.playerId] || null;
  orderHand(myHand(), myHandOrder, myPinnedCardId).forEach(c => {
    const selected = state.selectedIds.has(c.id);
    const drawn = state.room.lastDrawnPlayerId === state.session.playerId && state.room.lastDrawnCardId === c.id;
    const pending = myPendingJokers.includes(c.id);
    const cd = cardEl(c, {
      clickable: canPick,
      selected,
      onClick: canPick ? () => {
        if (state.suppressNextCardClick) { state.suppressNextCardClick = false; return; }
        if (selected) state.selectedIds.delete(c.id); else state.selectedIds.add(c.id); render();
      } : null,
    });
    if (drawn) cd.classList.add('just-drawn');
    if (pending) cd.classList.add('pending-joker');
    const flexItem = canPick ? wrapHoverSlot(cd) : cd;
    flexItem.dataset.cardId = c.id;
    enableHandReorder(flexItem, cardsRow);
    cardsRow.appendChild(flexItem);
  });
  // Landing zone for the card dragged out from under the talon (the click on
  // that card does the same thing). Only during your own draw phase, which is
  // the only time it can be taken at all.
  if (myTurn && state.room.turnPhase === 'draw') {
    markDropTarget(cardsRow, DROP_FROM_PILE, () => actionTryBottomCard());
  }
  handWrap.appendChild(cardsRow);
  app.appendChild(handWrap);

  // Turn banner
  const banner = el('div', 'turn-banner');
  if (state.room.phase === 'playing') {
    const cur = state.room.players[state.room.currentPlayerIndex];
    if (myTurn) {
      banner.textContent = state.room.turnPhase === 'draw' ? 'Tvoj red - vuci kartu' : 'Tvoj red - odigraj i baci';
    } else {
      banner.textContent = `Na potezu: ${cur.name}`;
    }
  }
  app.appendChild(banner);

  if (myTurn && myPendingJokers.length > 0) {
    const many = myPendingJokers.length > 1;
    const warn = el('div', 'small center', many
      ? `⚠️ Imas ${myPendingJokers.length} dzokera (u ruci su oiviceni crvenom isprekidanom linijom) koje moras da spustis - novim kombinacijama ili dodavanjem na postojece nizove - pre nego sto bacis kartu.`
      : '⚠️ Imas dzokera (u ruci je oivicen crvenom isprekidanom linijom) koga moras da spustis - novom kombinacijom ili dodavanjem na postojeci niz - pre nego sto bacis kartu.');
    warn.style.color = 'var(--gold-bright)';
    warn.style.marginBottom = '10px';
    app.appendChild(warn);
  }

  const bar = el('div', 'action-bar');
  const opened = state.room.openedPlayers.includes(state.session.playerId);

  if (myTurn && state.room.turnPhase === 'meld') {
    // A player must always keep at least one card back to discard - the
    // hand can never be emptied purely by laying/adding melds (that's the
    // discard action's job, per actionDiscard's own hand.length===0 check).
    const selectingWholeHand = state.selectedIds.size === myHand().length && myHand().length > 0;
    const layBtn = el('button', 'btn btn-gold');
    // A ready hand (mali or veliki) wins the round outright, so it replaces
    // the usual opening lay entirely - one click lays it down, throws the odd
    // card on the otpad and ends the round, no card selection needed.
    const handOption = opened ? null : findHandOption(myHand());
    if (handOption) {
      layBtn.textContent = 'Handiraj';
      layBtn.classList.add('btn-hand');
      layBtn.onclick = actionDeclareHand;
    } else if (opened) {
      layBtn.textContent = 'Izlozi se';
      layBtn.disabled = state.selectedIds.size < 3 || selectingWholeHand;
    } else {
      layBtn.append(
        'Izlozi se (', el('span', 'lay-btn-sum', String(computeSelectedSum(selectedCards))),
        ') [', el('span', 'lay-btn-sum', String(maliHandValue(selectedCards))), ']'
      );
      layBtn.disabled = state.selectedIds.size === 0;
    }
    if (!handOption) layBtn.onclick = actionLayMultipleSelected;
    bar.appendChild(layBtn);

    // Undoing a selection only matters once there's a selection worth undoing:
    // a single card is cleared by clicking it again, so the button appears
    // only from two cards up. ("Izaberi sve karte", the other half this button
    // used to toggle to, is gone - "Handiraj" already selects a whole ready
    // hand on its own.)
    if (state.selectedIds.size > 1) {
      const clearBtn = el('button', 'btn btn-outline-gold', 'Ponisti izbor');
      clearBtn.onclick = () => { state.selectedIds.clear(); render(); };
      bar.appendChild(clearBtn);
    }

    const hasPendingJoker = myPendingJokers.length > 0;
    const selectedIsDiscardDraw = state.selectedIds.size === 1 && [...state.selectedIds][0] === state.room.discardDrawCardId;
    const selectedIsBottomDraw = state.selectedIds.size === 1 && [...state.selectedIds][0] === state.room.bottomDrawCardId;
    const selectedJokerNotLastCard = state.selectedIds.size === 1 && !selectedIsDiscardDraw && !selectedIsBottomDraw
      && myHand().length > 1
      && myHand().find(c => c.id === [...state.selectedIds][0])?.joker;
    const discardBtn = el('button', 'btn btn-danger',
      selectedIsDiscardDraw ? 'Vrati kartu na otpad'
      : selectedIsBottomDraw ? 'Vrati kartu ispod talona'
      : 'Baci');
    discardBtn.disabled = state.selectedIds.size !== 1 || hasPendingJoker || selectedJokerNotLastCard;
    discardBtn.onclick = () => { const id = [...state.selectedIds][0]; actionDiscard(id); };
    bar.appendChild(discardBtn);
  }

  app.appendChild(bar);
}

// state.selectedIds holds card ids, and an id can outlive the card it points
// at: a new round deals fresh hands, and every poll assigns a freshly loaded
// room over state.room, so the hand under the selection can be swapped out
// from under it without any action having run a clear(). A leftover id is
// invisible (no card in the hand renders as selected for it) but still counts
// towards state.selectedIds.size - which is what "Baci" tests for ("exactly
// one card selected"), so the button sat greyed out with one card plainly
// selected. The set only ever means anything against the current hand, so
// reconcile it with the hand before anything reads its size.
function pruneSelection() {
  const inHand = getSelectedCards();
  if (inHand.length !== state.selectedIds.size) {
    state.selectedIds = new Set(inHand.map(c => c.id));
  }
}

function renderGame(app) {
  pruneSelection();
  const panel = el('div', 'card-panel table-area');
  renderOpponents(panel);
  const toastAnchor = el('div', 'toast-anchor');
  toastAnchor.id = 'toast-anchor';
  panel.appendChild(toastAnchor);
  renderCenterTable(panel);
  renderHandAndActions(panel);
  app.appendChild(panel);
}

function renderResetControl(app) {
  const isHost = state.room.players[0] && state.room.players[0].id === state.session.playerId;
  if (!isHost) return;
  const wrap = el('div', 'center');
  wrap.style.marginTop = '14px';
  const btn = el('button', 'btn btn-danger', 'Reset');
  btn.onclick = hostResetGame;
  wrap.appendChild(btn);
  app.appendChild(wrap);
}

function renderRoundEnd(app) {
  if (state.lastRoundEndRound !== state.room.round) {
    state.roundEndStage = 'announce';
    state.lastRoundEndRound = state.room.round;
    state.scoreHistoryScrollTop = null; // so the new round's table opens at its newest row
  }
  if (state.roundEndStage === 'announce') renderRoundAnnounce(app);
  else renderRoundScores(app);
  renderResetControl(app);
}

// The viewer sees a first-person congratulation when they're the one who
// won, instead of reading their own name back in the third person. The verb
// is present tense ("handira"/"zatvara") so it never needs gender agreement
// the way a past participle ("handirao/handirala") would.
// Same banner as the announce screen, except the winner's name is orange -
// on the scores screen it ties the name to their orange row/column in the
// two tables below (flowScreens/07-round-end-scores.html).
function winnerBannerEl(winner) {
  const banner = el('div', 'winner-banner');
  const text = winnerBannerText(winner);
  const name = winner ? winner.name : '?';
  const at = state.room.roundWinner === state.session.playerId ? -1 : text.indexOf(name);
  if (at === -1) { banner.textContent = text; return banner; }
  banner.append(text.slice(0, at), el('span', 'winner-name-orange', name), text.slice(at + name.length));
  return banner;
}

function winnerBannerText(winner) {
  const wentOutWithHand = state.room.roundWinType === 'mali' || state.room.roundWinType === 'veliki';
  const verb = wentOutWithHand ? 'handira' : 'zatvara';
  if (state.room.roundWinner === state.session.playerId) {
    return `🏆 Bravo, ${wentOutWithHand ? 'handiras' : 'zatvaras'}!`;
  }
  return `🏆 ${winner ? winner.name : '?'} ${verb}!`;
}

// Unlike renderOpponents (live table), this shows every player including the
// viewer - the viewer's own melds/hand are already broken out separately
// below, but their card count belongs in the same at-a-glance row as
// everyone else's. The winner gets the same orange highlight as their melds.
function renderRoundEndPlayersRow(app) {
  const rowEl = el('div', 'opponents-row');
  state.room.players.forEach((p, i) => {
    rowEl.appendChild(playerTileEl(p, i, { winner: p.id === state.room.roundWinner }));
  });
  app.appendChild(rowEl);
}

function renderRoundAnnounce(app) {
  renderRoundEndPlayersRow(app);
  const panel = el('div', 'card-panel');
  const winner = state.room.players.find(p => p.id === state.room.roundWinner);
  const bannerEl = el('div', 'winner-banner', winnerBannerText(winner));
  bannerEl.style.marginBottom = '40px';
  panel.appendChild(bannerEl);

  renderMeldsForPlayers(panel, { clickable: false });

  if (state.room.roundWinType === 'mali') {
    panel.appendChild(el('div', 'meld-owner-label', (winner ? winner.name : '?') + ' - ruka (Mali Hand)'));
    const row = el('div', 'hand-cards');
    sortHand(state.room.hands[state.room.roundWinner] || []).forEach(c => {
      const cardElement = cardEl(c, { mini: true });
      cardElement.classList.add('winner-meld');
      row.appendChild(cardElement);
    });
    panel.appendChild(row);
  }

  // Show the viewer's own leftover hand too - unless it was just shown above
  // as the mali-hand winner's hand (that's the same cards, would duplicate).
  const shownAsMaliWinner = state.room.roundWinType === 'mali' && state.room.roundWinner === state.session.playerId;
  const myLeftover = myHand();
  if (!shownAsMaliWinner && myLeftover.length > 0) {
    // A player who never opened takes a flat 100-point penalty regardless of
    // what's in their hand (see scoreRound in js/engine.js) - only an opened
    // player's score is the actual sum of their leftover cards.
    const neverOpened = !state.room.openedPlayers.includes(state.session.playerId);
    const sum = neverOpened ? 100 : myLeftover.reduce((s, c) => s + cardValueStandard(c), 0);
    const wentOutWithHand = state.room.roundWinType === 'mali' || state.room.roundWinType === 'veliki';
    const label = wentOutWithHand
      ? `Vrednost karata u tvojo ruci je ${sum}, bio  je hand, to je duplo ${sum * 2}`
      : `Vrednost karata u tvojo ruci je ${sum}`;
    const labelEl = el('div', 'small center', label);
    labelEl.style.color = 'var(--gold-bright)';
    labelEl.style.marginTop = '20px'; // same as .card's height, for a clean section break
    labelEl.style.marginBottom = '14px';
    panel.appendChild(labelEl);
    const row = el('div', 'hand-cards');
    sortHand(myLeftover).forEach(c => row.appendChild(cardEl(c, { mini: true })));
    panel.appendChild(row);
  }

  const nextBtn = el('button', 'btn btn-gold', 'Sledeca partija');
  nextBtn.style.width = '100%';
  nextBtn.style.marginTop = '14px';
  nextBtn.onclick = actionReadyForScores;
  panel.appendChild(nextBtn);

  app.appendChild(panel);
}

function renderRoundScores(app) {
  // No brand header here: this screen already carries a winner banner, and with
  // a long history the header only pushed the buttons off the bottom.
  const panel = el('div', 'card-panel round-end-scores-panel');
  const winner = state.room.players.find(p => p.id === state.room.roundWinner);
  const typeLabel = { mali: 'Mali Hand', veliki: 'Veliki Hand' }[state.room.roundWinType] || 'regularno';
  panel.appendChild(winnerBannerEl(winner));
  panel.appendChild(el('div', 'small center', 'Nacin pobede: ' + typeLabel));

  // Just this round's deltas - running totals are in the history table right
  // below, so a third "Ukupno" column here only repeated its last row.
  const deltaTable = document.createElement('table');
  deltaTable.className = 'score-table score-summary-table';
  deltaTable.innerHTML = '<tr><th>Igrac</th><th>Runda</th></tr>';
  state.room.players.forEach(p => {
    const tr = document.createElement('tr');
    if (p.id === state.room.roundWinner) tr.classList.add('winner-row');
    const delta = (state.room.lastDeltas && state.room.lastDeltas[p.id]) || 0;
    tr.innerHTML = `<td class="name">${p.name}</td><td>${delta > 0 ? '+' : ''}${delta}</td>`;
    deltaTable.appendChild(tr);
  });
  panel.appendChild(deltaTable);

  panel.appendChild(el('div', 'divider'));

  panel.appendChild(el('div', 'small center', 'Istorija po rundama'));
  // The names row stays put while the rounds scroll under it, and the view
  // opens on the newest round rather than the oldest.
  const history = buildScoreHistoryBlock(state.room, state.room.roundWinner);
  panel.appendChild(history.block);

  panel.appendChild(el('div', 'divider'));

  const readyList = state.room.readyForNextRound || [];
  const myId = state.session.playerId;
  const iAmReady = readyList.includes(myId);
  const nextBtn = el('button', 'btn btn-gold',
    iAmReady ? `Cekamo ostale (${readyList.length}/${state.room.players.length}) spremno...` : 'Sledeca partija');
  nextBtn.style.width = '100%';
  nextBtn.disabled = iAmReady;
  nextBtn.onclick = actionReadyForNextRound;
  panel.appendChild(nextBtn);

  const isHost = state.room.players[0] && state.room.players[0].id === myId;
  if (isHost) {
    const forceBtn = el('button', 'btn btn-outline-gold', 'Podeli Sada - bez cekanja');
    forceBtn.style.width = '100%';
    forceBtn.style.marginTop = '8px';
    forceBtn.onclick = actionForceNextRound;
    panel.appendChild(forceBtn);
  }

  app.appendChild(panel);

  // Both of these need the block to be in the document first: the scrollbar
  // can only be measured once laid out, and scrollHeight is 0 before that.
  reserveScrollbarStrip(history.block, history.bodyWrap, history.tableWidth);
  // This screen re-renders on every poll while waiting for the other players,
  // which would otherwise yank the view back to the newest round every few
  // seconds. So jump to the bottom only the first time (per round - reset in
  // renderRoundEnd), and put the player back where they scrolled to after that.
  if (state.scoreHistoryScrollTop === null) {
    history.bodyWrap.scrollTop = history.bodyWrap.scrollHeight;
  } else {
    history.bodyWrap.scrollTop = state.scoreHistoryScrollTop;
  }
  history.bodyWrap.onscroll = () => { state.scoreHistoryScrollTop = history.bodyWrap.scrollTop; };
}

function renderCutReveal(app) {
  const panel = el('div', 'card-panel');
  panel.appendChild(el('h2', null, 'Sece se...'));
  const pr = state.room.pendingRound;
  (pr && pr.log ? pr.log : []).forEach(line => panel.appendChild(el('div', 'small center', line)));
  const noUppercase = (elm) => { elm.style.textTransform = 'none'; return elm; };

  if (pr && pr.revealedCard) {
    // Cutting exposes two cards: the cut card itself, and the card directly
    // under it. If the cut card is a joker, the CUTTER gets it as a bonus;
    // if instead the card under it is a joker, the DEALER gets that one -
    // both must be shown so it's clear which rule applied.
    const cardsRow = el('div', 'stock-discard-row');
    cardsRow.style.justifyContent = 'center';
    cardsRow.style.flexWrap = 'wrap';
    cardsRow.style.margin = '14px auto';

    const cutWrap = el('div', 'special-card-wrap');
    cutWrap.appendChild(cardEl(pr.revealedCard, {}));
    cutWrap.appendChild(noUppercase(el('div', 'pile-label', 'Presecena karta')));
    cardsRow.appendChild(cutWrap);

    if (pr.belowCutCard) {
      const belowWrap = el('div', 'special-card-wrap');
      belowWrap.appendChild(cardEl(pr.belowCutCard, {}));
      belowWrap.appendChild(noUppercase(el('div', 'pile-label', 'Donja karta')));
      cardsRow.appendChild(belowWrap);
    }

    // If the cut card itself was a joker (claimed by the cutter), a fresh
    // card gets drawn to fill the "ispod talona" slot for the round - that's
    // neither of the two cards above, so show it too.
    if (pr.revealedCard.joker && pr.specialBottomCard) {
      const freshWrap = el('div', 'special-card-wrap');
      freshWrap.appendChild(cardEl(pr.specialBottomCard.card, {}));
      freshWrap.appendChild(el('div', 'pile-label', 'Nova karta ispod talona'));
      cardsRow.appendChild(freshWrap);
    }

    panel.appendChild(cardsRow);
  }

  panel.appendChild(el('div', 'small center', 'Deli se za par sekundi...'));
  app.appendChild(panel);
}
