// ===== Card display primitives =====
export const SUIT_SYM = { S: '♠', H: '♥', D: '♦', C: '♣' };
export const RANK_SYM = { 1: 'A', 11: 'J', 12: 'Q', 13: 'K' };
export function rankLabel(r) { return RANK_SYM[r] || String(r); }
export function isRedSuit(s) { return s === 'H' || s === 'D'; }

// Cap-and-bells jester icon standing in for the joker's suit symbol - three
// curled points of the hat each tipped with a bell, above a smiling face.
const JOKER_ICON_SVG = `<svg class="joker-icon" viewBox="0 0 64 64" aria-hidden="true">
  <path d="M20 26 C10 22 6 10 12 3 C17 11 22 19 27 25 Z" fill="var(--red)"/>
  <path d="M28 21 C26 10 30 1 36 1 C36 11 33 19 30 24 Z" fill="var(--red)"/>
  <path d="M44 26 C54 22 58 10 52 3 C47 11 42 19 37 25 Z" fill="var(--red)"/>
  <circle cx="12" cy="4" r="3.4" fill="var(--gold-bright)"/>
  <circle cx="36" cy="2" r="3.4" fill="var(--gold-bright)"/>
  <circle cx="52" cy="4" r="3.4" fill="var(--gold-bright)"/>
  <path d="M17 26 Q32 34 47 26 L47 30 Q32 39 17 30 Z" fill="var(--red)"/>
  <circle cx="32" cy="40" r="13" fill="var(--cream)" stroke="var(--ink)" stroke-width="1.5"/>
  <circle cx="27" cy="39" r="1.8" fill="var(--ink)"/>
  <circle cx="37" cy="39" r="1.8" fill="var(--ink)"/>
  <path d="M25 44 Q32 50 39 44" stroke="var(--ink)" stroke-width="2" fill="none" stroke-linecap="round"/>
</svg>`;

export function cardEl(card, opts) {
  opts = opts || {};
  const div = document.createElement('div');
  div.className = 'card' + (card.joker ? ' joker' : (isRedSuit(card.suit) ? ' red' : '')) + (opts.mini ? ' mini' : '') + (opts.clickable ? ' clickable' : '') + (opts.selected ? ' selected' : '');
  if (card.joker) {
    div.innerHTML = `<div class="rank">Joker</div>${JOKER_ICON_SVG}`;
  } else {
    div.innerHTML = `<div class="rank">${rankLabel(card.rank)}</div><div class="suit-sym">${SUIT_SYM[card.suit]}</div>`;
  }
  if (opts.onClick) div.addEventListener('click', opts.onClick);
  return div;
}
// Wraps a clickable card in a non-transformed "slot" div so :hover is
// evaluated against a box that never moves. Without this, hovering the card
// itself and lifting it via CSS transform can shift its bottom edge above a
// stationary cursor, causing mouseleave -> drop -> mouseenter -> lift to
// oscillate every frame (visible as flicker).
export function wrapHoverSlot(cardNode) {
  const slot = document.createElement('div');
  slot.className = 'card-slot';
  slot.appendChild(cardNode);
  return slot;
}

export function cardBackEl(mini, card) {
  const div = document.createElement('div');
  const deckCls = card && card.deck === 1 ? ' deck-1' : ' deck-0';
  div.className = 'card back' + deckCls + (mini ? ' mini' : '');
  return div;
}
// Suit tie-break order when two cards share a rank - matches SUIT_SYM's
// declaration order (S, H, D, C).
const SUIT_ORDER = { S: 0, H: 1, D: 2, C: 3 };
export function sortHand(hand) {
  return hand.slice().sort((a, b) => {
    if (a.joker && b.joker) return 0;
    if (a.joker) return 1;
    if (b.joker) return -1;
    const ra = a.rank === 1 ? 14 : a.rank;
    const rb = b.rank === 1 ? 14 : b.rank;
    if (ra !== rb) return rb - ra; // value descending: A, K, Q, J, 10 ... 2 (left to right)
    return SUIT_ORDER[a.suit] - SUIT_ORDER[b.suit];
  });
}
// Applies a player's manually-dragged card order (an array of card ids) if
// one exists; cards not present in it (e.g. a card just drawn this turn)
// keep the hand's natural (deal/draw) order instead of being auto-sorted -
// players found an automatic re-sort disorienting since it shifts other
// cards' positions every time the hand changes. If pinFirstId is given
// (the last-drawn card's id) and it has no manual position yet, it's moved
// to the front - this is the single place that rule lives, so a freshly
// drawn card lands leftmost on arrival. Once the player drags it themselves
// (which records it in `order`), that manual placement is respected instead
// of snapping it back - dragging it away is how the player un-pins it.
export function orderHand(hand, order, pinFirstId) {
  const ord = order || [];
  const byId = new Map(hand.map(c => [c.id, c]));
  const known = ord.map(id => byId.get(id)).filter(Boolean);
  const orderedIds = new Set(ord);
  const fresh = hand.filter(c => !orderedIds.has(c.id));
  const result = known.concat(fresh);
  if (pinFirstId && !orderedIds.has(pinFirstId)) {
    const idx = result.findIndex(c => c.id === pinFirstId);
    if (idx > 0) result.unshift(result.splice(idx, 1)[0]);
  }
  return result;
}
