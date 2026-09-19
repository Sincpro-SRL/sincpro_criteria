#!/usr/bin/env bash
# make doctor — statically catches the known traps of @sincpro/criteria, the ones `tsc` does
# NOT catch. See docs/GOTCHAS.md. Exits non-zero when it finds one.
set -uo pipefail

SRC=sincpro_criteria

found=0
note() { echo "  ✗ $1"; found=1; }
section() {
  echo ""
  echo "── $1 ──"
}
report() { # report <matches>
  if [ -n "$1" ]; then
    echo "$1" | while IFS= read -r line; do note "$line"; done
    found=1
  else
    echo "  ✓ none"
  fi
}

# Scans the source, skipping comment lines: an example inside a docstring is documentation.
scan() { grep -rnE --include=*.ts "$1" "$SRC" 2>/dev/null | grep -vE ':[0-9]+: *(\*|//|/\*)'; }

echo "🩺 make doctor — checking the traps (see docs/GOTCHAS.md)"

section "1. the core reaching outside (it has no dependencies, and keeps none)"
report "$(scan 'from "(react|react-dom|axios|node:[a-z]+|fs|path|http|https)"|(^|[^.[:alnum:]_])fetch\(|\bXMLHttpRequest\b|\blocalStorage\b')"

section "2. a relative import (the source names itself @sincpro/criteria)"
report "$(scan 'from "\.')"

section "3. a .ts extension in an import (the build emits it as-is and the package breaks)"
report "$(scan 'from "[^"]+\.ts"')"

section "4. Date.parse outside engine/temporal.ts (it answers \"utf-8\" with a day in 2001)"
report "$(scan '\bDate\.parse\(' | grep -v "^$SRC/engine/temporal.ts:")"

section "5. a field-name parameter without NoInfer (TypeScript runs the type backwards)"
report "$(scan '\(field: Fields<|field: Fields<[A-Za-z]+>,')"

echo ""
if [ "$found" = "0" ]; then
  echo "✓ no traps found"
else
  echo "✘ traps found — see docs/GOTCHAS.md"
fi
exit "$found"
