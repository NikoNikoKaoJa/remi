#!/usr/bin/env bash
# Poll the GitHub Actions build status for this repo's main branch every 5s,
# overwriting the status line in place, until the run completes.
#
# Usage: scripts/watch-build.sh [owner/repo]
# Defaults to NikoNikoKaoJa/remi.

set -euo pipefail

REPO="${1:-NikoNikoKaoJa/remi}"
INTERVAL=5
start_ts=$(date +%s)

fmt_elapsed() {
  local secs=$1
  printf '%dm%02ds' $((secs / 60)) $((secs % 60))
}

while true; do
  now=$(date +%s)
  elapsed=$(fmt_elapsed $((now - start_ts)))

  run_json=$(curl -sf "https://api.github.com/repos/${REPO}/actions/runs?branch=main&per_page=1") || {
    printf '\r\033[K[%s] error contacting GitHub API, retrying...' "$elapsed"
    sleep "$INTERVAL"
    continue
  }

  status=$(jq -r '.workflow_runs[0].status // "unknown"' <<<"$run_json")
  conclusion=$(jq -r '.workflow_runs[0].conclusion // "-"' <<<"$run_json")
  name=$(jq -r '.workflow_runs[0].name // "-"' <<<"$run_json")
  sha=$(jq -r '.workflow_runs[0].head_sha // "-"' <<<"$run_json" | cut -c1-7)

  printf '\r\033[K[%s] %s (%s) status=%s conclusion=%s' "$elapsed" "$name" "$sha" "$status" "$conclusion"

  if [[ "$status" == "completed" ]]; then
    echo
    if [[ "$conclusion" == "success" ]]; then
      echo "Build finished successfully after $elapsed."
    else
      echo "Build finished with conclusion '$conclusion' after $elapsed."
    fi
    exit 0
  fi

  sleep "$INTERVAL"
done
