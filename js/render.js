import { state, APP_VERSION } from './state.js';
import { resolveMeld, maliHandValue, cardValueStandard, cardValueMaliHand, computeSelectedSum } from './engine.js';
import { cardEl, cardBackEl, sortHand, orderHand, wrapHoverSlot } from './cards.js';
import { saveRoom } from './storage.js';
import { showToast, checkQuadAnnouncement, showScoreHistoryModal, buildScoreHistoryTable } from './ui.js';
import {
  isMyTurn, myHand, getSelectedCards,
  actionDrawStock, actionTryBottomCard, actionDrawDiscard, actionReplaceJoker,
  actionAddToMeld, actionLayMultipleSelected, actionDiscard,
  hostStartGame, hostResetGame,
  actionReadyForScores, actionReadyForNextRound, actionForceNextRound,
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

function enableHandReorder(node, container) {
  let startX = 0, startY = 0, dragging = false, ghost = null, offsetX = 0, offsetY = 0, pointerId = null;

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
    reflow(e.clientX, e.clientY);
  }

  // Finds the flex-wrap sibling whose row/column the pointer is currently
  // over and moves `node` next to it - this is what makes the row visually
  // "open a gap" at the drop target as the browser's own flex layout reflows.
  function reflow(x, y) {
    const siblings = [...container.children].filter(ch => ch !== node);
    if (siblings.length === 0) return;
    let target = siblings[siblings.length - 1];
    let insertAfter = true;
    for (const sib of siblings) {
      const r = sib.getBoundingClientRect();
      const inRow = y >= r.top && y <= r.bottom;
      if (!inRow && r.top > y) { target = sib; insertAfter = false; break; }
      if (inRow) {
        target = sib;
        insertAfter = x >= r.left + r.width / 2;
        if (!insertAfter) break;
      }
    }
    const desired = insertAfter ? target.nextSibling : target;
    if (desired !== node) container.insertBefore(node, desired);
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
    const newOrder = [...container.children].map(ch => ch.dataset.cardId);
    if (!state.room.handOrders) state.room.handOrders = {};
    state.room.handOrders[state.session.playerId] = newOrder;
    await saveRoom(state.room);
    setTimeout(() => { state.suppressNextCardClick = false; }, 300);
    render();
  }
}

export function render() {
  const app = document.getElementById('app');
  app.innerHTML = '';
  const isGameScreen = state.dbUrl && state.session.roomCode && state.room && state.room.phase === 'playing';
  if (!isGameScreen) {
    const brand = el('div', 'brand');
    brand.innerHTML = `<span class="suits" style="color:#2b2b2b;">♠</span><span class="suits" style="color:#c0392b;">♥</span><h1>REMI</h1><span class="suits" style="color:#c0392b;">♦</span><span class="suits" style="color:#2b2b2b;">♣</span>`;
    app.appendChild(brand);
    app.appendChild(el('div', 'subtitle', 'Izlazak  sa 51 - Mali/Veliki Hand'));
  }

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
  nameInput.placeholder = 'Npr. Niko';
  nameInput.id = 'name-input';
  nameField.appendChild(nameInput);
  panel.appendChild(nameField);

  const params = new URLSearchParams(location.search);
  const roomFromLink = params.get('room');

  // Only whoever opens the bare site (no ?room= in the URL, i.e. not someone
  // who arrived via a player's invite link) can create a new room - the host.
  // Players always arrive via a shared link that already has ?room=CODE.
  if (!roomFromLink) {
    const createBtn = el('button', 'btn btn-gold', 'Napravi sobu');
    createBtn.style.width = '100%';
    createBtn.onclick = async () => {
      const name = nameInput.value.trim();
      if (!name) { showToast('Unesi ime.'); return; }
      createBtn.disabled = true;
      await createRoom(name);
    };
    panel.appendChild(createBtn);
  }

  panel.appendChild(el('div', 'divider'));

  const joinField = el('div', 'field');
  joinField.innerHTML = '<label>Kod sobe</label>';
  const codeInput = document.createElement('input');
  codeInput.placeholder = 'npr. A1B2';
  codeInput.style.textTransform = 'uppercase';
  codeInput.id = 'code-input';
  if (roomFromLink) codeInput.value = roomFromLink.toUpperCase();
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

  app.appendChild(panel);

  const note = el('div', 'small center', 'Do 4 igraca, svako sa svog uredjaja preko istog koda sobe.');
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
  state.room.players.forEach((p, i) => {
    if (p.id === state.session.playerId) return;
    const c = el('div', 'opp-card' + (state.room.currentPlayerIndex === i ? ' active' : ''));
    const nameLine = el('div', 'name', p.name);
    c.appendChild(nameLine);
    const handCount = (state.room.hands[p.id] || []).length;
    const meta = el('div', 'meta');
    meta.innerHTML = (state.room.openedPlayers.includes(p.id) ? '<span class="opened-dot"></span>' : '') + ` ${handCount} karata`;
    c.appendChild(meta);
    if (i === state.room.dealerIndex) {
      const b = el('span', 'dealer-badge', 'DELI');
      b.style.position = 'absolute'; b.style.top = '-8px'; b.style.right = '8px';
      c.style.position = 'relative';
      c.appendChild(b);
    }
    rowEl.appendChild(c);
  });
  app.appendChild(rowEl);
}

function renderCenterTable(app) {
  const center = el('div', 'center-table');

  const pilesRow = el('div', 'stock-discard-row');

  // Stock (with the special bottom card, if any, peeking out from behind it)
  const stockWrap = el('div', 'special-card-wrap');
  const stockClickable = isMyTurn() && state.room.turnPhase === 'draw';
  const hasPeek = state.room.specialBottomCard && !state.room.specialBottomCard.taken;
  const stockStack = el('div', 'pile-stack' + (hasPeek ? ' talon-stack' : ''));
  if (hasPeek) {
    const peekWrap = el('div', 'talon-peek-wrap');
    const peekCard = cardEl(state.room.specialBottomCard.card, {});
    peekWrap.appendChild(peekCard);
    peekWrap.onclick = stockClickable ? actionTryBottomCard : null;
    if (!stockClickable) peekWrap.style.cursor = 'not-allowed';
    stockStack.appendChild(peekWrap);
  }
  const frontCard = state.room.stock.length > 0 ? cardBackEl(false, state.room.stock[0]) : (() => { const d = el('div', 'card back deck-0'); d.style.opacity = '0.3'; return d; })();
  if (hasPeek) frontCard.classList.add('talon-front');
  frontCard.onclick = stockClickable ? actionDrawStock : null;
  if (!stockClickable) stockStack.classList.add('disabled');
  stockStack.appendChild(frontCard);
  stockWrap.appendChild(stockStack);
  stockWrap.appendChild(el('div', 'pile-label', `Talon (${state.room.stock.length})`));
  pilesRow.appendChild(stockWrap);

  // Discard
  const discardWrap = el('div', 'special-card-wrap');
  const discardClickable = isMyTurn() && state.room.turnPhase === 'draw' && state.room.discard.length > 0
    && !state.room.mustDrawFromStock;
  const discardStack = el('div', 'pile-stack' + (discardClickable ? '' : ' disabled'));
  if (state.room.discard.length > 0) {
    discardStack.appendChild(cardEl(state.room.discard[state.room.discard.length - 1], {}));
  } else {
    const d = el('div', 'card'); d.style.opacity = '0.25'; d.textContent = '—';
    discardStack.appendChild(d);
  }
  discardStack.onclick = discardClickable ? actionDrawDiscard : null;
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
      const canReplaceJoker = clickable && isMyTurn() && state.room.turnPhase === 'meld' && !state.room.pendingJokerToPlace && state.selectedIds.size === 1;
      sortMeldForDisplay(m.cards).forEach(c => {
        const cardElement = cardEl(c, { mini: true });
        if (c.joker && canReplaceJoker) {
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
      line.appendChild(groupDiv);
    });
    meldsArea.appendChild(line);
  });
  container.appendChild(meldsArea);
}

function sortMeldForDisplay(cards) {
  const resolved = resolveMeld(cards);
  if (!resolved || resolved.type !== 'run') {
    // Sets: order doesn't matter, keep it simple - reals sorted, jokers trailing.
    const normal = cards.filter(c => !c.joker);
    const jokers = cards.filter(c => c.joker);
    return normal.slice().sort((a, b) => a.rank - b.rank).concat(jokers);
  }
  // Runs: resolved.cards is already in ascending sequence order - place each
  // joker at the exact slot of the card it substitutes instead of trailing.
  return resolved.cards.map(item => {
    if (item.isJoker) return cards.find(c => c.id === item.jokerCardId) || cards.find(c => c.joker);
    return cards.find(c => c.id === item.card.id) || item.card;
  });
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
  const countLbl = el('div', 'small', myHand().length + ' karata');
  titleRow.appendChild(countLbl);
  handWrap.appendChild(titleRow);

  const selectedCards = getSelectedCards();

  const myTurn = isMyTurn();
  const canPick = myTurn && state.room.turnPhase === 'meld';
  // Reserve the same top space whenever cards are clickable, not just when one
  // is actually selected - a hovered (but unselected) card also lifts via
  // .card-slot:hover and would otherwise overlap the "Zbir ruke" text above.
  const cardsRow = el('div', 'hand-cards' + ((canPick || selectedCards.length > 0) ? ' has-selection' : ''));
  const myHandOrder = (state.room.handOrders || {})[state.session.playerId] || null;
  const myDrawnCardId = state.room.lastDrawnPlayerId === state.session.playerId ? state.room.lastDrawnCardId : null;
  orderHand(myHand(), myHandOrder, myDrawnCardId).forEach(c => {
    const selected = state.selectedIds.has(c.id);
    const drawn = state.room.lastDrawnPlayerId === state.session.playerId && state.room.lastDrawnCardId === c.id;
    const pending = state.room.pendingJokerToPlace && state.room.pendingJokerToPlace.playerId === state.session.playerId && state.room.pendingJokerToPlace.jokerCardId === c.id;
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

  if (myTurn && state.room.pendingJokerToPlace && state.room.pendingJokerToPlace.playerId === state.session.playerId) {
    const warn = el('div', 'small center', '⚠️ Imas dzokera (zlatno oivicen u ruci) koga moras da spustis - novom kombinacijom ili dodavanjem na postojeci niz - pre nego sto bacis kartu.');
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
    if (opened) {
      layBtn.textContent = 'Izlozi se';
      layBtn.disabled = state.selectedIds.size < 3 || selectingWholeHand;
    } else {
      layBtn.append(
        'Izlozi se (', el('span', 'lay-btn-sum', String(computeSelectedSum(selectedCards))),
        ') [', el('span', 'lay-btn-sum', String(maliHandValue(selectedCards))), ']'
      );
      layBtn.disabled = state.selectedIds.size === 0;
    }
    layBtn.onclick = actionLayMultipleSelected;
    bar.appendChild(layBtn);

    if (opened) {
      const addBtn = el('button', 'btn btn-outline-gold', 'Krpi se');
      addBtn.disabled = state.selectedIds.size === 0 || selectingWholeHand;
      addBtn.onclick = () => showToast('Izabrao si karte - sad klikni na kombinaciju na stolu na koju zelis da ih dodas.');
      bar.appendChild(addBtn);
    }

    const hasSelection = state.selectedIds.size > 0;
    const clearBtn = el('button', 'btn btn-outline-gold btn-clear-toggle', opened || hasSelection ? 'Ponisti izbor' : 'Izaberi sve karte');
    if (opened) {
      clearBtn.disabled = !hasSelection;
    }
    clearBtn.onclick = () => {
      if (hasSelection) {
        state.selectedIds.clear();
      } else {
        myHand().forEach(c => state.selectedIds.add(c.id));
      }
      render();
    };
    bar.appendChild(clearBtn);

    const hasPendingJoker = state.room.pendingJokerToPlace && state.room.pendingJokerToPlace.playerId === state.session.playerId;
    const selectedIsDiscardDraw = state.selectedIds.size === 1 && [...state.selectedIds][0] === state.room.discardDrawCardId;
    const selectedJokerNotLastCard = state.selectedIds.size === 1 && !selectedIsDiscardDraw
      && myHand().length > 1
      && myHand().find(c => c.id === [...state.selectedIds][0])?.joker;
    const discardBtn = el('button', 'btn btn-danger', selectedIsDiscardDraw ? 'Vrati kartu na otpad' : 'Baci izabranu kartu');
    discardBtn.disabled = state.selectedIds.size !== 1 || hasPendingJoker || selectedJokerNotLastCard;
    discardBtn.onclick = () => { const id = [...state.selectedIds][0]; actionDiscard(id); };
    bar.appendChild(discardBtn);
  } else if (myTurn && state.room.turnPhase === 'draw' && state.room.mustDrawFromStock) {
    bar.appendChild(el('div', 'small center', 'Vratio si kartu na otpad - vuci kartu sa talona da nastavis.'));
  }

  app.appendChild(bar);
}

function renderGame(app) {
  const panel = el('div', 'card-panel table-area');
  renderOpponents(panel);
  const toastAnchor = el('div', 'toast-anchor');
  toastAnchor.id = 'toast-anchor';
  panel.appendChild(toastAnchor);
  renderCenterTable(panel);
  renderHandAndActions(panel);
  app.appendChild(panel);
  renderResetControl(app);
}

function renderResetControl(app) {
  const isHost = state.room.players[0] && state.room.players[0].id === state.session.playerId;
  if (!isHost) return;
  const wrap = el('div', 'center');
  wrap.style.marginTop = '14px';
  const btn = el('button', 'btn btn-danger', 'Prekini igru i resetuj');
  btn.onclick = hostResetGame;
  wrap.appendChild(btn);
  app.appendChild(wrap);
}

function renderRoundEnd(app) {
  if (state.lastRoundEndRound !== state.room.round) {
    state.roundEndStage = 'announce';
    state.lastRoundEndRound = state.room.round;
  }
  if (state.roundEndStage === 'announce') renderRoundAnnounce(app);
  else renderRoundScores(app);
  renderResetControl(app);
}

function renderRoundAnnounce(app) {
  const panel = el('div', 'card-panel');
  const winner = state.room.players.find(p => p.id === state.room.roundWinner);
  const typeLabel = { mali: 'Mali Hand', veliki: 'Veliki Hand' }[state.room.roundWinType] || 'regularno';
  panel.appendChild(el('div', 'winner-banner', `🏆 ${winner ? winner.name : '?'} pobedjuje!`));
  panel.appendChild(el('div', 'small center', 'Nacin pobede: ' + typeLabel));

  const discardWrap = el('div', 'special-card-wrap');
  const discardStack = el('div', 'pile-stack disabled');
  if (state.room.discard.length > 0) {
    discardStack.appendChild(cardEl(state.room.discard[state.room.discard.length - 1], {}));
  } else {
    const d = el('div', 'card'); d.style.opacity = '0.25'; d.textContent = '—';
    discardStack.appendChild(d);
  }
  discardWrap.appendChild(discardStack);
  discardWrap.appendChild(el('div', 'pile-label', 'Poslednja odbacena karta'));
  panel.appendChild(discardWrap);

  renderMeldsForPlayers(panel, { clickable: false });

  if (state.room.roundWinType === 'mali') {
    panel.appendChild(el('div', 'meld-owner-label', (winner ? winner.name : '?') + ' - ruka (Mali Hand)'));
    const row = el('div', 'hand-cards');
    sortHand(state.room.hands[state.room.roundWinner] || []).forEach(c => {
      row.appendChild(cardEl(c, { mini: true }));
    });
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
  const panel = el('div', 'card-panel');
  const winner = state.room.players.find(p => p.id === state.room.roundWinner);
  const typeLabel = { mali: 'Mali Hand', veliki: 'Veliki Hand' }[state.room.roundWinType] || 'regularno';
  panel.appendChild(el('div', 'winner-banner', `🏆 ${winner ? winner.name : '?'} pobedjuje!`));
  panel.appendChild(el('div', 'small center', 'Nacin pobede: ' + typeLabel));

  const deltaTable = document.createElement('table');
  deltaTable.className = 'score-table';
  deltaTable.innerHTML = '<tr><th>Igrac</th><th>Runda</th><th>Ukupno</th></tr>';
  state.room.players.forEach(p => {
    const tr = document.createElement('tr');
    const delta = (state.room.lastDeltas && state.room.lastDeltas[p.id]) || 0;
    tr.innerHTML = `<td class="name">${p.name}</td><td>${delta > 0 ? '+' : ''}${delta}</td><td>${state.room.scores[p.id] || 0}</td>`;
    deltaTable.appendChild(tr);
  });
  panel.appendChild(deltaTable);

  panel.appendChild(el('div', 'divider'));

  panel.appendChild(el('div', 'small center', 'Istorija po rundama'));
  const historyWrap = el('div', 'score-history-wrap');
  historyWrap.appendChild(buildScoreHistoryTable(state.room));
  panel.appendChild(historyWrap);

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
    const forceBtn = el('button', 'btn btn-outline-gold', 'Podeli ionako');
    forceBtn.style.width = '100%';
    forceBtn.style.marginTop = '8px';
    forceBtn.onclick = actionForceNextRound;
    panel.appendChild(forceBtn);
  }

  app.appendChild(panel);
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
