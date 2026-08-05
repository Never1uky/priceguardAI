#!/usr/bin/env bash
# Deno-check every Edge Function entrypoint (supabase/functions/*/index.ts).
# Usage: bash scripts/deno-check-functions.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if ! command -v deno >/dev/null 2>&1; then
  echo "deno not found on PATH" >&2
  exit 1
fi

CONFIG="supabase/functions/deno.json"
shopt -s nullglob
entries=(supabase/functions/*/index.ts)
if [ ${#entries[@]} -eq 0 ]; then
  echo "No supabase/functions/*/index.ts found" >&2
  exit 1
fi

fail=0
for f in "${entries[@]}"; do
  echo "==> deno check $f"
  if ! deno check --config="$CONFIG" "$f"; then
    echo "FAIL: $f" >&2
    fail=1
  fi
done

if [ "$fail" -ne 0 ]; then
  echo "deno check failed for one or more functions" >&2
  exit 1
fi

echo "OK: deno check passed for ${#entries[@]} functions"
