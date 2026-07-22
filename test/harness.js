// Test-only harness: builds a fake room directly in memory (bypassing
// Firebase/lobby/dealing) so a specific mid-round scenario can be reached
// instantly. Not part of the shipped game - lives only under test/.
import { state } from '../js/state.js';
import { makeDeck, shuffle } from '../js/engine.js';
import { render } from '../js/render.js';

const FAKE_DB = 'local-test://harness';

// saveRoom() does a real fetch(`${dbUrl}/...`) - short-circuit any request
// to our fake dbUrl so nothing hits the network, while leaving real fetches
// (fonts, etc.) untouched.
const realFetch = window.fetch.bind(window);
window.fetch = (url, opts) => {
  if (typeof url === 'string' && url.startsWith(FAKE_DB)) {
    return Promise.resolve(new Response('{}', { status: 200 }));
  }
  return realFetch(url, opts);
};

function takeCard(pool, spec) {
  if (spec === 'joker') {
    const idx = pool.findIndex(c => c.joker);
    if (idx === -1) throw new Error('No joker left in pool');
    return pool.splice(idx, 1)[0];
  }
  const [suit, rank] = spec;
  const idx = pool.findIndex(c => !c.joker && c.suit === suit && c.rank === rank);
  if (idx === -1) throw new Error(`Card ${suit}${rank} not available (already used twice?)`);
  return pool.splice(idx, 1)[0];
}

// specs: array of [suit, rank] pairs (rank 1-13, suit 'S'|'H'|'D'|'C') or the
// string 'joker'. Cards come from a real 108-card 2-deck pool so duplicates
// (same suit+rank twice) are fine.
export function cardsFromSpecs(pool, specs) {
  return specs.map(spec => takeCard(pool, spec));
}

// Builds a 2-player room sitting mid-round, ready for the scenario's crafted
// hand. `myHand` and `opponentExtra` are card-spec arrays (see cardsFromSpecs);
// the rest of each hand/stock/discard is padded with random leftover cards.
export function buildTestRoom({
  myHandSpecs,
  openedPlayers = [],
  existingMelds = [], // [{ ownerId: 'me'|'opp', cardSpecs: [...] }]
  logExtra = [],
}) {
  const pool = shuffle(makeDeck());
  const myHand = cardsFromSpecs(pool, myHandSpecs);
  const meldCardGroups = existingMelds.map(m => ({
    ownerId: m.ownerId === 'me' ? 'me' : 'opp',
    cards: cardsFromSpecs(pool, m.cardSpecs),
  }));

  const opponentHand = pool.splice(0, 13);
  const discard = pool.splice(0, 1);
  const stock = pool.splice(0, Math.min(20, pool.length));

  const room = {
    code: 'TEST',
    phase: 'playing',
    players: [
      { id: 'me', name: 'Ti (test)' },
      { id: 'opp', name: 'Protivnik' },
    ],
    dealerIndex: 1,
    round: 1,
    scores: { me: 0, opp: 0 },
    scoreHistory: [],
    hands: { me: myHand, opp: opponentHand },
    stock,
    discard,
    melds: meldCardGroups,
    openedPlayers: openedPlayers.slice(),
    currentPlayerIndex: 0, // 'me' is always seat 0 here
    turnPhase: 'meld',
    roundWinner: null,
    roundWinType: null,
    pendingJokerToPlace: null,
    discardDrawCardId: null,
    mustDrawFromStock: false,
    quadAnnouncements: [],
    readyForNextRound: [],
    handOrders: {},
    log: ['[TEST HARNESS] Rucno sastavljena runda za testiranje.', ...logExtra],
  };
  return room;
}

export function mount(room) {
  state.dbUrl = FAKE_DB;
  state.session = { playerId: 'me', name: 'Ti (test)', roomCode: 'TEST' };
  state.room = room;
  state.selectedIds = new Set();
  render();
}
