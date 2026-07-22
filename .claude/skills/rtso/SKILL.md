---
name: rtso
description: This skill should be used when Niko says "rtso" or asks to test, then ship, the current Remi changes in one go - runs remi-smart-testing, reports pass/fail (with a proposed fix on fail), asks what to do next, and on "commit and push" runs remi-ship then opens the live site in both Safari and Chrome. Orchestrates remi-smart-testing and remi-ship end to end.
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

Give Niko a short, direct result in Serbian:

- **PROŠLO**: one line on what was checked and how (e.g. "node --check
  prosao, engine.js logika proverena za X").
- **PALO**: name exactly what failed (which check, the actual error/wrong
  output - not a vague "something's off"), and propose a concrete fix
  (what you'd change and why you think it's the actual cause, not a guess
  dressed up as certain).

## Step 3 - Ask what's next

Use `AskUserQuestion` (one question, in Serbian):

- If PALO: options are "Popravi" (apply the proposed fix) / "Commit i push
  ipak" (ship anyway, e.g. if the failure is known-acceptable) / "Stani za
  sad".
- If PROŠLO: options are "Commit i push" / "Stani za sad" (nothing to fix,
  so no fix option).

## Step 4 - Branch on the answer

- **Popravi**: apply the fix, then go back to **Step 1** (re-test) rather
  than assuming the fix worked. Repeat the loop until PROŠLO or Niko picks
  "Stani".
- **Stani za sad**: stop here, do nothing further. Don't commit, don't push.
- **Commit i push**: invoke the `remi-ship` skill. It handles its own
  confirmation, commit, push, and build-wait, and opens the live site in
  Safari on success.

## Step 5 - After remi-ship succeeds, also open Chrome

`remi-ship` already opens `https://nikonikokaoja.github.io/remi/` in both
Safari and Chrome once the GitHub Pages build completes:
```
open -a "Google Chrome" "https://nikonikokaoja.github.io/remi/"
```
This skill's job is just to make sure that happens as part of the
test -> ship loop below - `remi-ship` itself owns the actual open calls.

If `remi-ship` reports the build failed, stop here - don't open either
browser, that's already handled by `remi-ship`'s own failure path.

## Notes

- Never skip straight to `remi-ship` without running the test loop first -
  that's the entire point of this skill over just invoking `remi-ship`
  directly.
- Communicate with Niko in Serbian throughout, per CLAUDE.md.
