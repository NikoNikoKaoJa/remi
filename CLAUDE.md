# Remi — Serbian Rummy (multiplayer web game)

Context for Claude Code. This project is a browser-based multiplayer card game
implementing a specific Serbian variant of Rummy ("Remi"). Written by/for Niko,
a Serbian speaker. **Communicate with the user in Serbian.**

## What this is

A single-page card game, no build step, served as static files from GitHub Pages.
Multiple players join from their own devices via a shared link and play in real
time (turn-based, synced through a free Firebase Realtime Database).

There are two builds of the same game:
- **`index.html`** — the hosted build. Uses Firebase Realtime Database (via REST)
  for cross-device multiplayer. This is what players actually use. No Claude
  account required for players.
- **`Remi_Igra.html`** (a.k.a. the "artifact" build) — an alternate build that
  uses Anthropic's `window.storage` instead of Firebase. Historically kept in
  sync with index.html. **If migrating to a proper repo, the Firebase build
  (`index.html`) is the canonical one; the window.storage build can be dropped
  unless the user still wants it.**

## Tech constraints (important)

- **No build tooling.** GitHub Pages serves files as-is. Keep it runnable by
  just opening the hosted URL. Historically everything lived in ONE html file
  with inline `<script>` and `<style>`.
- If splitting into modules, use native `<script type="module">` + plain `.js`
  files (no bundler). NOTE: module scripts do NOT work over `file://` (CORS) —
  only over http(s) / GitHub Pages / a local server.
- **No browser storage APIs beyond what's already used.** State lives in Firebase
  (shared) + `localStorage` (per-browser session + dismissed-dialog tracking).
- Pure vanilla JS. No frameworks.

## Firebase

- Free Realtime Database, public read/write rules (fine for casual play — nothing
  sensitive is stored, only game state).
- The DB URL is passed to the app via `?db=...` query param and cached in
  `localStorage` under `remi-db-url`. Room code is passed via `?room=...`.
- **Gotcha:** Firebase silently converts empty objects/arrays (`{}` / `[]`) to
  `null` on save. `hydrateRoom()` restores sane defaults after every load. Any
  new always-present-collection field MUST be defaulted there too.

## Game rules (the actual variant — do not "correct" these to standard rummy)

- **2 decks = 108 cards** (104 + 4 jokers). 14 cards dealt per player; the first
  player to act gets a 15th.
- Dealer **rotates** each round. The player to the dealer's **right cuts**; the
  player to the dealer's **left** is first to act.
- **Cutting:** the revealed cut card is placed face-up. If it's a joker it's
  awarded as a bonus (to the cutter; or to the dealer if the *second*-from-bottom
  is the joker) and the recipient still keeps 14 total. There is ALWAYS a visible
  "special bottom card" — if the revealed card was awarded as a bonus joker, the
  next card is revealed to fill that slot.
- **Opening ("izlaganje") requires 51+ points** in the melds laid down in that
  one turn. After opening, that restriction no longer applies.
- **Card values for the 51 rule:** Ace = 1 if used low (A-2-3), Ace = 10 if in a
  set of 3/4 aces or in a Q-K-A run. J/Q/K = 10. Others = face. Joker = the value
  of the card it substitutes.
- **Melds:** run (3+ same suit consecutive, no wrap around K-A-2) or set (3-4 same
  rank, distinct suits). Jokers can fill.
- **Three kinds of "hand" (going out in one move, only if never opened before):**
  - **Mali hand:** whole 14-card hand sums to < 51, with joker=0 and ace=1.
  - **Veliki hand:** entire hand laid down as valid melds in one move.
  - **4 jokers / 8 identical cards:** highest tier.
- **Scoring at end of round:**
  - Winner (went out): **−10**.
  - A player who never opened: **+100**.
  - A player who opened but didn't go out: **sum of cards left in hand**, where
    Ace = 10, Joker = 20, J/Q/K = 10, others = face.
  - **Multiplier** if the winner went out with a hand: mali/veliki = **×2**,
    4-jokers/8-identical = **×3** (applies to everyone's round score).
- **Drawing from discard** is only allowed if the drawn card can be laid down
  somewhere that same turn (not just kept in hand).
- **Joker replacement:** a player may swap a joker that's exposed in a table meld
  for the real card it represents (exact rank+suit for a run; correct rank + a
  suit not already present for a set). The freed joker goes to their hand and MUST
  be laid down that same turn (new meld, or added to an existing one) before they
  can discard.
- **Completed real 4-of-a-kind** (four identical real cards, no joker) is swept
  off the table to the BOTTOM of the discard pile, and every player sees a
  dismissible dialog with the four cards highlighted in fluorescent green.
- **Hand display:** Ace sorts highest (after King). A run's joker displays in the
  slot it represents, not trailing.

## Code structure (current, single-file)

Inside the one html file, in `<script>`, roughly in this order:
1. **Pure logic** (no DOM): `makeDeck`, `shuffle`, card values, `resolveMeld`
   (→ `trySet` / `tryRun`), `isValidMeld`, `sumOpeningValue`, `canOpenWith`,
   `maliHandValue`/`isMaliHand`, `canPartitionAll`/`findPartition`,
   `isFourJokerOrEightSameHand`/`findFourJokerOrEightSame`,
   `enumerateSingleJokerRunWindows`, `computeSelectedSum`/`guessJokerRankValue`.
2. **Round engine:** `setupRound`, `scoreRound`, `sweepCompletedQuads`.
3. **Storage/session:** `loadRoom`/`saveRoom` (Firebase REST), `hydrateRoom`,
   `mySession`/`saveSession`, room create/join.
4. **Actions:** `actionDrawStock`, `actionDrawDiscard`, `actionDiscard`,
   `actionLayMultipleSelected`, `actionAddToMeld`, `actionReplaceJoker`,
   `actionDeclare{Mali,Veliki,FourJoker}Hand`, `actionTryBottomCard`,
   `hostStartGame`/`hostNextRound`/`hostResetGame`.
5. **Rendering:** `render` and `render*` helpers, `showChoiceModal`,
   `showQuadAnnouncementModal`, `showToast`.

Key internal joker markers: `_lockedRank`/`_lockedAceHigh` (a joker's chosen
position in a run), `jokerCardId` (which physical joker fills a resolved slot),
`pendingJokerToPlace` (a freed joker that must be laid down before discarding).

## Testing

`test_runner.html` is a static page that loads the game logic and runs visible
assertions (green = pass, red = fail). **Test 1 is the set-joker-replacement
scenario.** When changing logic, add/adjust a test here FIRST, and keep all tests
green. There is also a Python builder (`build_test_page.py`) that regenerated the
test page from the single-file build — if the code is split into modules, the
test page should import the logic module directly instead.

## Working agreement with the user

- Make changes, then **ask for confirmation before every git commit**, with a
  clear description of what changed.
- Keep changes small and tested. Run/verify the test suite before proposing a commit.
- Preserve the two-space-ish existing style; don't reformat unrelated code.
