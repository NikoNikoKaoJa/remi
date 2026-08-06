import { state, saveDismissedQuadAnnouncements } from './state.js';
import {
  setupRound, scoreRound, sweepCompletedQuads, isValidMeld, sumOpeningValue,
  findPartition, findAllPartitions, expandPartitionOptions,
  resolvedOptionDisplayGroups, applyResolvedOptionLocks,
  enumerateSingleJokerRunWindows, runWindowPreviewCards, resolveMeld,
  maliHandValue, cardValueMaliHand, shuffle,
} from './engine.js';
import { SUIT_SYM, rankLabel, sortHand, orderHand } from './cards.js';
import { loadRoom, saveRoom, deleteRoom, applyCollectionDefaults } from './storage.js';
import { showToast, showChoiceModal, buildMeldGroupEl, buildPartitionPreviewEl } from './ui.js';
import { render } from './render.js';

// ===== Round setup -> cut-reveal -> deal =====
// Every round (including the very first) goes through a 'cutting' phase that
// shows who dealt/cut and which card before the hand is actually dealt - see
// beginCutReveal below. The dealer only rotates BETWEEN rounds, not before
// the first one, hence the split between beginCutReveal and startCutReveal.
export const CUT_REVEAL_MS = 3500;

function beginCutReveal(r) {
  r.pendingRound = setupRound(r.players, r.dealerIndex);
  r.phase = 'cutting';
  r.cutRevealedAt = Date.now();
  r.readyForNextRound = [];
}

function startCutReveal(r) {
  r.dealerIndex = (r.dealerIndex + 1) % r.players.length;
  beginCutReveal(r);
}

export async function hostStartGame() {
  if (state.room.players.length < 2) { showToast('Treba bar 2 igraca.'); return; }
  state.busy = true;
  if (!state.room.scores) state.room.scores = {};
  beginCutReveal(state.room);
  scheduleCutAdvance();
  await saveRoom(state.room);
  state.busy = false;
  render();
}

export function applyPendingRound(r) {
  if (!r.scores) r.scores = {};
  // pendingRound may have been round-tripped through Firebase (saved during
  // the 'cutting' phase, then reloaded by a different client/poll tick) -
  // Firebase drops any null/empty-array field on save, so restore them
  // before merging or a fresh round would silently inherit the previous
  // round's values (melds/discard/openedPlayers/stock, and setupRound's
  // null-valued scalars like discardDrawCardId/roundWinner/roundWinType/
  // pendingJokerToPlace - the latter caused a real bug: a stale
  // discardDrawCardId pointed at a card no longer in anyone's hand, making
  // it impossible to ever discard).
  const pr = r.pendingRound || {};
  applyCollectionDefaults(pr, ['melds', 'discard', 'openedPlayers', 'stock']);
  if (!pr.discardDrawCardId) pr.discardDrawCardId = null;
  if (!pr.bottomDrawCardId) pr.bottomDrawCardId = null;
  if (!pr.roundWinner) pr.roundWinner = null;
  if (!pr.roundWinType) pr.roundWinType = null;
  if (!pr.pendingJokerToPlace) pr.pendingJokerToPlace = null;
  Object.assign(r, pr);
  r.round = (r.round || 0) + 1;
  // Seed each player's order with their freshly-dealt hand pre-sorted, so the
  // opening hand reads nicely - but from here on this is just a regular
  // manual `handOrders` entry, so any card drawn afterward is only appended
  // (see orderHand in js/cards.js), never auto-resorted alongside it.
  r.handOrders = {};
  r.pinnedCardIds = {};
  // Not part of setupRound's output at all, so Object.assign(r, pr) never
  // touches these - clear them directly or the "just drawn" highlight/pin
  // from the previous round's last draw leaks into the new round.
  r.lastDrawnCardId = null;
  r.lastDrawnPlayerId = null;
  r.players.forEach(p => {
    r.handOrders[p.id] = sortHand(r.hands[p.id] || []).map(c => c.id);
  });
  r.players.forEach(p => { if (!(p.id in r.scores)) r.scores[p.id] = 0; });
  // Local-only UI state, so nothing in pendingRound resets it: any card ids
  // still selected from the round that just ended point at cards that no
  // longer exist in the new deal (see pruneSelection in js/render.js).
  state.selectedIds.clear();
  r.pendingRound = null;
  r.cutRevealedAt = null;
}

function scheduleCutAdvance() {
  setTimeout(async () => {
    if (state.room && state.room.phase === 'cutting' && state.room.pendingRound) {
      applyPendingRound(state.room);
      await saveRoom(state.room);
      render();
    }
  }, CUT_REVEAL_MS);
}

export function actionReadyForScores() {
  state.roundEndStage = 'scores';
  render();
}

export async function actionReadyForNextRound() {
  if (state.busy) return;
  const myId = state.session.playerId;
  if ((state.room.readyForNextRound || []).includes(myId)) return;
  state.busy = true;
  const fresh = await loadRoom(state.session.roomCode) || state.room;
  state.room = fresh;
  if (!state.room.readyForNextRound) state.room.readyForNextRound = [];
  if (!state.room.readyForNextRound.includes(myId)) state.room.readyForNextRound.push(myId);
  if (state.room.readyForNextRound.length >= state.room.players.length) {
    startCutReveal(state.room);
    scheduleCutAdvance();
  }
  await saveRoom(state.room);
  state.busy = false;
  render();
}

export async function actionForceNextRound() {
  const ok = confirm('Pokreni sledecu rundu i bez da su svi spremni?');
  if (!ok) return;
  state.busy = true;
  startCutReveal(state.room);
  scheduleCutAdvance();
  await saveRoom(state.room);
  state.busy = false;
  render();
}

export async function hostResetGame() {
  const ok = confirm('Da li sigurno zelis da prekines igru i resetujes sve? Ovo brise sobu za sve igrace.');
  if (!ok) return;
  state.busy = true;
  clearInterval(state.pollTimer);
  const code = state.room.code;
  state.dismissedQuadAnnouncements.clear();
  saveDismissedQuadAnnouncements();
  localStorage.removeItem('my-remi-session');
  state.session = { playerId: null, name: null, roomCode: null };
  state.room = null;
  history.replaceState(null, '', location.pathname);
  state.busy = false;
  render();
  await deleteRoom(code);
}

// ===== Turn helpers =====
export function myIndex() { return state.room.players.findIndex(p => p.id === state.session.playerId); }
export function isMyTurn() { return state.room.phase === 'playing' && state.room.currentPlayerIndex === myIndex(); }
export function myHand() { return state.room.hands[state.session.playerId] || []; }

export function advanceTurn(r) {
  const n = r.players.length;
  r.currentPlayerIndex = (r.currentPlayerIndex + 1) % n;
  r.turnPhase = 'draw';
  r.discardDrawCardId = null;
  r.bottomDrawCardId = null;
  // The blue "just drawn" highlight only makes sense for the rest of the
  // drawing player's own turn - clear it once that turn ends (on discard)
  // so it doesn't linger on a still-in-hand card until their next draw.
  // The leftmost pin (r.pinnedCardIds, see orderHand in js/cards.js) is
  // intentionally NOT cleared here - it should stay put across turns until
  // the player drags the card themselves (which gives it a manual position
  // and makes orderHand stop pinning it).
  r.lastDrawnPlayerId = null;
  r.lastDrawnCardId = null;
  r.turnMeldIds = [];
}

export async function endRoundWithWinner(r, winnerId, handType) {
  const deltas = scoreRound(r, winnerId, handType);
  r.players.forEach(p => { r.scores[p.id] = (r.scores[p.id] || 0) + deltas[p.id]; });
  if (!r.scoreHistory) r.scoreHistory = [];
  r.scoreHistory.push({ round: r.round, totals: { ...r.scores } });
  r.roundWinner = winnerId;
  r.roundWinType = handType;
  // Snapshot before anything resets it - lets the round-end screen highlight
  // only the meld(s) touched on the winning turn, not the winner's whole
  // table history.
  r.roundWinMeldIds = (r.turnMeldIds || []).slice();
  r.lastDeltas = deltas;
  r.phase = 'round_end';
  const label = handType === 'mali' ? 'malim handom' : handType === 'veliki' ? 'velikim handom' : 'regularno';
  r.log.push(`${r.players.find(p => p.id === winnerId).name} je zavrsio rundu (${label})!`);
}

function pushMeld(r, group) {
  const meld = { id: 'm_' + Math.random().toString(36).slice(2), ownerId: state.session.playerId, cards: group };
  r.melds.push(meld);
  if (!r.turnMeldIds) r.turnMeldIds = [];
  r.turnMeldIds.push(meld.id);
  return meld;
}

function markMeldTouched(r, meld) {
  if (!r.turnMeldIds) r.turnMeldIds = [];
  if (!r.turnMeldIds.includes(meld.id)) r.turnMeldIds.push(meld.id);
}

// Pulls `cards` out of `hand` in place, by id (the card objects handed around
// by getSelectedCards are the same objects, but a re-render/poll can replace
// the hand array under them, so match on id rather than identity).
function removeCardsFromHand(hand, cards) {
  cards.forEach(c => {
    const idx = hand.findIndex(h => h.id === c.id);
    if (idx !== -1) hand.splice(idx, 1);
  });
}

// The two obligations a lay/add can discharge, checked the same way wherever
// cards leave the hand for the table:
// - a joker freed by actionReplaceJoker has now been placed. Jokers are
//   fungible, so laying down ANY joker satisfies it, not just that exact id.
// - the card pulled off the otpad this turn no longer owes a lay once it's
//   gone from the hand.
function clearSatisfiedObligations(r, laidCards, hand) {
  if (r.pendingJokerToPlace && r.pendingJokerToPlace.playerId === state.session.playerId
      && laidCards.some(c => c.joker)) {
    r.pendingJokerToPlace = null;
  }
  if (r.discardDrawCardId && !hand.some(c => c.id === r.discardDrawCardId)) {
    r.discardDrawCardId = null;
  }
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
  const me = state.session.playerId;
  if (!state.room.hands[me]) state.room.hands[me] = [];
  if (!state.room.handOrders) state.room.handOrders = {};
  if (!state.room.pinnedCardIds) state.room.pinnedCardIds = {};
  // Freeze where the cards sit RIGHT NOW before the new one arrives. The
  // previously drawn card is held leftmost only by the pin, and the pin is
  // about to move to this card - without this it would lose its position
  // entirely and get re-appended at the far right, flying across the whole
  // hand just because a new card was drawn.
  state.room.handOrders[me] = orderHand(state.room.hands[me], state.room.handOrders[me], state.room.pinnedCardIds[me])
    .map(c => c.id);
  state.room.hands[me].push(card);
  state.room.lastDrawnPlayerId = me;
  state.room.lastDrawnCardId = card.id;
  state.room.pinnedCardIds[me] = card.id;
}

export async function actionDrawDiscard() {
  if (!isMyTurn() || state.room.turnPhase !== 'draw' || state.busy) return;
  if (state.room.discard.length === 0) { showToast('Otpad je prazan.'); return; }
  if (myHand().length === 1) { showToast('Sa jednom kartom u ruci ne mozes vuci sa otpada - vuci sa talona.'); return; }
  state.busy = true;
  const card = state.room.discard.pop();
  myHandPush(card);
  state.room.turnPhase = 'meld';
  state.room.discardDrawCardId = card.id;
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
  if (state.room.discardDrawCardId && state.room.discardDrawCardId !== cardId) {
    showToast('⚠️ Kartu koju si uzeo sa otpada moras da izlozis/handiras ili je izaberi i klikni "Vrati kartu na otpad".');
    return;
  }
  // The card from under the talon may only be taken to make a hand - it can
  // never be thrown on the discard pile, neither itself nor in place of some
  // other card. The only way out of the turn (short of declaring the hand) is
  // putting it back where it came from.
  if (state.room.bottomDrawCardId) {
    if (state.room.bottomDrawCardId !== cardId) {
      showToast('⚠️ Sa kartom ispod talona moras da napravis hand ili je izaberi i klikni "Vrati kartu ispod talona".');
      return;
    }
    await returnBottomCard(cardId);
    return;
  }
  const isReturningDiscardDraw = state.room.discardDrawCardId === cardId;
  state.busy = true;
  const hand = state.room.hands[state.session.playerId];
  const idx = hand.findIndex(c => c.id === cardId);
  if (idx === -1) { state.busy = false; return; }
  if (hand[idx].joker && hand.length > 1 && !isReturningDiscardDraw) {
    showToast('Dzokera mozes baciti samo ako ti je to jedina karta u ruci.');
    state.busy = false;
    return;
  }
  const [card] = hand.splice(idx, 1);
  state.room.discard.push(card);
  state.selectedIds.clear();
  if (isReturningDiscardDraw) {
    // Not a real discard - just undoing the discard-pull. The turn rewinds to
    // its draw phase with every option open again, including pulling the very
    // same card back off the otpad.
    state.room.discardDrawCardId = null;
    state.room.turnPhase = 'draw';
  } else if (hand.length === 0) {
    await endRoundWithWinner(state.room, state.session.playerId, null);
  } else {
    advanceTurn(state.room);
  }
  await saveRoom(state.room);
  state.busy = false;
  render();
}

// Undo of actionTryBottomCard: slide the card back under the talon and rewind
// the turn to its draw phase, as if it had never been taken.
async function returnBottomCard(cardId) {
  state.busy = true;
  const hand = state.room.hands[state.session.playerId];
  const idx = hand.findIndex(c => c.id === cardId);
  if (idx === -1) { state.busy = false; return; }
  hand.splice(idx, 1);
  state.room.specialBottomCard.taken = false;
  state.room.bottomDrawCardId = null;
  state.room.turnPhase = 'draw';
  state.selectedIds.clear();
  if (state.room.lastDrawnCardId === cardId) {
    state.room.lastDrawnCardId = null;
    state.room.lastDrawnPlayerId = null;
  }
  if (state.room.pinnedCardIds && state.room.pinnedCardIds[state.session.playerId] === cardId) {
    state.room.pinnedCardIds[state.session.playerId] = null;
  }
  await saveRoom(state.room);
  state.busy = false;
  render();
}

// ===== "Handiraj" - going out in a single move =====
// A player who has never opened can win the round outright by keeping 14
// cards that either all meld (veliki hand) or sum under 51 (mali hand) and
// throwing the odd 15th card on the discard pile. This works out WHICH 14
// (i.e. which card gets discarded), so the action bar can offer it directly
// instead of making the player select the right cards by hand.
// Returns { type, keepIds, discardCard } or null. Result is memoised per
// exact hand, since the veliki search is expensive and render() runs often.
let handOptionCache = { key: null, value: null };

export function findHandOption(hand) {
  if (!state.room || hand.length !== 15) return null;
  if (state.room.openedPlayers.includes(state.session.playerId)) return null;
  const key = state.session.playerId + '|' + hand.map(c => c.id).join(',') + '|' + (state.room.bottomDrawCardId || '');
  if (handOptionCache.key === key) return handOptionCache.value;
  const result = computeHandOption(hand);
  handOptionCache = { key, value: result };
  return result;
}

function computeHandOption(hand) {
  // The card from under the talon can never end up on the otpad, so it can't
  // be the one discarded to close the hand out (see actionTryBottomCard).
  return findHandOptionAmong(hand, hand.filter(c => c.id !== state.room.bottomDrawCardId));
}

// The going-out search itself: which of `candidates` can be thrown away so the
// remaining 14 either all meld (veliki) or sum under 51 (mali). Split out so
// actionTryBottomCard can ask the same question about a hypothetical hand,
// with its own idea of which cards are discardable.
function findHandOptionAmong(hand, candidates) {
  for (const disc of candidates) {
    const rest = hand.filter(c => c.id !== disc.id);
    if (findPartition(rest)) return { type: 'veliki', keepIds: rest.map(c => c.id), discardCard: disc };
  }
  // For mali, throwing away the most expensive card gives the lowest sum -
  // if that one doesn't get under 51, nothing else will either.
  const byValueDesc = candidates.slice().sort((a, b) => cardValueMaliHand(b) - cardValueMaliHand(a));
  for (const disc of byValueDesc) {
    const rest = hand.filter(c => c.id !== disc.id);
    if (maliHandValue(rest) < 51) return { type: 'mali', keepIds: rest.map(c => c.id), discardCard: disc };
  }
  return null;
}

// Selects the 14 hand cards and hands off to the normal lay path, which
// already knows how to close out a going-out attempt (lay the melds, discard
// the leftover card, end the round) - including asking about ambiguous joker
// placement first when the melds can be arranged more than one way.
export async function actionDeclareHand() {
  if (!isMyTurn() || state.room.turnPhase !== 'meld' || state.busy) return;
  const option = findHandOption(myHand());
  if (!option) { showToast('Sa ovim kartama ne mozes da handiras.'); return; }
  state.selectedIds.clear();
  option.keepIds.forEach(id => state.selectedIds.add(id));
  await actionLayMultipleSelected();
}

// A single card left in hand after laying down (izlaganje) or adding to a
// meld (krpljenje) has exactly one legal move: it goes on the otpad and the
// round is over. Throw it for the player rather than making them click
// "Baci" on a foregone conclusion. Skipped when that last card isn't free to
// be discarded - a card pulled off the otpad this turn still owes a lay, a
// card from under the talon can never reach the otpad at all, and a freed
// joker must be placed first (all three would just rewind or block the turn,
// not win it).
async function autoDiscardLastCard() {
  const hand = state.room.hands[state.session.playerId] || [];
  if (hand.length !== 1) return false;
  if (state.room.discardDrawCardId || state.room.bottomDrawCardId) return false;
  if (state.room.pendingJokerToPlace && state.room.pendingJokerToPlace.playerId === state.session.playerId) return false;
  const [card] = hand.splice(0, 1);
  state.room.discard.push(card);
  state.selectedIds.clear();
  await endRoundWithWinner(state.room, state.session.playerId, null);
  return true;
}

export async function actionLayMultipleSelected() {
  // Lay out ALL currently selected cards at once, auto-partitioned into melds.
  // Used for the opening play when it takes multiple melds to reach 51 points.
  if (!isMyTurn() || state.room.turnPhase !== 'meld' || state.busy) return;
  const cards = getSelectedCards();
  if (cards.length < 3) { showToast('Izaberi karte za izlaganje.'); return; }
  const hand = state.room.hands[state.session.playerId];
  if (cards.length === hand.length) {
    showToast('⚠️ Moras zadrzati bar jednu kartu da je bacis na otpad - ne mozes spustiti/dodati sve karte odjednom.');
    return;
  }
  const opened = state.room.openedPlayers.includes(state.session.playerId);
  // Selecting everything but one card (never having opened before) is a
  // going-out attempt: try Veliki Hand (whole selection melds validly) then
  // Mali Hand (whole selection sums under 51) before falling back to a
  // regular partial opening lay.
  const goingOutAttempt = !opened && cards.length === hand.length - 1;
  const leftoverCard = goingOutAttempt ? hand.find(c => !state.selectedIds.has(c.id)) : null;

  // With the card from under the talon in hand, the only legal lay is the
  // hand itself - anything less would strand that card on the table with no
  // way to return it (and no way to end the turn, since it can't be discarded).
  if (state.room.bottomDrawCardId && !goingOutAttempt) {
    showToast('⚠️ Karta ispod talona sluzi samo za hand - ili izlozi ceo hand, ili je vrati ispod talona.');
    return;
  }
  // ...and it can't be the card thrown on the otpad to close out the hand
  // either - if it isn't part of the hand, it belongs back under the talon.
  if (state.room.bottomDrawCardId && leftoverCard && leftoverCard.id === state.room.bottomDrawCardId) {
    showToast('⚠️ Kartu ispod talona ne mozes baciti na otpad - ako ti ne treba, vrati je ispod talona.');
    return;
  }

  const partitions = findAllPartitions(cards);
  // findAllPartitions bails out after a capped number of attempts, while the
  // single-answer search is exhaustive - on a going-out attempt fall back to
  // it rather than wrongly telling the player their hand can't be laid down.
  if (partitions.length === 0 && goingOutAttempt) {
    const single = findPartition(cards);
    if (single) partitions.push(single);
  }
  if (partitions.length === 0) {
    if (goingOutAttempt && maliHandValue(cards) < 51) {
      state.busy = true;
      hand.splice(hand.findIndex(c => c.id === leftoverCard.id), 1);
      state.room.discard.push(leftoverCard);
      state.selectedIds.clear();
      await endRoundWithWinner(state.room, state.session.playerId, 'mali');
      await saveRoom(state.room);
      state.busy = false;
      render();
      return;
    }
    showToast('Izabrane karte se ne mogu podeliti u validne kombinacije.');
    return;
  }
  // Every fully-resolved way to lay these cards down - both which cards group
  // together AND, for any group whose joker could still go more than one
  // place (e.g. Mirjana's K-Dz-Dz + J-J-J bug: she wanted K-Dz(Q)-J + J-J-Dz
  // instead), which specific spot it takes. Showing partition choice and
  // window choice as two separate modals in sequence was confusing - the
  // player had no idea a second question was coming - so every combination
  // is flattened into one option up front instead.
  const resolvedOptions = expandPartitionOptions(partitions);
  // ...except on a going-out attempt, where the question is moot: every card
  // goes down and the round ends right there, so the arrangement is purely
  // cosmetic and asking just puts a modal between the player and their win.
  if (resolvedOptions.length > 1 && !goingOutAttempt) {
    showChoiceModal('Kako da izložiš izabrane karte?', resolvedOptions.map(o => ({
      label: buildPartitionPreviewEl(resolvedOptionDisplayGroups(o)),
      opt: o,
    })), (picked) => {
      applyResolvedOption(picked.opt, cards, opened, goingOutAttempt, leftoverCard);
    });
    return;
  }
  await applyResolvedOption(resolvedOptions[0], cards, opened, goingOutAttempt, leftoverCard);
}

async function applyResolvedOption(option, cards, opened, goingOutAttempt, leftoverCard) {
  applyResolvedOptionLocks(option);
  const partition = option.partition;
  const hand = state.room.hands[state.session.playerId];

  if (goingOutAttempt) {
    state.busy = true;
    removeCardsFromHand(hand, cards);
    partition.forEach(group => pushMeld(state.room, group));
    hand.splice(hand.findIndex(c => c.id === leftoverCard.id), 1);
    state.room.discard.push(leftoverCard);
    state.room.openedPlayers.push(state.session.playerId);
    state.selectedIds.clear();
    // No quad sweep here: the round ends on this very move, so there's no
    // later turn that could reuse those cards - sweeping would only pop a
    // pointless "4 cards removed" dialog and hide part of the winning hand
    // from the round-end reveal.
    await endRoundWithWinner(state.room, state.session.playerId, 'veliki');
    await saveRoom(state.room);
    state.busy = false;
    render();
    return;
  }

  if (!opened) {
    const val = sumOpeningValue(partition);
    if (val < 51) { showToast(`Ukupno ${val} poena - treba bar 51 za prvo izlaganje.`); return; }
  }
  state.busy = true;
  removeCardsFromHand(hand, cards);
  partition.forEach(group => pushMeld(state.room, group));
  if (!opened) state.room.openedPlayers.push(state.session.playerId);
  state.selectedIds.clear();
  clearSatisfiedObligations(state.room, cards, hand);
  sweepCompletedQuads(state.room);
  await autoDiscardLastCard();
  await saveRoom(state.room);
  state.busy = false;
  render();
}

export async function actionAddToMeld(ownerIdOfMeld, meldIdx) {
  if (!isMyTurn() || state.room.turnPhase !== 'meld' || state.busy) return;
  if (!state.room.openedPlayers.includes(state.session.playerId)) { showToast('Prvo se moras izloziti da bi dodavao karte.'); return; }
  if (state.room.bottomDrawCardId) {
    showToast('⚠️ Karta ispod talona sluzi samo za hand - ili izlozi ceo hand, ili je vrati ispod talona.');
    return;
  }
  const cards = getSelectedCards();
  if (cards.length === 0) { showToast('Izaberi karte iz ruke koje zelis da dodas.'); return; }
  if (cards.length === state.room.hands[state.session.playerId].length) {
    showToast('Moras zadrzati bar jednu kartu za bacanje - ne mozes dodati sve karte odjednom.');
    return;
  }
  const meld = state.room.melds[meldIdx];
  if (!meld) return;
  const combined = meld.cards.concat(cards);
  if (!isValidMeld(combined)) {
    // Dropping card(s) that leave the meld's joker with nothing left to stand
    // for reads as "swap them in and take the joker", not "extend the meld" -
    // the latter can't work anyway (a set never holds 5 cards). Clicking the
    // joker itself still works; this just makes the whole group a drop target.
    const jokerCardId = planJokerSwapAdd(meld, cards);
    if (jokerCardId) {
      if (state.room.pendingJokerToPlace && state.room.pendingJokerToPlace.playerId === state.session.playerId) {
        showToast('Prvo moras da spustis prethodnog dzokera koga si zamenio.');
        return;
      }
      await applyJokerSwapAdd(meld, cards, jokerCardId);
      return;
    }
    showToast('Te karte ne mogu da se dodaju na tu kombinaciju.');
    return;
  }
  const opts = enumerateSingleJokerRunWindows(combined);
  if (opts) {
    const jokerCard = combined.find(c => c.joker && c._lockedRank === undefined);
    showChoiceModal('Gde treba dzoker da bude u nizu?', opts.map(o => ({
      label: buildMeldGroupEl(runWindowPreviewCards(combined, o)),
      opt: o,
    })), (picked) => {
      jokerCard._lockedRank = picked.opt.jokerRank;
      jokerCard._lockedAceHigh = picked.opt.jokerAceHigh;
      actionAddToMeld(ownerIdOfMeld, meldIdx);
    });
    return;
  }
  state.busy = true;
  const hand = state.room.hands[state.session.playerId];
  removeCardsFromHand(hand, cards);
  meld.cards = combined;
  markMeldTouched(state.room, meld);
  state.selectedIds.clear();
  clearSatisfiedObligations(state.room, cards, hand);
  sweepCompletedQuads(state.room);
  await autoDiscardLastCard();
  await saveRoom(state.room);
  state.busy = false;
  render();
}

// Id of the joker `cards` would displace if they were all added to `meld`, or
// null if this isn't a swap at all. The whole selection goes into the meld and
// the joker comes back out, so it only applies when the meld's single joker is
// left with no card to stand for.
//
// For a SET that means the selection has to cover EVERY suit the joker could
// have been (the same "no ambiguous joker" rule actionReplaceJoker enforces as
// "3 real cards down", just stated in terms of the end state): 2 real + joker
// releases the joker only if BOTH missing suits are dropped at once - with
// only one of them the joker might still have been the other suit, so that
// stays an ordinary add. For a RUN the joker's slot is a single known
// rank+suit, so one of the selected cards simply has to be that exact card.
function planJokerSwapAdd(meld, cards) {
  if (cards.length === 0 || cards.some(c => c.joker)) return null;
  const jokers = meld.cards.filter(c => c.joker);
  // Freeing two jokers at once has nowhere to go - pendingJokerToPlace tracks
  // a single one - so a multi-joker meld is left to the normal add path.
  if (jokers.length !== 1) return null;
  const resolved = resolveMeld(meld.cards);
  if (!resolved) return null;
  const item = resolved.cards.find(it => it.isJoker);
  if (!item) return null;
  const real = meld.cards.filter(c => !c.joker);
  if (resolved.type === 'set') {
    const suitsInMeld = real.map(c => c.suit);
    const missing = ['S', 'H', 'D', 'C'].filter(s => !suitsInMeld.includes(s));
    const picked = cards.map(c => c.suit);
    if (cards.length !== missing.length) return null;
    if (!cards.every(c => c.rank === item.substitutes.rank)) return null;
    if (!missing.every(s => picked.includes(s))) return null;
  } else if (!cards.some(c => c.rank === item.substitutes.rank && c.suit === item.substitutes.suit)) {
    return null;
  }
  if (!isValidMeld(real.concat(cards))) return null;
  return jokers[0].id;
}

async function applyJokerSwapAdd(meld, cards, jokerCardId) {
  state.busy = true;
  const hand = state.room.hands[state.session.playerId];
  removeCardsFromHand(hand, cards);
  const jokerObj = meld.cards.find(c => c.id === jokerCardId);
  delete jokerObj._lockedRank;
  delete jokerObj._lockedAceHigh;
  meld.cards = meld.cards.filter(c => c.id !== jokerCardId).concat(cards);
  markMeldTouched(state.room, meld);
  hand.push(jokerObj);
  state.room.pendingJokerToPlace = { playerId: state.session.playerId, jokerCardId: jokerObj.id };
  // Not clearSatisfiedObligations: this move CREATES the pending-joker
  // obligation it would discharge, so only the otpad half applies here.
  if (state.room.discardDrawCardId && !hand.some(c => c.id === state.room.discardDrawCardId)) {
    state.room.discardDrawCardId = null;
  }
  state.selectedIds.clear();
  sweepCompletedQuads(state.room);
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
  if (state.room.bottomDrawCardId) {
    showToast('⚠️ Karta ispod talona sluzi samo za hand - ili izlozi ceo hand, ili je vrati ispod talona.');
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
    // A set's joker only stands for a specific card once there's exactly one
    // missing suit left to fill - i.e. 3 real cards + this 1 joker. With only
    // 2 real cards (2 missing suits), the joker's identity is ambiguous
    // (it could represent either remaining suit), so it can't be exchanged yet.
    const realCount = meld.cards.filter(c => !c.joker).length;
    if (realCount < 3) {
      showToast('Dzoker jos nema jasno odredjenu boju - treba 3 prave karte tog ranga u grupi da bi se zamenio.');
      return;
    }
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
  markMeldTouched(state.room, meld);
  hand.push(jokerObj);
  state.room.pendingJokerToPlace = { playerId: state.session.playerId, jokerCardId: jokerObj.id };
  if (state.room.discardDrawCardId === candidate.id) {
    state.room.discardDrawCardId = null;
  }
  state.selectedIds.clear();
  sweepCompletedQuads(state.room);
  await saveRoom(state.room);
  state.busy = false;
  render();
}

export async function actionTryBottomCard() {
  if (!isMyTurn() || state.room.turnPhase !== 'draw' || state.busy) return;
  if (!state.room.specialBottomCard || state.room.specialBottomCard.taken) { showToast('Nema dostupne karte ispod talona.'); return; }
  const card = state.room.specialBottomCard.card;
  const hypothetical = myHand().concat([card]);
  // Check if drawing this card immediately enables ANY hand declaration. Every
  // card is a candidate discard here, including the bottom card itself - it
  // hasn't been taken yet, so this is only asking whether the draw is worth
  // offering at all.
  const handType = (findHandOptionAmong(hypothetical, hypothetical) || {}).type || null;
  if (!handType) { showToast('Sa tom kartom ne mozes odmah da napravis hand.'); return; }
  state.busy = true;
  state.room.specialBottomCard.taken = true;
  myHandPush(card);
  state.room.turnPhase = 'meld';
  state.room.bottomDrawCardId = card.id;
  await saveRoom(state.room);
  state.busy = false;
  showToast('Uzeo si otkrivenu kartu! Sad moras da proglasis hand ili da je vratis ispod talona.', 3400);
  render();
}
