#!/usr/bin/env bash
# The peer range this package ships with on @sincpro/criteria: the major it is released beside.
#
#   bash scripts/peer-range.sh 2.3.1   → "@sincpro/criteria": "^2.0.0"
#
# Run by `make update-version`, after the version itself: versioning is lockstep (the root
# Makefile bumps every package to the same version), so criteria-react X.y.z always ships beside
# criteria X — and a range written by hand is a range that goes stale (`^0.3.0` shipped with
# criteria 1.0, 1.1 and 2.0). `make doctor` says so if it is ever written by hand again.
set -euo pipefail

VERSION="${1:-}"
node -e '
  const fs = require("fs");
  const version = process.argv[1];
  const major = /^(\d+)\./.exec(version)?.[1];
  if (major === undefined) {
    console.error(`✘ "${version}" is not a version: usage: bash scripts/peer-range.sh 1.2.3`);
    process.exit(1);
  }
  const manifest = JSON.parse(fs.readFileSync("package.json", "utf8"));
  const range = `^${major}.0.0`;
  if (manifest.peerDependencies["@sincpro/criteria"] !== range) {
    manifest.peerDependencies["@sincpro/criteria"] = range;
    fs.writeFileSync("package.json", `${JSON.stringify(manifest, null, 2)}\n`);
  }
  console.log(`✓ peer @sincpro/criteria ${range}`);
' "$VERSION"
