.DEFAULT_GOAL := help

PACKAGE := @sincpro/criteria

prepare-environment:
	@pipx install pre-commit
	@pipx ensurepath
	@pre-commit install

init: prepare-environment
	@echo "Installing Node.js dependencies..."
	@yarn install

typecheck:
	@npx tsc --noEmit

format:
	@echo "🔤 Sorting imports + auto-fix (eslint)..."
	@npx eslint . --fix
	@echo "🎨 Formatting (prettier)..."
	@npx prettier --write "**/*.{ts,json,yml,yaml,md}" --ignore-path .prettierignore --ignore-unknown
	@echo "Checking types after formatting..."
	@make typecheck

lint:
	@npx eslint .

doctor:
	@bash scripts/doctor.sh

test:
	@echo "🧪 Running tests..."
	@node --import tsx --test "tests/**/*.test.ts"

verify-format: format lint doctor
	@if ! git diff --quiet; then \
	  echo >&2 "✘ Formatting changed files. Please add them to the commit."; \
	  git --no-pager diff --name-only HEAD -- >&2; \
	  exit 1; \
	fi
	@echo "✓ Format verification passed"

build:
	@echo "🏗️  Building $(PACKAGE) -> dist (tsc)..."
	@rm -rf dist
	@npx tsc -p tsconfig.build.json
	@npx tsc-alias -p tsconfig.build.json
	@echo "✓ Build ready in ./dist (JS + .d.ts, @sincpro/criteria resolved to relative)"

update-version:
ifndef VERSION
	$(error VERSION is required. Usage: make update-version VERSION=1.2.3)
endif
	@CURRENT_VERSION=$$(node -p "require('./package.json').version"); \
	if [ "$$CURRENT_VERSION" = "$(VERSION)" ]; then \
		echo "✓ Version is already $(VERSION), skipping update"; \
	else \
		npm version $(VERSION) --no-git-tag-version && echo "✓ Version updated to $(VERSION)"; \
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

deploy:
	@echo "Deploy not applicable for library modules"

clean:
	@rm -rf dist node_modules
	@echo "✓ Cleaned"

.PHONY: prepare-environment init typecheck format lint doctor test verify-format build update-version publish deploy clean
