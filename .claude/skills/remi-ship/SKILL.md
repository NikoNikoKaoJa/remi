---
name: remi-ship
description: This skill should be used when Niko asks to commit and push changes in the Remi project at ~/dev/claude/remi - phrases like "commit and push", "ship this", "deploy this". Covers bumping APP_VERSION, committing, and pushing to origin main.
version: 1.0.0
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

## 2. Propose, then confirm once

CLAUDE.md's working agreement requires confirmation before every commit.
Show Niko:
- the version bump (old -> new),
- a one-line summary of what changed and why (not a changelog dump),
- confirmation that you're about to commit **and push** (don't ask twice
  separately for commit and for push - one combined confirmation is enough
  since this skill's whole point is "commit and push").

Wait for a clear yes before touching git.

## 3. Commit

Stage the specific files that changed (never `git add -A`/`.`). Commit with
a message matching this repo's terse, why-focused style, and the trailer:

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
