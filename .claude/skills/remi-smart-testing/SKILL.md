---
name: remi-smart-testing
description: This skill should be used when verifying a code change in Niko's Remi (Serbian Rummy) project at ~/dev/claude/remi - deciding how to test a change, running node-based static/logic checks, or setting up a Chrome-based live multiplayer test session. Use for phrases like "test this", "verify this works", "check this change", or when about to reach for claude-in-chrome in this repo.
version: 1.0.0
---

# Remi: smart testing

Goal: verify changes with the *cheapest* method that actually answers the
question, and never spin up Chrome without asking first and saying why.

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
5. **Chrome, only if the above genuinely can't answer the question** - see
   below. This is the expensive path; treat it as a last resort, not a
   default.

Reserve Chrome for cases where *behavior over time* or *visual/interactive*
correctness is in question and can't be inferred from source: animation/CSS
hover-timing bugs, a new game-flow screen, a button wired to the wrong
handler, cross-tab multiplayer sync, anything where "would a human need to
look at this running to know if it's right?" is genuinely yes.

## Before touching Chrome: ask first

Never open Chrome/start the local server silently. Send one short message
to Niko stating:
- what you're about to test (which screen/interaction),
- *why* it can't be checked statically (what specifically needs eyes or
  real interaction on it),
- what you're about to spin up (local server + which tabs).

Wait for confirmation before proceeding. Skip this ask only if Niko already
explicitly asked you to test in the browser in this same turn.

## If Chrome is warranted: the mechanics

1. Load the tools you'll need in one `ToolSearch` call, e.g.:
   `select:mcp__claude-in-chrome__tabs_context_mcp,mcp__claude-in-chrome__navigate,mcp__claude-in-chrome__computer,mcp__claude-in-chrome__tabs_create_mcp,mcp__claude-in-chrome__read_console_messages,mcp__claude-in-chrome__browser_batch`
2. Start a local server (module scripts need http(s), not `file://`):
   ```
   (python3 -m http.server <port> >/tmp/remi-server.log 2>&1 &)
   ```
   Pick a port not already in use.
3. Use the real Firebase DB for local testing - see the
   `reference-firebase-db-url` memory for the URL. **Always create a fresh
   room code** rather than touching any room a real game might be using
   (rules are public read/write, no isolation between test and real rooms).
   Navigate to:
   `http://localhost:<port>/index.html?db=<dbUrl>`
4. Most game-flow screens need **2 players** to start a round (see
   `js/actions.js`: `players.length < 2` gate). Open a second tab, join with
   the room code, and drive both from there when the thing under test is
   turn-based.
5. Batch clicks/types/screenshots with `browser_batch` instead of one call
   per action.
6. **Stale module cache gotcha**: if you edited a `.js` module the page
   already had loaded and then re-navigate, you may see a spurious
   `SyntaxError: ... does not provide an export named 'x'` from a cached
   copy of the old file. Hard-reload (`cmd+shift+r`) before trusting a
   module-loading error.
7. Check `read_console_messages` (with `onlyErrors: true`) after any
   interaction sequence - don't rely on screenshots alone to catch JS
   exceptions.
8. For frame-by-frame animation/timing bugs (e.g. a hover flicker), a
   screen recording from Niko can be diagnosed without any live
   interaction at all: extract frames with `ffmpeg` and tile them into one
   contact sheet for a quick visual diff across time, e.g.:
   ```
   ffmpeg -y -i recording.mov -vf "crop=W:H:X:Y,fps=30,tile=6x15" tile.png
   ```
   This is often enough to pinpoint the bug and skip live Chrome entirely.

## Always clean up before ending the turn

1. `pkill -f "http.server <port>"` (or `kill $(lsof -ti:<port>)`).
2. Close every tab this session opened with `tabs_close_mcp` (get IDs from
   `tabs_context_mcp` first). The tab group auto-removes once its last tab
   closes.
3. Delete any scratchpad throwaway scripts/frames from steps 3 or 8 above.

Exception: after a `git push origin main`, the post-push Safari verification
window is meant to stay open for Niko to look at - that's a different flow,
not this one, and isn't Chrome-based anyway (Safari, per the
`feedback-post-push-workflow` memory).
