---
name: remi-smart-testing
description: This skill should be used when verifying a code change in Niko's Remi (Serbian Rummy) project at ~/dev/claude/remi - deciding how to test a change, running node-based static/logic checks, or setting up a Safari-based live multiplayer test session. Use for phrases like "test this", "verify this works", "check this change", or when about to reach for a browser in this repo.
version: 2.0.0
---

# Remi: smart testing

Goal: verify changes with the *cheapest* method that actually answers the
question, and never spin up a browser without asking first and saying why.

**Chrome / the `claude-in-chrome` MCP tools are NOT used for this project.**
Live testing is Safari-only, driven by `open -a Safari`. Do not recommend or
load any `mcp__claude-in-chrome__*` tool here.

## Decision order (cheapest first)

1. **Read the diff.** If a human could tell it's correct just by reading it
   (a comment, a string, a `console.log` removed), no test is needed at all.
2. **Static JS check** - always do this for any touched `.js` file:
   ```
   node --input-type=module --check < js/whatever.js
   ```
   Catches syntax errors, typos, mismatched imports/exports instantly.
3. **Node-level logic check** - for anything touching `js/engine.js` (pure
   rules engine, no DOM, no app state per CLAUDE.md), import it directly in
   a throwaway node script and call the function(s) in question with a few
   concrete hands/inputs, asserting the expected result. This exercises real
   game logic (meld validation, scoring, hand detection, joker resolution)
   without a browser. Write the throwaway script to the scratchpad dir, run
   it, then delete it - it's not a real test suite, just a disposable check.
4. **grep for consistency** - e.g. confirm a renamed CSS class is updated
   everywhere it's referenced, a field defaulted in `hydrateRoom()` for any
   new always-present collection, etc.
5. **Live Safari test, only if the above genuinely can't answer the
   question** - see below. This is the expensive path; treat it as a last
   resort, not a default.

Reserve the browser for cases where *behavior over time* or
*visual/interactive* correctness is in question and can't be inferred from
source: animation/CSS hover-timing bugs, a new game-flow screen, a button
wired to the wrong handler, cross-tab multiplayer sync, anything where
"would a human need to look at this running to know if it's right?" is
genuinely yes.

## Before touching a browser: ask first

Never open Safari/start the local server silently. Send one short message
to Niko stating:
- what you're about to test (which screen/interaction),
- *why* it can't be checked statically (what specifically needs eyes or
  real interaction on it),
- what you're about to spin up (no-cache server + which tabs).

Wait for confirmation before proceeding. Skip this ask only if Niko already
explicitly asked you to test in the browser in this same turn.

## If a live test is warranted: the mechanics

### 1. Start a no-cache local server

Module scripts need http(s), not `file://`. But a plain
`python3 -m http.server` is **not acceptable on its own**: Safari has served
stale cached ES modules from a previous session and made an already-fixed
bug look unfixed. Write a small server script to the scratchpad dir that
subclasses `SimpleHTTPRequestHandler` and adds to every response:

```
Cache-Control: no-store, no-cache, must-revalidate, max-age=0
Pragma: no-cache
Expires: 0
```

chdir it to `/Users/nukropina/dev/claude/remi`, run it in the background.
**Prefer a fresh port on every re-test** - Safari keys its cache by URL.

Always tell Niko to confirm the version badge (bottom-right, `APP_VERSION`
from `js/state.js`) shows the expected new version before trusting any
result.

### 2. Seed the game state, don't play up to it

Do not manually play a game to reach the interesting point. Write a
throwaway node script in the scratchpad dir that `PUT`s a complete room
object straight into Firebase at `<dbUrl>/rooms/<CODE>.json`. The dbUrl is
in the `reference-firebase-db-url` memory
(`https://remi-8ed0e-default-rtdb.firebaseio.com`). **Always use a dedicated
test room code**, never one a real game might use (rules are public
read/write, no isolation).

The room object should mirror what `setupRound` in `js/engine.js` returns,
plus the fields `createRoom` in `js/room.js` adds: `code`,
`phase: 'playing'`, `players`, `dealerIndex`, `round`, `scores`, `hands`,
`stock`, `discard`, `melds`, `openedPlayers`, `currentPlayerIndex`,
`turnPhase`, `specialBottomCard`, `log`, ...

Craft the hands/piles so the change under test can be exercised in one or
two clicks. Before opening any browser, verify the scenario is actually
reachable with a quick node check, e.g.:
```
node --input-type=module -e "import { ... } from './js/engine.js'; ..."
```
(e.g. confirm a crafted hand really does form a veliki hand).

### 3. Open a NEW Safari window, one tab per player

Two players by default; more only if the change genuinely needs it.

**Always open a dedicated new Safari window for the test - never add tabs to
Niko's existing window.** `open -a Safari <url>` drops tabs into whatever
window happens to be frontmost, mixing test tabs in with his real browsing
(and making it far too easy to close/reload the wrong one). Use AppleScript
so the test lives in its own window that can be closed as a unit.

Safari shares localStorage across normal tabs and the app stores a single
session under `my-remi-session`, so tabs can't join as different players on
their own. The trick that works: create a **throwaway bootstrap page in the
repo root** (e.g. `test-session.html`) that reads a `?p=N` query param,
writes a fixed `{playerId, name, roomCode}` into
`localStorage['my-remi-session']` plus the db url into
`localStorage['remi-db-url']`, then `location.replace`s to
`index.html?db=...&room=CODE`.

Then, in one new window (wait a couple of seconds between tabs so each boots
with its own session):
```
osascript -e 'tell application "Safari" to make new document with properties {URL:"http://localhost:<port>/test-session.html?p=1"}'
sleep 3
osascript -e 'tell application "Safari" to tell front window to set current tab to (make new tab with properties {URL:"http://localhost:<port>/test-session.html?p=2"})'
```
Each tab keeps its identity in memory (the app only re-reads localStorage at
boot / on rejoin), so this works. **Warn Niko** that reloading tab 1 will
turn it into player 2, and that reopening the `?p=1` URL fixes it.

### 4. Diagnosing without a browser at all

For frame-by-frame animation/timing bugs (e.g. a hover flicker), a screen
recording from Niko can be diagnosed with no live browser: extract frames
with `ffmpeg` and tile them into one contact sheet for a quick visual diff
across time, e.g.:
```
ffmpeg -y -i recording.mov -vf "crop=W:H:X:Y,fps=30,tile=6x15" tile.png
```
This is often enough to pinpoint the bug and skip the live test entirely.

## Always clean up before ending the turn

1. Kill the server: `pkill -f "<scratchpad server script>"` (or
   `kill $(lsof -ti:<port>)`).
2. Close the test window (only tabs on the test port, so Niko's own windows
   are never touched):
   ```
   osascript -e 'tell application "Safari" to close (every tab of every window whose URL contains "localhost:<port>")'
   ```
3. Delete the throwaway bootstrap page from the repo root
   (`test-session.html`) - it must never be committed.
4. Delete the seeded test room from Firebase:
   `curl -X DELETE <dbUrl>/rooms/<CODE>.json`
5. Delete the scratchpad scripts/frames.

Exception: after a `git push origin main`, the post-push Safari verification
window is meant to stay open for Niko to look at - that's a different flow,
not this one (see the `feedback-post-push-workflow` memory).
