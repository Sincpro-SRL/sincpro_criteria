.DEFAULT_GOAL := help

# Every package in the workspace with its own Makefile, in dependency order — criteria-react
# depends on criteria, so it typechecks/builds/tests after it.
PACKAGES := packages/criteria packages/criteria-react

prepare-environment:
	@pipx install pre-commit
	@pipx ensurepath
	@pre-commit install

init: prepare-environment
	@echo "Installing Node.js dependencies for the whole workspace..."
	@yarn install

typecheck:
	@for p in $(PACKAGES); do $(MAKE) -C $$p typecheck || exit 1; done

format: format-root
	@npx prettier --experimental-cli --write "*.{md,json}" "docs/**/*.md" ".github/**/*.{yaml,yml}" --ignore-path .prettierignore --ignore-unknown
	@for p in $(PACKAGES); do $(MAKE) -C $$p format || exit 1; done

lint:
	@for p in $(PACKAGES); do $(MAKE) -C $$p lint || exit 1; done

doctor:
	@for p in $(PACKAGES); do $(MAKE) -C $$p doctor || exit 1; done

test:
	@for p in $(PACKAGES); do $(MAKE) -C $$p test || exit 1; done

sync-parity:
	@$(MAKE) -C packages/criteria sync-parity

check-parity:
	@$(MAKE) -C packages/criteria check-parity

# Every package's own `verify-format` runs its format/lint/doctor/check-parity; the one thing
# worth doing only once, from here, is asking git whether any of that left the tree dirty —
# doing it per package would just repeat the same repo-wide answer once per package.
verify-format: format-root
	@for p in $(PACKAGES); do $(MAKE) -C $$p verify-format || exit 1; done
	@if ! git diff --quiet; then \
	  echo >&2 "✘ Formatting changed files. Please add them to the commit."; \
	  git --no-pager diff --name-only HEAD -- >&2; \
	  exit 1; \
	fi
	@echo "✓ Format verification passed"

build:
	@for p in $(PACKAGES); do $(MAKE) -C $$p build || exit 1; done

# Lockstep, not independent, versioning — not a preference, a constraint: the shared
# `Sincpro-SRL/.github` release pipeline computes ONE version from the GitHub release tag and
# calls `make update-version VERSION=x` ONCE, at the repo root. It has no notion of separate
# packages, so every package in $(PACKAGES) is bumped to the same VERSION on every release,
# whether or not that package's own code changed. See docs/DESIGN.md's "Repo layout" for the
# independent-versioning intent this overrides, and why.
update-version:
ifndef VERSION
	$(error VERSION is required. Usage: make update-version VERSION=1.2.3)
endif
	@for p in $(PACKAGES); do $(MAKE) -C $$p update-version VERSION=$(VERSION) || exit 1; done

publish:
	@for p in $(PACKAGES); do $(MAKE) -C $$p publish || exit 1; done

deploy:
	@echo "Deploy not applicable for library packages"

clean:
	@for p in $(PACKAGES); do $(MAKE) -C $$p clean || exit 1; done
	@rm -rf node_modules

.PHONY: prepare-environment init typecheck format-root format lint doctor test sync-parity \
	check-parity verify-format build update-version publish deploy clean
