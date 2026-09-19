.DEFAULT_GOAL := help

PACKAGE := @sincpro/criteria-react

typecheck:
	@npx tsc --noEmit

format:
	@echo "🔤 Sorting imports + auto-fix (eslint)..."
	@npx eslint . --fix
	@echo "🎨 Formatting (prettier)..."
	@npx prettier --experimental-cli --write "**/*.{ts,md}" --ignore-path ../../.prettierignore --ignore-unknown
	@echo "Checking types after formatting..."
	@$(MAKE) typecheck

lint:
	@npx eslint .

doctor:
	@bash scripts/doctor.sh

test:
	@echo "🧪 Running tests..."
	@node --import tsx --test "tests/**/*.test.ts"

verify-format: format lint doctor
	@echo "✓ $(PACKAGE) format verification passed"

build:
	@echo "🏗️  Building $(PACKAGE) -> dist (tsc)..."
	@rm -rf dist
	@npx tsc -p tsconfig.build.json
	@npx tsc-alias -p tsconfig.build.json
	@echo "✓ Build ready in ./dist"

# `--package-lock=false`: without it, `npm version` (v7+) rebuilds its dependency tree as part
# of the bump — including this package's own devDependency on `@sincpro/criteria` — against
# the REAL registry, since npm doesn't read yarn.lock or yarn's workspace symlinks. That 404s
# until `@sincpro/criteria` is actually published. This repo has no package-lock.json to keep
# in sync anyway (yarn.lock is the one lockfile), so there is nothing this flag gives up.
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

.PHONY: typecheck format lint doctor test verify-format build update-version publish clean
