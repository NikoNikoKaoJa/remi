import { rankLabel } from './cards.js';

// ===== Core Remi (Rummy) game logic =====
// Cards: {id, suit: 'S'|'H'|'D'|'C', rank: 1-13} or {id, joker:true}
// rank 1=As, 11=J, 12=Q, 13=K

const SUITS = ['S', 'H', 'D', 'C'];

export function makeDeck() {
  const cards = [];
  let idc = 0;
  for (let d = 0; d < 2; d++) {
    for (const suit of SUITS) {
      for (let rank = 1; rank <= 13; rank++) {
        cards.push({ id: 'c' + (idc++), suit, rank });
      }
    }
    // 2 jokers per physical deck => 4 total
    cards.push({ id: 'c' + (idc++), joker: true });
    cards.push({ id: 'c' + (idc++), joker: true });
  }
  return cards;
}

export function shuffle(deck, rng = Math.random) {
  const arr = deck.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Standard point value (used when a player is "izložen" but doesn't finish,
// and also as the base card value inside melds. As=10, Džoker=20)
export function cardValueStandard(card) {
  if (card.joker) return 20;
  if (card.rank === 1) return 10;
  if (card.rank >= 11) return 10;
  return card.rank;
}

// Value used for "mali hand" total-hand check: Džoker=0, As=1
export function cardValueMaliHand(card) {
  if (card.joker) return 0;
  if (card.rank === 1) return 1;
  if (card.rank >= 11) return 10;
  return card.rank;
}

// ---- Meld validation ----
// A meld is either:
//  RUN: 3+ cards, same suit, consecutive ranks (Ace low: A,2,3..  OR Ace high: ..Q,K,A). No wrap.
//  SET: 3-4 cards, same rank, distinct suits (jokers fill missing suits/ranks)
//
// Returns null if invalid, otherwise { type: 'run'|'set', cards: [...] }
// cards array items: { isJoker:false, card, contextRank, _aceHigh } or { isJoker:true, substitutes: {rank, suit, _aceHigh} }
export function resolveMeld(cardList) {
  if (cardList.length < 3) return null;
  const jokers = cardList.filter(c => c.joker);
  const normal = cardList.filter(c => !c.joker);
  if (normal.length === 0) return null; // can't be all jokers (no defined meld)

  const setResult = trySet(normal, jokers, cardList.length);
  if (setResult) return setResult;
  const runResult = tryRun(normal, jokers, cardList.length);
  if (runResult) return runResult;
  return null;
}

export function trySet(normal, jokers, totalLen) {
  if (totalLen > 4) return null;
  const rank = normal[0].rank;
  if (!normal.every(c => c.rank === rank)) return null;
  const suitsUsed = new Set();
  for (const c of normal) {
    if (suitsUsed.has(c.suit)) return null; // duplicate suit - not allowed in one set
    suitsUsed.add(c.suit);
  }
  if (suitsUsed.size + jokers.length !== totalLen) return null;
  if (totalLen < 3) return null;
  const availableSuits = SUITS.filter(s => !suitsUsed.has(s));
  const cards = normal.map(c => ({ isJoker: false, card: c, contextRank: rank }));
  jokers.forEach((j, idx) => {
    cards.push({ isJoker: true, substitutes: { rank, suit: availableSuits[idx] }, jokerCardId: j.id });
  });
  return { type: 'set', cards, rank };
}

export function tryRun(normal, jokers, totalLen) {
  const suit = normal[0].suit;
  if (!normal.every(c => c.suit === suit)) return null;
  const ranksSeen = new Set(normal.map(c => c.rank));
  if (ranksSeen.size !== normal.length) return null; // duplicate rank in same run - invalid

  const lockedJokers = jokers.filter(j => j._lockedRank !== undefined);
  const freeJokers = jokers.filter(j => j._lockedRank === undefined);

  // try both Ace-low and Ace-high interpretations, find a window of `totalLen`
  // consecutive numeric ranks (with Ace possibly = 1 or 14) that fits all normal
  // cards (and any previously-locked joker positions), filling remaining gaps
  // with the still-free jokers.
  for (const aceHigh of [false, true]) {
    const numeric = normal.map(c => ({ orig: c, n: c.rank === 1 ? (aceHigh ? 14 : 1) : c.rank }));
    const lockedNumeric = lockedJokers.map(lj => ({
      card: lj,
      n: lj._lockedRank === 1 ? (lj._lockedAceHigh ? 14 : 1) : lj._lockedRank,
    }));
    const nums = numeric.map(x => x.n).concat(lockedNumeric.map(x => x.n));
    if (nums.length === 0) continue;
    const minN = Math.min(...nums);
    const maxN = Math.max(...nums);
    if (maxN - minN + 1 > totalLen) continue; // spread too large even with jokers
    for (let start = Math.max(1, maxN - totalLen + 1); start <= minN; start++) {
      const end = start + totalLen - 1;
      if (end > 14) continue;
      if (start < 1) continue;
      const numToOrig = new Map(numeric.map(x => [x.n, x.orig]));
      const numToLocked = new Map(lockedNumeric.map(x => [x.n, x.card]));
      let ok = true;
      const filled = [];
      let freeIdx = 0;
      for (let n = start; n <= end; n++) {
        if (n === 0) { ok = false; break; }
        if ((n >= 2 && n <= 13) || (n === 1) || (n === 14)) {
          if (numToOrig.has(n)) {
            const origCard = numToOrig.get(n);
            filled.push({ isJoker: false, card: { ...origCard, _aceHigh: aceHigh }, contextRank: n === 14 ? 1 : n });
          } else if (numToLocked.has(n)) {
            const substRank = n === 14 ? 1 : n;
            filled.push({ isJoker: true, substitutes: { rank: substRank, suit, _aceHigh: n === 14 }, jokerCardId: numToLocked.get(n).id });
          } else {
            if (freeIdx >= freeJokers.length) { ok = false; break; }
            const substRank = n === 14 ? 1 : n;
            filled.push({ isJoker: true, substitutes: { rank: substRank, suit, _aceHigh: n === 14 }, jokerCardId: freeJokers[freeIdx].id });
            freeIdx++;
          }
        } else { ok = false; break; }
      }
      if (ok && freeIdx === freeJokers.length && filled.length === totalLen) {
        return { type: 'run', cards: filled, suit };
      }
    }
  }
  return null;
}

export function isValidMeld(cardList) {
  return resolveMeld(cardList) !== null;
}

// When a card group forms (or could form) a run containing exactly one
// not-yet-decided joker, there can be more than one valid rank the joker
// could represent (e.g. 9,10 + joker could be 8-9-10 or 9-10-J). This finds
// every valid option so the player can be asked to pick. Returns null when
// there's no ambiguity (0 or 1 options) or when it doesn't apply (sets,
// multiple undecided jokers, already-locked jokers present).
export function enumerateSingleJokerRunWindows(cards) {
  const jokers = cards.filter(c => c.joker);
  if (jokers.some(j => j._lockedRank !== undefined)) return null;
  if (jokers.length !== 1) return null;
  const normal = cards.filter(c => !c.joker);
  if (normal.length < 2) return null;
  const suit = normal[0].suit;
  if (!normal.every(c => c.suit === suit)) return null;
  const ranksSeen = new Set(normal.map(c => c.rank));
  if (ranksSeen.size !== normal.length) return null;
  const totalLen = cards.length;

  const results = [];
  for (const aceHigh of [false, true]) {
    const numeric = normal.map(c => (c.rank === 1 ? (aceHigh ? 14 : 1) : c.rank));
    const minN = Math.min(...numeric);
    const maxN = Math.max(...numeric);
    if (maxN - minN + 1 > totalLen) continue;
    for (let start = Math.max(1, maxN - totalLen + 1); start <= minN; start++) {
      const end = start + totalLen - 1;
      if (end > 14 || start < 1) continue;
      const covered = new Set(numeric);
      const missing = [];
      for (let n = start; n <= end; n++) if (!covered.has(n)) missing.push(n);
      if (missing.length !== 1) continue;
      const slotN = missing[0];
      results.push({ start, end, slotN, jokerRank: slotN === 14 ? 1 : slotN, jokerAceHigh: slotN === 14 });
    }
  }
  const seen = new Set();
  const unique = [];
  for (const r of results) {
    const key = r.start + ':' + r.end;
    if (!seen.has(key)) { seen.add(key); unique.push(r); }
  }
  return unique.length > 1 ? unique : null;
}

export function sequenceLabel(opt) {
  const parts = [];
  for (let n = opt.start; n <= opt.end; n++) {
    parts.push(n === opt.slotN ? 'DZ' : rankLabel(n === 14 ? 1 : n));
  }
  return parts.join(' - ');
}

// ---- 51-point opening check ----
// melds: array of card-arrays (each already validated as a meld)
export function sumOpeningValue(melds) {
  let total = 0;
  for (const m of melds) {
    const resolved = resolveMeld(m);
    if (!resolved) return -1; // invalid
    const isSet = resolved.type === 'set';
    for (const item of resolved.cards) {
      if (item.isJoker) {
        const r = item.substitutes.rank;
        if (r === 1) total += (isSet || item.substitutes._aceHigh) ? 10 : 1;
        else total += (r >= 11) ? 10 : r;
      } else {
        const r = item.contextRank;
        if (r === 1) total += (isSet || item.card._aceHigh) ? 10 : 1;
        else total += (r >= 11) ? 10 : r;
      }
    }
  }
  return total;
}

// ---- Mali hand check ----
export function maliHandValue(hand) {
  return hand.reduce((s, c) => s + cardValueMaliHand(c), 0);
}

// Like a full partition search but returns the actual groups (array of card-arrays) or null.
export function findPartition(cards, maxGroupSize = 8) {
  if (cards.length === 0) return [];
  if (cards.length < 3) return null;
  const first = cards[0];
  const rest = cards.slice(1);
  const maxLen = Math.min(maxGroupSize, cards.length);
  for (let len = 3; len <= maxLen; len++) {
    const combos = combinations(rest, len - 1);
    for (const combo of combos) {
      const group = [first, ...combo];
      if (isValidMeld(group)) {
        const remaining = rest.filter(c => !combo.includes(c));
        const sub = findPartition(remaining, maxGroupSize);
        if (sub !== null) return [group, ...sub];
      }
    }
  }
  return null;
}

export function combinations(arr, k) {
  const results = [];
  function helper(start, combo) {
    if (combo.length === k) { results.push(combo.slice()); return; }
    for (let i = start; i < arr.length; i++) {
      combo.push(arr[i]);
      helper(i + 1, combo);
      combo.pop();
    }
  }
  helper(0, []);
  return results;
}

// ---- 4-joker / 8-same-rank hand ----
export function findFourJokerOrEightSame(hand) {
  const jokers = hand.filter(c => c.joker);
  if (jokers.length >= 4) return jokers.slice(0, 4);
  const byRank = {};
  hand.filter(c => !c.joker).forEach(c => { (byRank[c.rank] = byRank[c.rank] || []).push(c); });
  let best = null;
  for (const rank in byRank) {
    const cards = byRank[rank];
    const need = 8 - cards.length;
    if (need >= 0 && need <= jokers.length && cards.length >= 1) {
      const candidate = cards.concat(jokers.slice(0, need));
      if (!best || candidate.length > best.length) best = candidate;
    }
  }
  return best;
}

// For the "selected cards" sum display: Ace always counts as 10, and a joker
// takes the value of whatever card it represents. If the selected cards form
// a resolvable meld (run/set), the joker's represented card is known exactly.
// Otherwise this makes its own best guess from context (matching ranks/suits
// among the other selected cards) rather than interrupting the player - the
// player is only ever actually asked at the moment they press "Izlozi se",
// via the run-position picker if real ambiguity remains at that point.
export function computeSelectedSum(selected) {
  const jokers = selected.filter(c => c.joker);
  const nonJokers = selected.filter(c => !c.joker);
  if (jokers.length === 0) {
    return nonJokers.reduce((s, c) => s + cardValueStandard(c), 0);
  }
  if (selected.length >= 3) {
    const resolved = resolveMeld(selected);
    if (resolved) {
      let sum = 0;
      for (const item of resolved.cards) {
        sum += item.isJoker ? cardValueStandard({ rank: item.substitutes.rank }) : cardValueStandard(item.card);
      }
      return sum;
    }
  }
  let sum = nonJokers.reduce((s, c) => s + cardValueStandard(c), 0);
  jokers.forEach(() => { sum += guessJokerRankValue(nonJokers); });
  return sum;
}

// Best-effort guess (no prompting) for what a joker likely represents, based
// on the other currently-selected cards: matching ranks suggest a set (guess
// that rank); matching suits suggest a run-in-progress (guess the gap, or the
// next card before/after). Falls back to the flat wildcard value (20) when
// there's genuinely no context to go on.
export function guessJokerRankValue(nonJokers) {
  const rankCounts = {};
  nonJokers.forEach(c => { rankCounts[c.rank] = (rankCounts[c.rank] || 0) + 1; });
  const setCandidate = Object.keys(rankCounts).find(r => rankCounts[r] >= 2);
  if (setCandidate) return cardValueStandard({ rank: Number(setCandidate) });

  const bySuit = {};
  nonJokers.forEach(c => { (bySuit[c.suit] = bySuit[c.suit] || []).push(c.rank); });
  const suitKey = Object.keys(bySuit).find(s => bySuit[s].length >= 1);
  if (suitKey) {
    const ranks = bySuit[suitKey].slice().sort((a, b) => a - b);
    let guess = null;
    if (ranks.length >= 2) {
      for (let i = 0; i < ranks.length - 1; i++) {
        if (ranks[i + 1] - ranks[i] === 2) { guess = ranks[i] + 1; break; }
      }
      if (guess === null) guess = ranks[0] > 1 ? ranks[0] - 1 : ranks[ranks.length - 1] + 1;
    } else {
      guess = ranks[0] > 1 ? ranks[0] - 1 : ranks[0] + 1;
    }
    if (guess >= 1 && guess <= 13) return cardValueStandard({ rank: guess });
  }
  return 20; // no context at all - fall back to the flat wildcard value
}

// ===== Round engine =====

export function setupRound(players, dealerIndex) {
  const n = players.length;
  let deck = shuffle(makeDeck());
  const cutPoint = 1 + Math.floor(Math.random() * (deck.length - 2));
  const topPortion = deck.slice(0, cutPoint);
  const bottomPortion = deck.slice(cutPoint);
  const revealed = topPortion[topPortion.length - 1];
  const secondFromBottom = topPortion.length >= 2 ? topPortion[topPortion.length - 2] : null;

  const cutterIdx = (dealerIndex - 1 + n) % n;
  const firstPlayerIdx = (dealerIndex + 1) % n;

  let bonusRecipientIdx = null, bonusCard = null, specialBottomCard = null;
  let stockPool = bottomPortion.concat(topPortion.slice(0, topPortion.length - 1));

  if (revealed.joker) {
    // the revealed card itself is claimed as a bonus joker by the cutter -
    // reveal the next card from the pool instead so there's always a visible card.
    bonusRecipientIdx = cutterIdx; bonusCard = revealed;
    stockPool = shuffle(stockPool);
    specialBottomCard = stockPool.shift();
  } else if (secondFromBottom && secondFromBottom.joker) {
    bonusRecipientIdx = dealerIndex; bonusCard = secondFromBottom;
    stockPool = stockPool.filter(c => c.id !== secondFromBottom.id);
    stockPool = shuffle(stockPool);
    specialBottomCard = revealed;
  } else {
    specialBottomCard = revealed;
  }

  const hands = {};
  players.forEach(p => hands[p.id] = []);
  let pool = stockPool.slice();
  for (let round = 0; round < 14; round++) {
    for (let k = 0; k < n; k++) {
      const pIdx = (firstPlayerIdx + k) % n;
      hands[players[pIdx].id].push(pool.shift());
    }
  }
  hands[players[firstPlayerIdx].id].push(pool.shift()); // extra 15th card

  if (bonusRecipientIdx !== null) {
    const recipientId = players[bonusRecipientIdx].id;
    const displaced = hands[recipientId].pop();
    hands[recipientId].push(bonusCard);
    pool.push(displaced); // displaced card returns to the stock
  }

  const log = [`Deli: ${players[dealerIndex].name} | Sece: ${players[cutterIdx].name} | Prvi na potezu: ${players[firstPlayerIdx].name}`];
  if (bonusRecipientIdx !== null) log.push(`${players[bonusRecipientIdx].name} dobija bonus dzoker pri secenju!`);

  return {
    phase: 'playing',
    players,
    dealerIndex,
    cutterIdx,
    firstPlayerIdx,
    hands,
    stock: pool,
    discard: [],
    revealedCard: revealed, // the raw cut card, before any bonus-joker swap - for the cut-reveal screen
    specialBottomCard: specialBottomCard ? { card: specialBottomCard, taken: false } : null,
    melds: [], // {ownerId, cards}
    openedPlayers: [],
    currentPlayerIndex: firstPlayerIdx,
    turnPhase: 'meld', // first player already has 15 cards, skips draw
    roundWinner: null,
    roundWinType: null, // null|'mali'|'veliki'|'fourJoker'
    pendingJokerToPlace: null,
    discardDrawCardId: null,
    mustDrawFromStock: false,
    log,
  };
}

export function scoreRound(r, winnerId, handType) {
  const mult = handType === 'fourJoker' ? 3 : (handType ? 2 : 1);
  const deltas = {};
  r.players.forEach(p => {
    if (p.id === winnerId) {
      deltas[p.id] = -10 * mult;
    } else if (r.openedPlayers.includes(p.id)) {
      const sum = (r.hands[p.id] || []).reduce((s, c) => s + cardValueStandard(c), 0);
      deltas[p.id] = sum * mult;
    } else {
      deltas[p.id] = 100 * mult;
    }
  });
  return deltas;
}

// A completed set of 4 identical real cards (no jokers involved) is removed
// from the table and buried at the bottom of the discard pile, out of sight.
// Sets that still include a joker are left alone (they aren't "4 iste karte").
export function sweepCompletedQuads(r) {
  const remaining = [];
  const swept = [];
  for (const meld of r.melds) {
    const resolved = resolveMeld(meld.cards);
    if (resolved && resolved.type === 'set' && meld.cards.length === 4 && meld.cards.every(c => !c.joker)) {
      swept.push(meld);
    } else {
      remaining.push(meld);
    }
  }
  if (swept.length > 0) {
    r.melds = remaining;
    if (!r.quadAnnouncements) r.quadAnnouncements = [];
    swept.forEach(meld => {
      const label = rankLabel(meld.cards[0].rank);
      r.log.push(`Cetiri karte (${label}) uklonjene sa stola i sklonjene na dno otpada.`);
      r.discard = meld.cards.concat(r.discard);
      r.quadAnnouncements.push({ id: 'qa_' + Math.random().toString(36).slice(2), cards: meld.cards, rank: meld.cards[0].rank });
    });
    r.quadAnnouncements = r.quadAnnouncements.slice(-5);
  }
  return swept.length > 0;
}
