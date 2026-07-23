---
name: rtso
description: This skill should be used when Niko says "rtso" or asks to test, then ship, the current Remi changes in one go - runs remi-smart-testing, reports pass/fail (with a proposed fix on fail), asks what to do next, and on "commit and push" runs remi-ship. Orchestrates remi-smart-testing and remi-ship end to end.
version: 1.0.0
---

# rtso: test, then ship, the current Remi changes

Orchestrator over `remi-smart-testing` and `remi-ship`. Loops on test ->
report -> ask, only reaching for `remi-ship` once Niko explicitly says so.

## Step 1 - Test

Invoke the `remi-smart-testing` skill (via the `Skill` tool) against the
current uncommitted change(s) in ~/dev/claude/remi. Let it decide the
cheapest sufficient method (static checks first, Chrome only if warranted
and only after it separately asks/explains, per that skill's own rules).

## Step 2 - Report PASS/FAIL

Give Niko a short, direct result in English:

- **PASS**: one line on what was checked and how (e.g. "node --check
  passed, engine.js logic verified for X").
- **FAIL**: name exactly what failed (which check, the actual error/wrong
  output - not a vague "something's off"), and propose a concrete fix
  (what you'd change and why you think it's the actual cause, not a guess
  dressed up as certain).

## Step 3 - Ask what's next

Use `AskUserQuestion` (one question, in English):

- If FAIL: options are "Fix" (apply the proposed fix) / "Commit and push
  anyway" (ship anyway, e.g. if the failure is known-acceptable) / "Stop
  for now".
- If PASS: options are "Commit and push" / "Stop for now" (nothing to fix,
  so no fix option).

## Step 4 - Branch on the answer

- **Fix**: apply the fix, then go back to **Step 1** (re-test) rather
  than assuming the fix worked. Repeat the loop until PASS or Niko picks
  "Stop".
- **Stop for now**: stop here, do nothing further. Don't commit, don't push.
- **Commit and push**: invoke the `remi-ship` skill. It handles its own
  confirmation, commit, and push.

## Notes

- Never skip straight to `remi-ship` without running the test loop first -
  that's the entire point of this skill over just invoking `remi-ship`
  directly.
- Communicate with Niko in English throughout, per CLAUDE.md.
