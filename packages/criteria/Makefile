.DEFAULT_GOAL := help

PACKAGE := @sincpro/criteria

# From packages/criteria/, ../../../sincpro_framework is the sibling checkout at ~/dev/.
FRAMEWORK_REPO ?= ../../../sincpro_framework
PARITY_SRC := $(FRAMEWORK_REPO)/tests/ddd/criteria-parity.json
PARITY_DST := tests/criteria-parity.json

typecheck:
	@npx tsc --noEmit

format:
	@echo "🔤 Sorting imports + auto-fix (eslint)..."
	@npx eslint . --fix
	@echo "🎨 Formatting (prettier)..."
	@npx prettier --experimental-cli --write "**/*.{ts,json,md}" --ignore-path ../../.prettierignore --ignore-unknown
	@echo "Checking types after formatting..."
	@$(MAKE) typecheck

lint:
	@npx eslint .

doctor:
	@bash scripts/doctor.sh

test:
	@echo "🧪 Running tests..."
	@node --import tsx --test "tests/**/*.test.ts"

sync-parity:
	@if [ ! -f "$(PARITY_SRC)" ]; then \
		echo >&2 "✘ $(PARITY_SRC) not found — set FRAMEWORK_REPO=<path to a sincpro_framework checkout>"; \
		exit 1; \
	fi
	@cp "$(PARITY_SRC)" "$(PARITY_DST)"
	@echo "✓ Copied $(PARITY_SRC) -> $(PARITY_DST) — run 'make test' to confirm both engines still agree"

check-parity:
	@if [ ! -f "$(PARITY_SRC)" ]; then \
		echo "⚠ $(PARITY_SRC) not found — skipping parity fixture check (set FRAMEWORK_REPO to a sincpro_framework checkout to enable it)"; \
	elif diff -q "$(PARITY_SRC)" "$(PARITY_DST)" >/dev/null; then \
		echo "✓ $(PARITY_DST) is in sync with $(FRAMEWORK_REPO)"; \
	else \
		echo >&2 "✘ $(PARITY_DST) is out of date with $(PARITY_SRC) — run: make sync-parity"; \
		exit 1; \
	fi

# The root Makefile's `verify-format` runs this in every package, then checks once — from the
# repo root — whether any of it left the working tree dirty. Doing that check here too would
# just repeat it once per package for the same answer.
verify-format: format lint doctor check-parity
	@echo "✓ $(PACKAGE) format verification passed"

build:
	@echo "🏗️  Building $(PACKAGE) -> dist (tsc)..."
	@rm -rf dist
	@npx tsc -p tsconfig.build.json
	@npx tsc-alias -p tsconfig.build.json
	@echo "✓ Build ready in ./dist (JS + .d.ts, @sincpro/criteria resolved to relative)"

# `--package-lock=false`: without it, `npm version` (v7+) rebuilds its dependency tree as part
# of the bump, which means resolving every dependency — including the workspace-local
# `@sincpro/criteria` this package's own sibling package might depend on — against the REAL
# registry, since npm (unlike yarn, which manages this repo's installs) doesn't read yarn.lock
# or yarn's workspace symlinks. That 404s until the dependency is actually published. This repo
# has no package-lock.json to keep in sync anyway (yarn.lock is the one lockfile), so there is
# nothing this flag gives up.
update-version:
ifndef VERSION
	$(error VERSION is required. Usage: make update-version VERSION=1.2.3)
endif
	@CURRENT_VERSION=$$(node -p "require('./package.json').version"); \
	if [ "$$CURRENT_VERSION" = "$(VERSION)" ]; then \
		echo "✓ Version is already $(VERSION), skipping update"; \
	else \
		npm version $(VERSION) --no-git-tag-version --package-lock=false && \
			echo "✓ Version updated to $(VERSION)"; \
	fi

publish: build
	@echo "📦 Publishing $(PACKAGE) to NPM..."
	@if [ -n "$$NPM_TOKEN" ]; then \
		echo "//registry.npmjs.org/:_authToken=$$NPM_TOKEN" > .npmrc.tmp; \
		chmod 600 .npmrc.tmp; \
		npm publish --access public --userconfig .npmrc.tmp; \
		rm -f .npmrc.tmp; \
	else \
		npm publish --access public; \
	fi
	@echo "✓ Published successfully"

clean:
	@rm -rf dist
	@echo "✓ Cleaned"

.PHONY: typecheck format lint doctor test sync-parity check-parity verify-format build update-version publish clean
