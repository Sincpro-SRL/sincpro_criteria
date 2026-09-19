#!/usr/bin/env bash
# make doctor — checks the one trap specific to this package: it stays cache-library-agnostic,
# so it must never itself import a specific cache (react-query, SWR, …) — that decision
# belongs to whoever uses queryKeyFor, not to this package.
set -uo pipefail

SRC=src
found=0
scan() { grep -rnE --include=*.ts "$1" "$SRC" 2>/dev/null | grep -vE ':[0-9]+: *(\*|//|/\*)'; }

echo "🩺 make doctor — checking the traps (see ../../docs/DESIGN.md)"
echo ""
echo "── importing a specific cache library here would defeat the point of queryKeyFor ──"
matches="$(scan 'from "(@tanstack/react-query|swr|axios)"')"
if [ -n "$matches" ]; then
  echo "$matches"
  found=1
else
  echo "  ✓ none"
fi

echo ""
if [ "$found" = "0" ]; then
  echo "✓ no traps found"
else
  echo "✘ traps found"
fi
exit "$found"
