---
name: remi-smart-testing
description: This skill should be used when verifying a code change in Niko's Remi (Serbian Rummy) project at ~/dev/claude/remi - deciding how to test a change, running node-based static/logic checks, or setting up a Chrome-based (claude-in-chrome) live multiplayer test session. Use for phrases like "test this", "verify this works", "check this change", or when about to reach for a browser in this repo.
version: 3.0.0
---

# Remi: smart testing

Goal: verify changes with the *cheapest* method that actually answers the
question, and never spin up a browser without asking first and saying why.

**Live testing uses Chrome via the `claude-in-chrome` MCP tools** (Niko,
2026-10-16: "use chrome from now on"). Don't script Safari - Niko plays real
games there - unless he explicitly asks for a Safari test.

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
5. **Live Chrome test, only if the above genuinely can't answer the
   question** - see below. This is the expensive path; treat it as a last
   resort, not a default.

Reserve the browser for cases where *behavior over time* or
*visual/interactive* correctness is in question and can't be inferred from
source: animation/CSS hover-timing bugs, drag behaviour, a new game-flow
screen, a button wired to the wrong handler, cross-tab multiplayer sync,
anything where "would a human need to look at this running to know if it's
right?" is genuinely yes.

## Before touching a browser: ask first

Never open Chrome/start the local server silently. Send one short message
to Niko stating:
- what you're about to test (which screen/interaction),
- *why* it can't be checked statically (what specifically needs eyes or
  real interaction on it),
- what you're about to spin up (no-cache server + which tabs).

Wait for confirmation before proceeding. Skip this ask only if Niko already
explicitly asked you to test in the browser in this same turn.

## If a live test is warranted: the mechanics

### 1. Start a no-cache local server

Module scripts need http(s), not `file://`. A plain `python3 -m http.server`
is **not acceptable on its own**: browsers have served stale cached ES
modules from a previous session and made an already-fixed bug look unfixed.
Write a small server script to the scratchpad dir that subclasses
`SimpleHTTPRequestHandler` and adds to every response:

```
Cache-Control: no-store, no-cache, must-revalidate, max-age=0
Pragma: no-cache
Expires: 0
```

chdir it to `/Users/nukropina/dev/claude/remi`, run it in the background.
**Prefer a fresh port on every re-test** - the cache is keyed by URL.

Before trusting any result, check the version badge (bottom-right,
`APP_VERSION` from `js/state.js`) - in Chrome you can read it yourself.

### 2. Seed the game state, don't play up to it

Do not manually play a game to reach the interesting point. Write a
throwaway node script in the scratchpad dir that `PUT`s a complete room
object straight into Firebase at `<dbUrl>/rooms/<CODE>.json`. The dbUrl is
in the `reference-firebase-db-url` memory
(`https://remi-8ed0e-default-rtdb.firebaseio.com`). **Always use a dedicated
test room code**, never one a real game might use (rules are public
read/write, no isolation).

Easiest base: import `setupRound` from `js/engine.js` in the seed script
and spread its result into `{ code, round, scores, createdAt, ... }` (the
fields `createRoom` in `js/room.js` adds). Then adjust hands/piles/
`handOrders`/`handRows` so the change under test can be exercised in one
or two moves. Before opening any browser, verify the scenario is actually
reachable with a quick node check, e.g.:
```
node --input-type=module -e "import { ... } from './js/engine.js'; ..."
```
(e.g. confirm a crafted hand really does form a veliki hand).

A room can be re-seeded mid-test (a fresh `writeId` makes the open tab
pick it up over the sync stream) - handy for setting up a second scenario.

### 3. Open Chrome tabs, one per player

Two players by default; more only if the change genuinely needs it. Start
with `tabs_context_mcp` (`createIfEmpty: true`) and work only in the MCP tab
group's own tabs - never touch Niko's other tabs. If the extension isn't
connected, stop and ask Niko to enable it.

Tabs share localStorage and the app stores a single session under
`my-remi-session`, so tabs can't join as different players on their own.
The trick that works: create a **throwaway bootstrap page in the repo root**
(`test-session.html`) that reads a `?p=N` query param, writes a fixed
`{playerId, name, roomCode}` into `localStorage['my-remi-session']`, then
`location.replace`s to `index.html?room=CODE`. Open `?p=1` in one tab, wait
for it to boot, then `?p=2` in another. Each tab keeps its identity in
memory (the app only re-reads localStorage at boot / on rejoin), so
reloading a tab makes it whoever booted last - re-open its `?p=N` URL.

Useful in Chrome:
- `javascript_tool` to read layout / state (card ids per hand row, rects)
  instead of eyeballing screenshots - assert on the actual DOM.
- `computer` `left_click_drag` for real pointer drags; batch drag + DOM
  check with `browser_batch`.
- `read_console_messages` (`onlyErrors: true`) at the end.
- To prove a fix, `git stash push <file>`, reload, repeat the exact same
  action to reproduce the bug, then `git stash pop` and repeat again.
- Mouse drags can't exercise touch-only paths (pointercancel, iOS long-press
  callout) - say so in the report rather than claiming them tested.

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

Small, separate commands with literal full paths - Niko rejected one big
combined cleanup command (pkill + curl DELETE + `rm -rf $VAR/*`) as looking
dangerous:

1. Close every test tab with `tabs_close_mcp` (only the MCP group's tabs).
2. Kill the server by its full scratchpad path:
   `pkill -f "<full scratchpad path>/server.py"`.
3. Delete the seeded test room: `node scripts/rooms.mjs delete <CODE>`.
4. Delete the throwaway bootstrap page: `rm /Users/nukropina/dev/claude/remi/test-session.html`
   - it must never be committed.
5. `rm` the scratchpad scripts by name (never `rm -rf $VAR/*`).
