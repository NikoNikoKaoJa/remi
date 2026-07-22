---
name: remi-ship
description: This skill should be used when Niko asks to commit and push changes in the Remi project at ~/dev/claude/remi and have the GitHub Pages build watched to completion - phrases like "commit and push", "ship this", "deploy this", "push it and wait for the build". Covers bumping APP_VERSION, committing, pushing to origin main, polling the GitHub Actions pages-build run, and opening the live site in both Safari and Chrome once done.
version: 1.0.0
---

# Remi: commit, push, and watch the build

End-to-end "ship it" flow for this repo: version bump -> commit -> push ->
wait for GitHub Pages -> open the live result in Safari.

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

## 5. Wait for the GitHub Pages build

Get the pushed commit's short SHA from the push output or `git rev-parse
HEAD`. Poll:

```
curl -s "https://api.github.com/repos/NikoNikoKaoJa/remi/actions/runs?branch=main&per_page=1" \
  | python3 -c "import json,sys; d=json.load(sys.stdin); r=d['workflow_runs'][0]; print(r['head_sha'], r['status'], r['conclusion'], r['name'])"
```

Confirm `head_sha` matches the commit you just pushed (if it doesn't yet,
the run list hasn't caught up - check again shortly). Do **not** busy-loop
with `sleep`: use `ScheduleWakeup` with a 60-90s delay to check back,
repeating until `status` is `completed`. A pages build typically finishes
within 1-2 minutes.

## 6. On completion

- If `conclusion` is `success`: open the live site in **both Safari and
  Chrome**, each showing the live version:
  ```
  open -a Safari "https://nikonikokaoja.github.io/remi/"
  open -a "Google Chrome" "https://nikonikokaoja.github.io/remi/"
  ```
  Tell Niko in Serbian that the new version is live. Leave both
  windows open for him.

- If `conclusion` is anything else (`failure`, `cancelled`, ...): don't open
  either browser. Report the failed run and point to the Actions log
  (`https://github.com/NikoNikoKaoJa/remi/actions`) instead of guessing at
  the cause.

## Notes

- This flow assumes `remi-smart-testing` (or equivalent verification) has
  already happened *before* this skill runs - this skill does not itself
  re-verify the change, it ships what's already been confirmed good.
- Communicate with Niko in Serbian throughout, per CLAUDE.md.
