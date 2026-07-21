// ===== Card display primitives =====
export const SUIT_SYM = { S: '♠', H: '♥', D: '♦', C: '♣' };
export const RANK_SYM = { 1: 'A', 11: 'J', 12: 'Q', 13: 'K' };
export function rankLabel(r) { return RANK_SYM[r] || String(r); }
export function isRedSuit(s) { return s === 'H' || s === 'D'; }

export function cardEl(card, opts) {
  opts = opts || {};
  const div = document.createElement('div');
  div.className = 'card' + (card.joker ? ' joker' : (isRedSuit(card.suit) ? ' red' : '')) + (opts.mini ? ' mini' : '') + (opts.clickable ? ' clickable' : '') + (opts.selected ? ' selected' : '');
  if (card.joker) {
    div.innerHTML = '<div class="rank">DZOKER</div><div class="suit-sym">★</div>';
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

export function cardBackEl(mini) {
  const div = document.createElement('div');
  div.className = 'card back' + (mini ? ' mini' : '');
  return div;
}
export function sortHand(hand) {
  return hand.slice().sort((a, b) => {
    if (a.joker && b.joker) return 0;
    if (a.joker) return 1;
    if (b.joker) return -1;
    if (a.suit !== b.suit) return a.suit.localeCompare(b.suit);
    const ra = a.rank === 1 ? 14 : a.rank;
    const rb = b.rank === 1 ? 14 : b.rank;
    return ra - rb;
  });
}
