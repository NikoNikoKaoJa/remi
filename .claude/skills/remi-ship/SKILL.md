---
name: remi-ship
description: This skill should be used when Niko asks to commit and push changes in the Remi project at ~/dev/claude/remi - phrases like "commit and push", "ship this", "deploy this". Covers bumping APP_VERSION, committing, and pushing to origin main.
version: 1.1.0
---

# Remi: commit and push

End-to-end "ship it" flow for this repo: version bump -> commit -> push.

## 1. Pre-flight

Run in parallel: `git status` (never `-uall`), `git diff` (staged +
unstaged), `git log --oneline -8` (match this repo's commit message style -
short, imperative, often ends with `(vX.YY)`).

Check `js/state.js` for `export const APP_VERSION = 'vX.Y'`. Per the
`versioning-convention` memory, bump it to the next minor version as part of
this same commit whenever code changed - do this without being asked, and
say the new version out loud when proposing the commit.

**Exception:** if `js/state.js` already has an uncommitted, unstaged change
to `APP_VERSION` sitting in the working tree (e.g. a concurrent agent bumped
it as part of unrelated work-in-progress, per the
`feedback-concurrent-agents-small-commits` memory), don't edit that line
yourself - a second bump would either clobber their in-progress edit or land
two conflicting version numbers in the same file. Skip the bump for this
commit and say so plainly ("skipping the version bump - state.js already has
an uncommitted bump from other in-progress work").

## 2. Propose, then confirm once

CLAUDE.md's working agreement requires confirmation before every commit -
but the trigger phrase that invokes this skill ("commit and push", "ship
this", "deploy this") **is itself that confirmation** when Niko says it in
the same turn asking to ship. Don't show a summary and then wait for a
second yes in that case - just state what you're about to do (version bump
if any, one-line summary of what changed) and proceed straight to git.

Only pause for an explicit confirm-then-wait round if you're the one
proposing to ship (Niko hasn't said a trigger phrase yet this turn) - e.g.
after finishing an unrelated task, you asking "want me to commit and push
this?" does need to wait for the yes.

## 3. Commit

Stage the specific files that changed (never `git add -A`/`.`). If a file
has unrelated changes mixed in from concurrent work (another agent may be
editing the same repo at once, per the
`feedback-concurrent-agents-small-commits` memory - check `git diff` for
hunks that don't belong to this task before staging), stage only this
task's hunks with `git add -p` rather than the whole file, and verify with
`git diff --cached` that no other in-progress work rode along. Never
touch or stage hunks outside this task's scope, even if it'd be more
convenient to bundle them.

Commit with a message matching this repo's terse, why-focused style, and
the trailer:

```
git commit -m "$(cat <<'EOF'
<summary line, ending with (vX.YY) if it's a version-bump commit>

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

If a pre-commit hook fails, fix the issue and make a **new** commit - never
`--amend` a commit that didn't actually happen, never `--no-verify`.

## 4. Push

```
git push origin main
```

Never force-push. If the push is rejected (remote has diverged), stop and
tell Niko rather than resolving it unilaterally.


## Notes

- This flow assumes `remi-smart-testing` (or equivalent verification) has
  already happened *before* this skill runs - this skill does not itself
  re-verify the change, it ships what's already been confirmed good.
- Communicate with Niko in English throughout, per CLAUDE.md.
