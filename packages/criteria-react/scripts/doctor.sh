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
echo "── the peer range on @sincpro/criteria is the major this package ships beside ──"
# Lockstep versioning: criteria-react X.y.z is released beside criteria X. A range that does not
# take that major (\`^0.3.0\` shipped with criteria 1.0, 1.1 and 2.0) makes every install warn
# or refuse. \`make update-version\` writes it; this says so when it was written by hand.
mismatch="$(node -e '
  const own = require("./package.json");
  const criteria = require("../criteria/package.json");
  const wanted = "^" + criteria.version.split(".")[0] + ".0.0";
  const declared = own.peerDependencies["@sincpro/criteria"];
  if (declared !== wanted) console.log("  peerDependencies[\"@sincpro/criteria\"] is " + declared + ", criteria is " + criteria.version + ": it must be " + wanted);
')"
if [ -n "$mismatch" ]; then
  echo "$mismatch"
  found=1
else
  echo "  ✓ it is"
fi

echo ""
if [ "$found" = "0" ]; then
  echo "✓ no traps found"
else
  echo "✘ traps found"
fi
exit "$found"
