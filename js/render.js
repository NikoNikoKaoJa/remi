import { state, APP_VERSION } from './state.js';
import { resolveMeld, canUseDiscardCard, maliHandValue, cardValueStandard, computeSelectedSum } from './engine.js';
import { cardEl, cardBackEl, sortHand } from './cards.js';
import { showToast, checkQuadAnnouncement } from './ui.js';
import {
  isMyTurn, myHand, getSelectedCards,
  actionDrawStock, actionTryBottomCard, actionDrawDiscard, actionReplaceJoker,
  actionAddToMeld, actionLayMultipleSelected, actionDeclareMaliHand,
  actionDeclareVelikiHand, actionDeclareFourJokerHand, actionDiscard,
  hostStartGame, hostResetGame, hostNextRound,
} from './actions.js';
import { createRoom, joinRoom, leaveRoom } from './room.js';

// ===== Rendering =====
export function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

export function render() {
  const app = document.getElementById('app');
  app.innerHTML = '';
  const isGameScreen = state.dbUrl && state.session.roomCode && state.room && state.room.phase === 'playing';
  if (!isGameScreen) {
    const brand = el('div', 'brand');
    brand.innerHTML = `<span class="suits">♠♥</span><h1>REMI<em>.</em></h1><span class="version">${APP_VERSION}</span><span class="suits">♦♣</span>`;
    app.appendChild(brand);
    app.appendChild(el('div', 'subtitle', 'Varijanta sa dzokerima • pravilo od 51 • mali/veliki hand'));
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
  }
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

  panel.appendChild(el('div', 'divider'));

  const joinField = el('div', 'field');
  joinField.innerHTML = '<label>Kod sobe</label>';
  const codeInput = document.createElement('input');
  codeInput.placeholder = 'npr. A1B2';
  codeInput.style.textTransform = 'uppercase';
  codeInput.id = 'code-input';
  const params = new URLSearchParams(location.search);
  const roomFromLink = params.get('room');
  if (roomFromLink) codeInput.value = roomFromLink.toUpperCase();
  joinField.appendChild(codeInput);
  panel.appendChild(joinField);

  const joinBtn = el('button', 'btn btn-ghost', 'Pridruzi se sobi');
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
  panel.appendChild(el('div', 'small', 'Posalji ovaj link ostalima - kad ga otvore, sve je vec podeseno, samo unose ime i pridruzuju se:'));

  const shareUrl = `${location.origin}${location.pathname}?db=${encodeURIComponent(state.dbUrl)}&room=${state.room.code}`;
  const linkBox = el('div', 'field');
  const linkInput = document.createElement('input');
  linkInput.value = shareUrl;
  linkInput.readOnly = true;
  linkInput.style.fontSize = '12px';
  linkBox.appendChild(linkInput);
  panel.appendChild(linkBox);
  const copyBtn = el('button', 'btn btn-ghost', 'Kopiraj link');
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
    chip.textContent = p.name + (p.id === state.session.playerId ? ' (ti)' : '');
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
    const startBtn = el('button', 'btn btn-gold', `Zapocni igru (${state.room.players.length} igraca)`);
    startBtn.disabled = state.room.players.length < 2;
    startBtn.onclick = hostStartGame;
    panel.appendChild(startBtn);
    if (state.room.players.length < 2) panel.appendChild(el('div', 'small', 'Ceka se jos bar 1 igrac...'));
  } else {
    panel.appendChild(el('div', 'small', 'Cekamo da host (' + state.room.players[0].name + ') zapocne igru...'));
  }

  const leaveBtn = el('button', 'btn btn-ghost', 'Napusti sobu');
  leaveBtn.style.width = '100%';
  leaveBtn.style.marginTop = '10px';
  leaveBtn.onclick = leaveRoom;
  panel.appendChild(leaveBtn);
  app.appendChild(panel);
}

function renderOpponents(app) {
  const rowEl = el('div', 'opponents-row');
  state.room.players.forEach((p, i) => {
    if (p.id === state.session.playerId) return;
    const c = el('div', 'opp-card' + (state.room.currentPlayerIndex === i ? ' active' : ''));
    const nameLine = el('div', 'name', p.name);
    c.appendChild(nameLine);
    const handCount = (state.room.hands[p.id] || []).length;
    const meta = el('div', 'meta');
    meta.innerHTML = (state.room.openedPlayers.includes(p.id) ? '<span class="opened-dot"></span>Izlozen' : 'Nije izlozen') + ` • ${handCount} karata`;
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

  // Stock
  const stockWrap = el('div', 'special-card-wrap');
  const stockClickable = isMyTurn() && state.room.turnPhase === 'draw';
  const stockStack = el('div', 'pile-stack' + (stockClickable ? '' : ' disabled'));
  if (state.room.stock.length > 0) stockStack.appendChild(cardBackEl());
  else stockStack.appendChild((() => { const d = el('div', 'card back'); d.style.opacity = '0.3'; return d; })());
  stockStack.onclick = stockClickable ? actionDrawStock : null;
  stockWrap.appendChild(stockStack);
  stockWrap.appendChild(el('div', 'pile-label', `Talon (${state.room.stock.length})`));
  pilesRow.appendChild(stockWrap);

  // Special bottom card
  if (state.room.specialBottomCard && !state.room.specialBottomCard.taken) {
    const specWrap = el('div', 'special-card-wrap');
    const specClickable = isMyTurn() && state.room.turnPhase === 'draw';
    const wrapDiv = el('div', 'pile-stack' + (specClickable ? '' : ' disabled'));
    wrapDiv.appendChild(cardEl(state.room.specialBottomCard.card, {}));
    wrapDiv.onclick = specClickable ? actionTryBottomCard : null;
    specWrap.appendChild(wrapDiv);
    specWrap.appendChild(el('div', 'pile-label', 'Ispod talona (samo za hand)'));
    pilesRow.appendChild(specWrap);
  }

  // Discard
  const discardWrap = el('div', 'special-card-wrap');
  const discardClickable = isMyTurn() && state.room.turnPhase === 'draw' && state.room.discard.length > 0
    && canUseDiscardCard(state.room.discard[state.room.discard.length - 1], myHand(), state.room.openedPlayers.includes(state.session.playerId), state.room.melds);
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

  // Melds on table, grouped by owner
  const meldsArea = el('div', 'melds-area');
  state.room.players.forEach((p, pi) => {
    const ownMelds = state.room.melds.map((m, idx) => ({ m, idx })).filter(x => x.m.ownerId === p.id);
    if (ownMelds.length === 0) return;
    meldsArea.appendChild(el('div', 'meld-owner-label', p.name + (p.id === state.session.playerId ? ' (ti)' : '')));
    const line = el('div', null);
    ownMelds.forEach(({ m, idx }) => {
      const canTarget = isMyTurn() && state.room.turnPhase === 'meld' && state.room.openedPlayers.includes(state.session.playerId) && state.selectedIds.size > 0;
      const groupDiv = el('div', 'meld-group' + (canTarget ? ' targetable' : ''));
      const cardsDiv = el('div', 'meld-cards');
      const canReplaceJoker = isMyTurn() && state.room.turnPhase === 'meld' && !state.room.pendingJokerToPlace && state.selectedIds.size === 1;
      sortMeldForDisplay(m.cards).forEach(c => {
        const cardElement = cardEl(c, { mini: true });
        if (c.joker && canReplaceJoker) {
          cardElement.classList.add('clickable');
          cardElement.classList.add('joker-replaceable');
          cardElement.onclick = (e) => { e.stopPropagation(); actionReplaceJoker(idx, c.id); };
        }
        cardsDiv.appendChild(cardElement);
      });
      groupDiv.appendChild(cardsDiv);
      if (canTarget) groupDiv.onclick = () => actionAddToMeld(p.id, idx);
      line.appendChild(groupDiv);
    });
    meldsArea.appendChild(line);
  });
  center.appendChild(meldsArea);

  app.appendChild(center);
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
  titleRow.appendChild(el('h3', null, 'Tvoja ruka'));
  const countLbl = el('div', 'small', myHand().length + ' karata');
  titleRow.appendChild(countLbl);
  handWrap.appendChild(titleRow);

  const sumRow = el('div', 'small');
  sumRow.style.textAlign = 'center';
  sumRow.style.marginBottom = '4px';
  sumRow.style.color = 'var(--gold-bright)';
  const opened_ = state.room.openedPlayers.includes(state.session.playerId);
  let sumText;
  if (!opened_) {
    sumText = `Zbir ruke (mali hand): ${maliHandValue(myHand())}`;
  } else {
    const standardSum = myHand().reduce((s, c) => s + cardValueStandard(c), 0);
    sumText = `Zbir ruke: ${standardSum}`;
  }
  sumRow.textContent = sumText;
  handWrap.appendChild(sumRow);

  const selectedCards = getSelectedCards();
  if (selectedCards.length > 0) {
    const sum = computeSelectedSum(selectedCards);
    const selRow = el('div', 'small');
    selRow.style.textAlign = 'center';
    selRow.style.marginBottom = '8px';
    selRow.style.color = 'var(--cream-dim)';
    selRow.textContent = `Zbir izabranih: ${sum}`;
    handWrap.appendChild(selRow);
  }

  const cardsRow = el('div', 'hand-cards');
  const myTurn = isMyTurn();
  const canPick = myTurn && state.room.turnPhase === 'meld';
  sortHand(myHand()).forEach(c => {
    const selected = state.selectedIds.has(c.id);
    const drawn = state.room.lastDrawnPlayerId === state.session.playerId && state.room.lastDrawnCardId === c.id;
    const pending = state.room.pendingJokerToPlace && state.room.pendingJokerToPlace.playerId === state.session.playerId && state.room.pendingJokerToPlace.jokerCardId === c.id;
    const cd = cardEl(c, {
      clickable: canPick,
      selected,
      onClick: canPick ? () => { if (selected) state.selectedIds.delete(c.id); else state.selectedIds.add(c.id); render(); } : null,
    });
    if (drawn) cd.classList.add('just-drawn');
    if (pending) cd.classList.add('pending-joker');
    cardsRow.appendChild(cd);
  });
  handWrap.appendChild(cardsRow);
  app.appendChild(handWrap);

  // Turn banner
  const banner = el('div', 'turn-banner');
  if (state.room.phase === 'playing') {
    const cur = state.room.players[state.room.currentPlayerIndex];
    if (myTurn) {
      banner.textContent = state.room.turnPhase === 'draw' ? 'Tvoj red - vuci kartu' : 'Tvoj red - odigraj i odbaci';
    } else {
      banner.textContent = `Na potezu: ${cur.name}`;
    }
  }
  app.appendChild(banner);

  if (myTurn && state.room.pendingJokerToPlace && state.room.pendingJokerToPlace.playerId === state.session.playerId) {
    const warn = el('div', 'small center', '⚠️ Imas dzokera (zlatno oivicen u ruci) koga moras da spustis - novom kombinacijom ili dodavanjem na postojeci niz - pre nego sto odbacis kartu.');
    warn.style.color = 'var(--gold-bright)';
    warn.style.marginBottom = '10px';
    app.appendChild(warn);
  }

  const bar = el('div', 'action-bar');
  const opened = state.room.openedPlayers.includes(state.session.playerId);

  if (myTurn && state.room.turnPhase === 'meld') {
    const layBtn = el('button', 'btn btn-gold', opened ? 'Spusti kombinaciju' : 'Izlozi se (51+)');
    layBtn.disabled = state.selectedIds.size < 3;
    layBtn.onclick = actionLayMultipleSelected;
    bar.appendChild(layBtn);

    if (opened) {
      const addBtn = el('button', 'btn btn-ghost', 'Dodaj na kombinaciju (klikni na sto)');
      addBtn.disabled = state.selectedIds.size === 0;
      addBtn.onclick = () => showToast('Izabrao si karte - sad klikni na kombinaciju na stolu na koju zelis da ih dodas.');
      bar.appendChild(addBtn);
    }

    if (!opened) {
      const maliBtn = el('button', 'btn btn-ghost', 'Mali Hand');
      maliBtn.onclick = actionDeclareMaliHand;
      bar.appendChild(maliBtn);

      const velikiBtn = el('button', 'btn btn-ghost', 'Veliki Hand');
      velikiBtn.onclick = actionDeclareVelikiHand;
      bar.appendChild(velikiBtn);

      const fourJBtn = el('button', 'btn btn-ghost', '4 Dzokera / 8 Istih');
      fourJBtn.onclick = actionDeclareFourJokerHand;
      bar.appendChild(fourJBtn);
    }

    const clearBtn = el('button', 'btn btn-ghost', 'Ponisti izbor');
    clearBtn.disabled = state.selectedIds.size === 0;
    clearBtn.onclick = () => { state.selectedIds.clear(); render(); };
    bar.appendChild(clearBtn);

    const hasPendingJoker = state.room.pendingJokerToPlace && state.room.pendingJokerToPlace.playerId === state.session.playerId;
    const discardBtn = el('button', 'btn btn-danger', 'Odbaci izabranu kartu');
    discardBtn.disabled = state.selectedIds.size !== 1 || hasPendingJoker;
    discardBtn.onclick = () => { const id = [...state.selectedIds][0]; actionDiscard(id); };
    bar.appendChild(discardBtn);
  } else if (myTurn && state.room.turnPhase === 'draw') {
    bar.appendChild(el('div', 'small center', 'Vuci kartu sa talona ili otpada da nastavis.'));
  }

  app.appendChild(bar);

  const log = el('div', 'log-box');
  (state.room.log || []).slice(-8).forEach(l => log.appendChild(el('div', null, l)));
  app.appendChild(log);
}

function renderGame(app) {
  const panel = el('div', 'card-panel table-area');
  renderOpponents(panel);
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
  const panel = el('div', 'card-panel');
  const winner = state.room.players.find(p => p.id === state.room.roundWinner);
  const typeLabel = { mali: 'Mali Hand', veliki: 'Veliki Hand', fourJoker: '4 Dzokera / 8 Istih' }[state.room.roundWinType] || 'regularno';
  panel.appendChild(el('div', 'winner-banner', `🏆 ${winner ? winner.name : '?'} pobedjuje!`));
  panel.appendChild(el('div', 'small center', 'Nacin pobede: ' + typeLabel));

  const table = document.createElement('table');
  table.className = 'score-table';
  table.innerHTML = '<tr><th>Igrac</th><th>Runda</th><th>Ukupno</th></tr>';
  state.room.players.forEach(p => {
    const tr = document.createElement('tr');
    const delta = (state.room.lastDeltas && state.room.lastDeltas[p.id]) || 0;
    tr.innerHTML = `<td class="name">${p.name}</td><td>${delta > 0 ? '+' : ''}${delta}</td><td>${state.room.scores[p.id] || 0}</td>`;
    table.appendChild(tr);
  });
  panel.appendChild(table);

  panel.appendChild(el('div', 'divider'));
  const isHost = state.room.players[0] && state.room.players[0].id === state.session.playerId;
  if (isHost) {
    const nextBtn = el('button', 'btn btn-gold', 'Sledeca runda');
    nextBtn.style.width = '100%';
    nextBtn.onclick = hostNextRound;
    panel.appendChild(nextBtn);
  } else {
    panel.appendChild(el('div', 'small center', 'Cekamo da host pokrene sledecu rundu...'));
  }
  app.appendChild(panel);
  renderResetControl(app);
}
