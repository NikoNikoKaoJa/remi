import { state, saveDismissedQuadAnnouncements } from './state.js';
import {
  setupRound, scoreRound, sweepCompletedQuads, isValidMeld, sumOpeningValue,
  findPartition, enumerateSingleJokerRunWindows, sequenceLabel, resolveMeld,
  findFourJokerOrEightSame, maliHandValue, canUseDiscardCard, shuffle,
} from './engine.js';
import { SUIT_SYM, rankLabel } from './cards.js';
import { saveRoom } from './storage.js';
import { showToast, showChoiceModal } from './ui.js';
import { render } from './render.js';

// ===== Round setup wrapper (uses engine above) =====
export function beginRound(r) {
  if (!r.scores) r.scores = {};
  const engineState = setupRound(r.players, r.dealerIndex);
  Object.assign(r, engineState);
  r.round = (r.round || 0) + 1;
  r.players.forEach(p => { if (!(p.id in r.scores)) r.scores[p.id] = 0; });
  return r;
}

export async function hostStartGame() {
  if (state.room.players.length < 2) { showToast('Treba bar 2 igraca.'); return; }
  state.busy = true;
  beginRound(state.room);
  await saveRoom(state.room);
  state.busy = false;
  render();
}

export async function hostNextRound() {
  state.busy = true;
  state.room.dealerIndex = (state.room.dealerIndex + 1) % state.room.players.length;
  beginRound(state.room);
  await saveRoom(state.room);
  state.busy = false;
  render();
}

export async function hostResetGame() {
  const ok = confirm('Da li sigurno zelis da prekines igru i resetujes sve? Ovo brise trenutno stanje partije za sve igrace.');
  if (!ok) return;
  state.busy = true;
  const me = state.room.players.find(p => p.id === state.session.playerId);
  state.room.phase = 'lobby';
  state.room.round = 0;
  state.room.dealerIndex = 0;
  state.room.players = me ? [me] : [];
  state.room.hands = {};
  state.room.stock = [];
  state.room.discard = [];
  state.room.melds = [];
  state.room.openedPlayers = [];
  state.room.scores = {};
  state.room.log = [];
  state.room.specialBottomCard = null;
  state.room.currentPlayerIndex = 0;
  state.room.turnPhase = null;
  state.room.roundWinner = null;
  state.room.roundWinType = null;
  state.room.lastDeltas = null;
  state.room.quadAnnouncements = [];
  state.dismissedQuadAnnouncements.clear();
  saveDismissedQuadAnnouncements();
  await saveRoom(state.room);
  state.busy = false;
  render();
}

// ===== Turn helpers =====
export function myIndex() { return state.room.players.findIndex(p => p.id === state.session.playerId); }
export function isMyTurn() { return state.room.phase === 'playing' && state.room.currentPlayerIndex === myIndex(); }
export function myHand() { return state.room.hands[state.session.playerId] || []; }

export function advanceTurn(r) {
  const n = r.players.length;
  r.currentPlayerIndex = (r.currentPlayerIndex + 1) % n;
  r.turnPhase = 'draw';
}

export async function endRoundWithWinner(r, winnerId, handType) {
  const deltas = scoreRound(r, winnerId, handType);
  r.players.forEach(p => { r.scores[p.id] = (r.scores[p.id] || 0) + deltas[p.id]; });
  r.roundWinner = winnerId;
  r.roundWinType = handType;
  r.lastDeltas = deltas;
  r.phase = 'round_end';
  const label = handType === 'mali' ? 'malim handom' : handType === 'veliki' ? 'velikim handom' : handType === 'fourJoker' ? 'handom (4 dzokera/8 istih)' : 'regularno';
  r.log.push(`${r.players.find(p => p.id === winnerId).name} je zavrsio rundu (${label})!`);
}

export function getSelectedCards() {
  const hand = state.room.hands[state.session.playerId] || [];
  return hand.filter(c => state.selectedIds.has(c.id));
}

// ===== Actions =====
export async function actionDrawStock() {
  if (!isMyTurn() || state.room.turnPhase !== 'draw' || state.busy) return;
  state.busy = true;
  if (state.room.stock.length === 0) {
    if (state.room.discard.length <= 1) { showToast('Nema vise karata za vucenje.'); state.busy = false; return; }
    const top = state.room.discard.pop();
    state.room.stock = shuffle(state.room.discard);
    state.room.discard = [top];
  }
  const card = state.room.stock.shift();
  myHandPush(card);
  state.room.turnPhase = 'meld';
  await saveRoom(state.room);
  state.busy = false;
  render();
}
function myHandPush(card) {
  if (!state.room.hands[state.session.playerId]) state.room.hands[state.session.playerId] = [];
  state.room.hands[state.session.playerId].push(card);
  state.room.lastDrawnPlayerId = state.session.playerId;
  state.room.lastDrawnCardId = card.id;
}

export async function actionDrawDiscard() {
  if (!isMyTurn() || state.room.turnPhase !== 'draw' || state.busy) return;
  if (state.room.discard.length === 0) { showToast('Otpad je prazan.'); return; }
  const card = state.room.discard[state.room.discard.length - 1];
  const opened = state.room.openedPlayers.includes(state.session.playerId);
  if (!canUseDiscardCard(card, myHand(), opened, state.room.melds)) {
    showToast('Ne mozes da vuces tu kartu sa otpada - nema kombinacije gde bi je odmah izlozio.');
    return;
  }
  state.busy = true;
  state.room.discard.pop();
  myHandPush(card);
  state.room.turnPhase = 'meld';
  await saveRoom(state.room);
  state.busy = false;
  render();
}

export async function actionDiscard(cardId) {
  if (!isMyTurn() || state.room.turnPhase !== 'meld' || state.busy) return;
  if (state.room.pendingJokerToPlace && state.room.pendingJokerToPlace.playerId === state.session.playerId) {
    showToast('Prvo moras da spustis dzokera kog si zamenio (nova kombinacija ili dodavanje na postojeci niz).');
    return;
  }
  state.busy = true;
  const hand = state.room.hands[state.session.playerId];
  const idx = hand.findIndex(c => c.id === cardId);
  if (idx === -1) { state.busy = false; return; }
  const [card] = hand.splice(idx, 1);
  state.room.discard.push(card);
  state.selectedIds.clear();
  if (hand.length === 0) {
    await endRoundWithWinner(state.room, state.session.playerId, null);
  } else {
    advanceTurn(state.room);
  }
  await saveRoom(state.room);
  state.busy = false;
  render();
}

export async function actionLayMultipleSelected() {
  // Lay out ALL currently selected cards at once, auto-partitioned into melds.
  // Used for the opening play when it takes multiple melds to reach 51 points.
  if (!isMyTurn() || state.room.turnPhase !== 'meld' || state.busy) return;
  const cards = getSelectedCards();
  if (cards.length < 3) { showToast('Izaberi karte za izlaganje.'); return; }
  const partition = findPartition(cards);
  if (!partition) { showToast('Izabrane karte se ne mogu podeliti u validne kombinacije.'); return; }
  for (const group of partition) {
    const opts = enumerateSingleJokerRunWindows(group);
    if (opts) {
      const jokerCard = group.find(c => c.joker && c._lockedRank === undefined);
      showChoiceModal('Gde treba dzoker da bude u nizu?', opts.map(o => ({ label: sequenceLabel(o), opt: o })), (picked) => {
        jokerCard._lockedRank = picked.opt.jokerRank;
        jokerCard._lockedAceHigh = picked.opt.jokerAceHigh;
        actionLayMultipleSelected();
      });
      return;
    }
  }
  const opened = state.room.openedPlayers.includes(state.session.playerId);
  if (!opened) {
    const val = sumOpeningValue(partition);
    if (val < 51) { showToast(`Ukupno ${val} poena - treba 51+ za prvo izlaganje.`); return; }
  }
  state.busy = true;
  const hand = state.room.hands[state.session.playerId];
  cards.forEach(c => {
    const idx = hand.findIndex(h => h.id === c.id);
    if (idx !== -1) hand.splice(idx, 1);
  });
  partition.forEach(group => state.room.melds.push({ ownerId: state.session.playerId, cards: group }));
  if (!opened) state.room.openedPlayers.push(state.session.playerId);
  state.selectedIds.clear();
  if (state.room.pendingJokerToPlace && state.room.pendingJokerToPlace.playerId === state.session.playerId
      && !hand.some(c => c.id === state.room.pendingJokerToPlace.jokerCardId)) {
    state.room.pendingJokerToPlace = null;
  }
  sweepCompletedQuads(state.room);
  if (hand.length === 0) {
    await endRoundWithWinner(state.room, state.session.playerId, null);
  }
  await saveRoom(state.room);
  state.busy = false;
  render();
}

export async function actionAddToMeld(ownerIdOfMeld, meldIdx) {
  if (!isMyTurn() || state.room.turnPhase !== 'meld' || state.busy) return;
  if (!state.room.openedPlayers.includes(state.session.playerId)) { showToast('Prvo se moras izloziti (51+ poena) da bi dodavao karte.'); return; }
  const cards = getSelectedCards();
  if (cards.length === 0) { showToast('Izaberi karte iz ruke koje zelis da dodas.'); return; }
  const meld = state.room.melds[meldIdx];
  if (!meld) return;
  const combined = meld.cards.concat(cards);
  if (!isValidMeld(combined)) { showToast('Te karte ne mogu da se dodaju na tu kombinaciju.'); return; }
  const opts = enumerateSingleJokerRunWindows(combined);
  if (opts) {
    const jokerCard = combined.find(c => c.joker && c._lockedRank === undefined);
    showChoiceModal('Gde treba dzoker da bude u nizu?', opts.map(o => ({ label: sequenceLabel(o), opt: o })), (picked) => {
      jokerCard._lockedRank = picked.opt.jokerRank;
      jokerCard._lockedAceHigh = picked.opt.jokerAceHigh;
      actionAddToMeld(ownerIdOfMeld, meldIdx);
    });
    return;
  }
  state.busy = true;
  const hand = state.room.hands[state.session.playerId];
  cards.forEach(c => {
    const idx = hand.findIndex(h => h.id === c.id);
    if (idx !== -1) hand.splice(idx, 1);
  });
  meld.cards = combined;
  state.selectedIds.clear();
  state.addToMeldTarget = null;
  if (state.room.pendingJokerToPlace && state.room.pendingJokerToPlace.playerId === state.session.playerId
      && !hand.some(c => c.id === state.room.pendingJokerToPlace.jokerCardId)) {
    state.room.pendingJokerToPlace = null;
  }
  sweepCompletedQuads(state.room);
  if (hand.length === 0) {
    await endRoundWithWinner(state.room, state.session.playerId, null);
  }
  await saveRoom(state.room);
  state.busy = false;
  render();
}

export async function actionReplaceJoker(meldIdx, jokerCardId) {
  if (!isMyTurn() || state.room.turnPhase !== 'meld' || state.busy) return;
  if (state.room.pendingJokerToPlace && state.room.pendingJokerToPlace.playerId === state.session.playerId) {
    showToast('Prvo moras da spustis prethodnog dzokera koga si zamenio.');
    return;
  }
  const meld = state.room.melds[meldIdx];
  if (!meld) return;
  const resolved = resolveMeld(meld.cards);
  if (!resolved) return;
  const item = resolved.cards.find(it => it.isJoker && it.jokerCardId === jokerCardId);
  if (!item) return;
  const selected = getSelectedCards();
  if (selected.length !== 1) { showToast('Izaberi tacno jednu kartu iz ruke koja odgovara mestu dzokera.'); return; }
  const candidate = selected[0];
  if (candidate.joker) { showToast('Ne mozes zameniti dzokera drugim dzokerom.'); return; }
  const targetRank = item.substitutes.rank;
  if (resolved.type === 'set') {
    // In a set the joker can stand for any of the rank's missing suits, so the
    // candidate just needs the right rank and a suit not already on the table.
    if (candidate.rank !== targetRank) {
      showToast(`Ta karta ne odgovara mestu dzokera (treba ${rankLabel(targetRank)}).`);
      return;
    }
    const suitsInMeld = meld.cards.filter(c => !c.joker).map(c => c.suit);
    if (suitsInMeld.includes(candidate.suit)) {
      showToast('Ta boja vec postoji u toj grupi.');
      return;
    }
  } else {
    // In a run the joker's slot is a specific rank AND suit.
    const targetSuit = item.substitutes.suit;
    if (candidate.rank !== targetRank || candidate.suit !== targetSuit) {
      showToast(`Ta karta ne odgovara mestu dzokera (treba ${rankLabel(targetRank)} ${SUIT_SYM[targetSuit]}).`);
      return;
    }
  }
  state.busy = true;
  const hand = state.room.hands[state.session.playerId];
  const handIdx = hand.findIndex(c => c.id === candidate.id);
  hand.splice(handIdx, 1);
  const meldIdx2 = meld.cards.findIndex(c => c.id === jokerCardId);
  const jokerObj = meld.cards[meldIdx2];
  delete jokerObj._lockedRank;
  delete jokerObj._lockedAceHigh;
  meld.cards[meldIdx2] = candidate;
  hand.push(jokerObj);
  state.room.pendingJokerToPlace = { playerId: state.session.playerId, jokerCardId: jokerObj.id };
  state.selectedIds.clear();
  sweepCompletedQuads(state.room);
  await saveRoom(state.room);
  state.busy = false;
  render();
}

export async function actionDeclareMaliHand() {
  if (!isMyTurn() || state.room.turnPhase !== 'meld' || state.busy) return;
  const cards = getSelectedCards();
  if (cards.length !== 1) { showToast('Izaberi tacno jednu kartu koju bi odbacio, pa probaj Mali Hand.'); return; }
  const hand = state.room.hands[state.session.playerId];
  const remaining = hand.filter(c => !state.selectedIds.has(c.id));
  if (remaining.length !== 14) { showToast('Mali hand se proverava sa 14 preostalih karata.'); return; }
  const val = maliHandValue(remaining);
  if (val >= 51) { showToast(`Zbir ruke je ${val} - mora biti ispod 51 za Mali Hand.`); return; }
  state.busy = true;
  const discardCard = cards[0];
  const idx = hand.findIndex(c => c.id === discardCard.id);
  hand.splice(idx, 1);
  state.room.discard.push(discardCard);
  state.selectedIds.clear();
  await endRoundWithWinner(state.room, state.session.playerId, 'mali');
  await saveRoom(state.room);
  state.busy = false;
  render();
}

export async function actionDeclareVelikiHand() {
  if (!isMyTurn() || state.room.turnPhase !== 'meld' || state.busy) return;
  if (state.room.openedPlayers.includes(state.session.playerId)) { showToast('Veliki hand vazi samo ako se jos nisi izlagao ove runde.'); return; }
  const hand = state.room.hands[state.session.playerId];
  let found = null;
  for (let i = 0; i < hand.length; i++) {
    const leftover = hand[i];
    const rest = hand.filter((c, idx) => idx !== i);
    const partition = findPartition(rest);
    if (partition) { found = { leftover, partition }; break; }
  }
  if (!found) { showToast('Nemas validan Veliki Hand sa trenutnom rukom.'); return; }
  state.busy = true;
  found.partition.forEach(group => state.room.melds.push({ ownerId: state.session.playerId, cards: group }));
  state.room.discard.push(found.leftover);
  state.room.hands[state.session.playerId] = [];
  if (!state.room.openedPlayers.includes(state.session.playerId)) state.room.openedPlayers.push(state.session.playerId);
  state.selectedIds.clear();
  await endRoundWithWinner(state.room, state.session.playerId, 'veliki');
  await saveRoom(state.room);
  state.busy = false;
  render();
}

export async function actionDeclareFourJokerHand() {
  if (!isMyTurn() || state.room.turnPhase !== 'meld' || state.busy) return;
  if (state.room.openedPlayers.includes(state.session.playerId)) { showToast('Ovaj hand vazi samo ako se jos nisi izlagao ove runde.'); return; }
  const hand = state.room.hands[state.session.playerId];
  const found = findFourJokerOrEightSame(hand);
  if (!found) { showToast('Nemas 4 dzokera ni 8 istih karata u ruci.'); return; }
  state.busy = true;
  state.room.melds.push({ ownerId: state.session.playerId, cards: found });
  found.forEach(c => {
    const idx = hand.findIndex(h => h.id === c.id);
    if (idx !== -1) hand.splice(idx, 1);
  });
  if (!state.room.openedPlayers.includes(state.session.playerId)) state.room.openedPlayers.push(state.session.playerId);
  await endRoundWithWinner(state.room, state.session.playerId, 'fourJoker');
  await saveRoom(state.room);
  state.busy = false;
  render();
}

export async function actionTryBottomCard() {
  if (!isMyTurn() || state.room.turnPhase !== 'draw' || state.busy) return;
  if (!state.room.specialBottomCard || state.room.specialBottomCard.taken) { showToast('Nema dostupne karte ispod talona.'); return; }
  const card = state.room.specialBottomCard.card;
  const hypothetical = myHand().concat([card]);
  // Check if drawing this card immediately enables ANY hand declaration.
  let handType = null;
  if (findFourJokerOrEightSame(hypothetical)) handType = 'fourJoker';
  else {
    let velikiOk = false;
    for (let i = 0; i < hypothetical.length && !velikiOk; i++) {
      const rest = hypothetical.filter((c, idx) => idx !== i);
      if (findPartition(rest)) velikiOk = true;
    }
    if (velikiOk) handType = 'veliki';
    else {
      // mali hand: need some discard leaving 14 with sum<51
      let maliOk = false;
      for (let i = 0; i < hypothetical.length && !maliOk; i++) {
        const rest = hypothetical.filter((c, idx) => idx !== i);
        if (rest.length === 14 && maliHandValue(rest) < 51) maliOk = true;
      }
      if (maliOk) handType = 'mali';
    }
  }
  if (!handType) { showToast('Sa tom kartom ne mozes odmah da napravis hand.'); return; }
  state.busy = true;
  state.room.specialBottomCard.taken = true;
  myHandPush(card);
  state.room.turnPhase = 'meld';
  await saveRoom(state.room);
  state.busy = false;
  showToast('Uzeo si otkrivenu kartu! Sad mozes da proglasis odgovarajuci hand.', 3400);
  render();
}
