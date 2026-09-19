# Status — read this first if you are resuming this work

This is a handoff note, not permanent documentation. It exists so a new session (human or
agent) can pick this repository back up without re-deriving decisions that were already made
and verified. The README and `AGENTS.md` are the permanent docs; this file is disposable once
everything below is committed, PR'd and merged — delete it then.

## One paragraph

`@sincpro/criteria` mirrors the Sincpro engine's read grammar (`sincpro_framework/ddd/`) in
TypeScript, with zero dependencies. This session took it from "the grammar exists" to "the
vocabulary matches the engine exactly, in Python, in the wire JSON and in TypeScript — plus an
`analysis` addon for charts/dashboards, and a parity suite that keeps the two engines honest."
The framework side is **already merged** (`sincpro_framework` PR #105, on `main`). This repo
is **not yet committed** — waiting for a branch + PR. (Grew from 46 to 51 files mid-session for
the `criteria-rest` addon, see roadmap #2.)

**The repo became a yarn workspaces monorepo mid-session, after that.** This package now lives
at `packages/criteria` (moved with plain `mv`, not `git mv`, since nothing is committed yet —
there is nothing for git to detect a rename against). The root holds the workspace manifest,
the dispatching `Makefile`, and `docs/DESIGN.md` (spans every package). See `docs/DESIGN.md`
for why, and its "Repo layout" section for what else is planned to live beside this package
(`packages/criteria-react`, …). Every path in this file that says `tests/...` or
`sincpro_criteria/...` is relative to **this package's own directory**
(`packages/criteria/`), not the repo root — commands in this file assume `cd packages/criteria`
or use the root `Makefile`'s equivalent target, which fans out here.

## Current verified state (re-run before trusting this doc)

```bash
make verify-format   # eslint --fix + prettier + doctor + check-parity
make typecheck        # tsc --noEmit — also enforces tests/types.test.ts's @ts-expect-error contract
make test             # 258 tests, 0 fail
make build             # dist/ builds clean
```

Last run: 258 tests passing (252 from before this addon, plus 6 in `tests/rest.test.ts`),
typecheck clean, eslint clean, `scripts/doctor.sh` finds no traps, `make check-parity` confirms
`tests/criteria-parity.json` matches `../sincpro_framework`, `make build` produces `dist/`.
(`verify-format`'s own "formatting changed files" gate will still flag this session's
uncommitted files against `HEAD` — that's expected until the user commits; it is not a new
failure.)

## What changed this session, grouped

### 1. Vocabulary now matches the engine exactly (Python ⇄ JSON ⇄ TypeScript)

The engine's `Grouping.by`/`having`/`totals` were renamed to `group_by`/`where_measures`/
`measures` in **both** repos, because `by` and `having` said nothing on their own and
`totals` was outright wrong for `avg`/`min`/`max`. `aggregate` was rejected as a name because
`aggregate` already means the DDD root elsewhere in the engine (137 uses).

| Concept           | Method (TS)                         | Wire key              | Python attribute          |
| ----------------- | ----------------------------------- | --------------------- | ------------------------- |
| filter rows       | `.where(...)`                       | `where`               | `Criteria.where`          |
| order rows        | `.order(...)`                       | `order`               | `Criteria.order`          |
| page rows         | `.limit()` `.cursor()` `.offset()`  | `pagination`          | `Criteria.pagination`     |
| what to bring     | `.specification({...})`             | `specification`       | `Criteria.specification`  |
| split into groups | `.groupBy(...)`                     | `group_by`            | `Grouping.group_by`       |
| numbers per group | `.measures({name: measure.sum(f)})` | `measures`            | `Grouping.measures`       |
| filter the groups | `.whereMeasures(...)`               | `where_measures`      | `Grouping.where_measures` |
| order groups      | `.orderGroups(...)`                 | `order` (nested)      | `Grouping.order`          |
| page groups       | `.limitGroups()` `.offsetGroups()`  | `pagination` (nested) | `Grouping.pagination`     |

Groups have **no cursor** on purpose (a cursor names a row; a group is a number over many
rows, so ordering by a measure leaves nothing to resume past — counted with `offset` instead).

A condition is written as a **triple** — `["field", "operator", value]` — not as named helper
functions (`eq`, `gt`, `like`, …: all 13 were deleted). Structure is `where.all` / `where.any`
/ `where.negate`, one namespace. Verified with TypeScript's language service: the triple
autocompletes the field at position 1 and the operator at position 2, and a typo fails to
compile with "Did you mean...".

A measure is written the same way: `measure.sum(field)` / `.avg` / `.min` / `.max` / `.count`
/ `.countDistinct` / `.median` / `.percentile(field, fraction)` — one namespace, closed list
(the name reaches SQL). A level is positional: `.groupBy("kind", ["at", "month"])`.

### 2. Two new measures, in both engines

`count_distinct` and `percentile` (with an `argument` field only `percentile` may carry).
**SQLite cannot compute a percentile** and the SQL repository refuses it by name — before a
statement exists — rather than letting `percentile_cont` reach SQLite and fail as "no such
function" from somewhere unhelpful. Interpolates the same way in memory (Python and TS) and
in SQL, so a Feature tested without a database reads the same number it would against
Postgres.

### 3. The OpenAPI schema for paginated answers was a lie (Python side, already merged)

`ResponsePaginatedQuery` used a `model_serializer(mode="plain")`, which pydantic cannot
introspect — every paginated response published as `{"type": "object"}` in the OpenAPI
schema. Fixed with `__get_pydantic_json_schema__` so `mode="serialization"` matches
`mode="validation"`. This is what unblocks codegen for the client (a generated client can now
know the real shape of `cursor`/`count`/`model_meta_data`/`dropped`/the records).

### 4. A parity suite that runs the same cases through both engines

`ddd/evaluate.py` (Python, in-memory) and this package's `engine/evaluate.ts` (TypeScript) are
two independent implementations of the same filter language. Nothing stops them from
drifting — an operator whose meaning shifts, `NULL` handled differently, a list compared by
identity instead of by members. `tests/ddd/test_criteria_parity.py` in the framework repo
writes 25 cases (covering all 13 operators) to `tests/ddd/criteria-parity.json` (`make
criteria-parity` regenerates it); `tests/parity.test.ts` here reads a **copy** of that same
file (`tests/criteria-parity.json`, copied by hand — not currently automated, see below) and
proves this engine answers identically.

Naming note: the data file lives at `tests/criteria-parity.json`, right beside
`parity.test.ts` — not in a `fixtures/` directory. Two reasons: `fixtures/` at repo root is
for things that matter enough to see immediately, and `tests/fixtures.ts` already exists here
(the `Dataset`/`datasetMeta` test helper) — a `fixtures/` folder next to a `fixtures.ts` file
would be genuinely confusing about which is which.

### 5. `@sincpro/criteria/analysis` — a new addon, not core

Numbers worked out from what a reading already answered — no engine round-trip, no
permission, open (unlike measures, which are a closed list because the name reaches SQL):

- `derive(buckets, {name: fn})` plus `percentOfTotal`, `cumulative`, `changeFromPrevious`,
  `rank` — arithmetic over groups already in hand.
- `asSeries` / `asStackedSeries` — groups reshaped into `{categories, series}`, the shape
  every chart library asks for under different names. Imports no chart library.
- `fillGaps` — puts back the periods a grouping could not invent (a month with zero rows is
  an absence, not a group; only the caller knows the range it asked for).
- `asTable` — a pivot as a rectangle with no holes, margins and grand total included.

16 tests, each number checked against one computed by hand in the assertion.

### 6. Two real bugs found and fixed along the way

- `describeRows` (reads a model definition off plain rows with no schema) did not offer
  `is null` on columns some row leaves empty — a `negate(["field", "is null", true])` filter
  was silently dropped as "unsupported operator" and the reading quietly widened. Fixed;
  regression test in `tests/resource.test.ts`.
- The builder used to validate a measure only when the reading was sent, not when
  `.measures({...})` was called — a malformed measure surfaced far from the line that wrote
  it. Now validated at the call site.

### 7. Housekeeping

- Public surface trimmed: root export dropped from 90 → ~51 named values; the in-memory
  engine (sorting, cursors, folds, pivot maths) lives at the `@sincpro/criteria/engine`
  subpath so `import { ... } from "@sincpro/criteria"` autocompletes a door, not a machine
  room.
- `CriteriaFor<T>` added so a typed resource (`resource<Dataset>(...)`) still accepts an
  untyped `criteria()` — needed because `Criteria<T>` is invariant in `T` and a saved/loaded
  reading often has no static type.
- `resource(fn)` accepts the bare read function directly, not just `{read: fn}`.

## What is NOT done (roadmap, in the order I'd tackle it)

1. ~~**Automate copying `tests/criteria-parity.json` from the framework repo.**~~ **Done.**
   `make sync-parity` copies `../sincpro_framework/tests/ddd/criteria-parity.json` over this
   repo's copy (override the source with `FRAMEWORK_REPO=<path>`); `make check-parity` diffs
   the two and fails loudly on drift. Wired into `verify-format`, but it degrades to a no-op
   warning when the sibling checkout isn't present (e.g. in CI, or the published package),
   so it never breaks a build that doesn't have `sincpro_framework` beside it — it only
   catches drift for a dev with both repos checked out side by side, which is the normal case.
   This already found real drift: the framework repo had renamed its generator script
   (`test_parity_fixtures.py` → `test_criteria_parity.py`, visible in the fixture's own
   `"about"` field and in the framework `Makefile`'s `criteria-parity` target) after the last
   manual copy into this repo. Re-synced; `make test` still 252 passing after the refresh.
   Left as a `make` target rather than a cross-repo CI job — GitHub Actions would need an
   explicit checkout of `Sincpro-SRL/sincpro_framework` inside this repo's workflow to check
   this in CI, which touches the shared `Sincpro-SRL/.github` workflow contract and wasn't
   part of this pass.
2. **Transport addons.** `criteria-rest` is **done**: `@sincpro/criteria/rest` exports
   `restSource(baseUrl, options)`, a thin `fetch` wrapper around the `pack`/`pageFrom` codec
   that already lived in the core (that codec was already the whole hard part — see the
   `sincpro_criteria/index.ts` and `source.ts` docstring examples that predate this addon).
   `GET {baseUrl}?criteria=…` for a page. `group()` **reuses that same URL by default** — the
   criteria's own `grouping` is what asks for it, never a path this package infers. An earlier
   version of this addon defaulted `group()` to `{baseUrl}/groups`, generalizing from one
   observation (`sincpro_synthesis`'s router happens to route grouping separately) into an
   assumed convention applied to every consumer by default — corrected: that observation was
   real, but it was `sincpro_synthesis`'s routing choice to make, not this package's to bake
   in silently. `groupUrl` is now an explicit option for exactly that case, opt-in, never
   assumed. Other options: an injectable `fetch` (tests, interceptors), `headers` (static or a
   function, for a rotating token), the `AbortSignal` a `Source.read` already receives passed
   straight through. Throws `RestError` (status + body) on a non-2xx answer. No `pivot` — no
   backend anywhere has an endpoint convention for one yet, and guessing one would be a
   contract this package cannot keep. 7 tests in `tests/rest.test.ts`, all against an injected
   `fetch` stub, no network.

   `criteria-rpc` is **also done**: `@sincpro/criteria/rpc` exports
   `rpcSource(url, methods, options)` over the framework's JSON-RPC 2.0 entrypoint, verified
   against `sincpro_framework/entrypoints/rpc/jrpc.py` and `ddd/query.py` — every read `Query`
   carries exactly one field, `criteria`, so a call is `{jsonrpc: "2.0", method, params:
{criteria: plain(...)}}`, no packing (there's no URL to shorten). Method names
   (`{instance}.{layer}.{dto_name}`) are application-specific, so the caller supplies them
   rather than this package guessing. `RpcError` carries the JSON-RPC error object on both a
   transport failure and an `error` in the envelope. 6 tests in `tests/rpc.test.ts`. Batching
   (the framework's dispatcher already accepts a JSON array as one payload) is not wired up —
   nothing in this package currently has a reason to batch multiple reads into one round trip;
   left as a note for when a real caller needs it, not built ahead of that need.

   `criteria-live`'s **seam is done, its transport is not.** `Source.live?`, `LiveChannel` and
   `Reading.follow(debounceMs?)` all exist now (invalidation, not a diff stream — see
   `docs/DESIGN.md`), with `resource()` wired to forward `live` the same way it already
   forwards `group`/`pivot` (it wasn't, at first — a real bug this caught: `resolved` in
   `source/resource.ts` built a new `Source` object by hand and simply left `live` out).
   4 tests in `tests/live.test.ts` against a fake channel this test controls directly — no
   network, no `sincpro_framework` dependency, because the seam itself doesn't need one. What
   is still not started is a concrete transport binding (a real `Source` opening an actual
   `WebSocket`/`EventSource` against `sincpro_framework`), because that needs the protocol
   decision from that repo's side `docs/DESIGN.md` describes — the invalidation message shape
   and the channel it rides on aren't this package's call to make alone.

   **While grounding this against `sincpro_synthesis`, found a live bug, not a hypothetical
   one.** Its hand-written `shared/criteria.ts` (see #7 below) still sends grouping as
   `{"by": [...], "totals": {...}, "having": ...}` — the vocabulary this session retired.
   Checked empirically against the `sincpro_framework` 3.7.2 that `sincpro_synthesis` actually
   has installed (already carrying the `group_by`/`measures`/`where_measures` rename):
   `Criteria.model_validate_json` does not reject the old shape — pydantic silently drops the
   unknown keys and validates to `grouping=Grouping(group_by=(), measures={}, ...)`, an empty
   grouping. No error anywhere in the chain; every grouping request the catalog UI makes today
   most likely either 400s downstream (the engine refuses an empty `group_by`) or silently
   answers something that is not the grouping that was asked for — not confirmed which, since
   it would take running the app to see, but either way the catalog's group view is not
   answering what its own request claims to ask for. This is the concrete argument for doing
   #7 next, ahead of `criteria-rpc`/`criteria-live`: it is not "one more consumer to migrate
   eventually", it is the fix for a bug that exists right now.

3. **`criteria-react`**: **done** — `packages/criteria-react`, a separate package (needs
   `react` as a real dependency, see `docs/DESIGN.md`'s dependency test). `useReading`/
   `useBuckets` wrap `Reading`/`Buckets` — which were already plain `useSyncExternalStore`-
   shaped stores — via `useMemo`/`useEffect` for lifecycle, keyed by `pack(criteria)` so an
   inline criteria literal doesn't restart the reading every render. `queryKeyFor` is the
   other half: one line for a consumer that already has react-query/SWR, so it never needs
   `Reading` at all. 9 tests with `react-test-renderer` (no DOM/jsdom needed for hook-only
   tests). This restructured the repo into a yarn workspaces monorepo mid-session — see the
   note near the top of this file and `docs/DESIGN.md`'s "Repo layout".
4. **`criteria-grid`**: an ag-grid Server-Side Row Model adapter and a TanStack Table adapter.
   Not started.
5. **Codegen from OpenAPI/OpenRPC** — now unblocked by the schema fix (#3 above): a CLI that
   reads the engine's OpenAPI and emits typed `Fields<T>` unions and resource wrappers per
   model, so `criteria<Dataset>()` does not require someone to hand-write the `Dataset`
   interface.
6. **`criteria-offline`**: local cache + command queue, for mobile. Not started — this is
   also the point where `sincpro_mobile`'s own `ICriteria` (a flat, AND-only, no-order,
   no-pagination shape) would need to be retired in favor of this package.
7. **Migrate `sincpro_synthesis`'s frontend** off its hand-written `shared/criteria.ts` and
   onto this package plus `@sincpro/criteria/rest` (#2 above). **This moved up in priority
   mid-session** — it is not "a second implementation of the same grammar that still works",
   it is currently silently wrong for any grouping request (see #2). Not started yet. The
   shape of the change: `domains/catalog/api.ts`'s `listDatasets`/`groupDatasets` would build
   `Criteria<Dataset>` with `criteria()`/`.groupBy()`/`.measures()` instead of the hand-written
   `Criteria`/`Grouping` interfaces, and `packCriteria` would be dropped in favor of
   `restSource`. `Operator`/`isOperator`/`Fold` and the rest of the hand-rolled vocabulary in
   `shared/criteria.ts` go with it — this package's own closed unions replace them.
8. **DuckDB/Parquet adapter is proven in Python, not in this package.** The framework repo
   has `tests/orm/test_duckdb_parquet.py` showing the _same_ `Criteria` answered over a
   Parquet file via DuckDB (optional extra, `poetry install --extras duckdb`), including
   grain grouping, percentiles and `count_distinct`. Nothing analogous exists here yet for
   `duckdb-wasm` in the browser — that would be a new `Source`, not a core change.
9. **`Database(engine=...)`** — the framework's `Database` class always calls
   `create_engine()` itself; there is no way to hand it an already-constructed SQLAlchemy
   `Engine` (shared with Alembic, or a test fixture engine). Discussed, not implemented,
   because it is new public API on a published class and needs sign-off. Small change.

## Before opening the PR

```bash
git add -A   # there are two renamed files (engine/fold.ts → engine/measure.ts,
             # criteria/aggregate.ts → criteria/measure.ts) — `-A` lets git detect
             # them as renames instead of delete+add, which keeps the diff readable
make verify-format && make typecheck && make test && make build
```

The framework PR (`sincpro_framework` #105, already merged) should land first if this were
being opened fresh — this repo's vocabulary already assumes the merged names
(`group_by`/`measures`/`where_measures`), so it is not backward compatible with the
pre-#105 engine. Per explicit instruction from the user this session: no backward
compatibility was kept anywhere (no aliases for `by`/`having`/`totals`, no acceptance of the
old triple-string fold format) — every consumer of this package is on a version before this
work, so there was nothing to preserve compatibility with.

## The release pipeline was checked against the real thing, not assumed

Before trusting that `make publish`/`make update-version` would work at the root, read the
actual shared workflows this repo delegates to (`Sincpro-SRL/.github`, cloned locally at
`~/dev/.github`) instead of guessing. Found and fixed, in order:

1. The root `Makefile` had no `update-version` target at all — `03-release_draft.yaml` calls
   `make update-version VERSION=x` at the repo root on every push to `main`, so this would
   have failed the very next time that workflow ran. Added, fanning the one `VERSION` out to
   every package in `$(PACKAGES)` — lockstep, because that workflow computes exactly one
   version per release and has no notion of separate packages. This corrects what this file's
   own `docs/DESIGN.md` said earlier in the session (independent per-package versioning) —
   checked against the real pipeline, that turned out not to be true.
2. A live `make update-version VERSION=0.1.1` (then back to `0.1.0`) 404'd on the real npm
   registry for `@sincpro/criteria@0.1.0` — not a network fluke, reproduced twice. Root cause:
   `npm version` rebuilds its dependency tree as part of a bump, and `criteria-react` pinned
   its sibling as an exact-version `devDependency`, which went stale the instant
   `packages/criteria` bumped first (build order). Fixed with `--package-lock=false` (npm
   tries to sync a `package-lock.json` this repo doesn't have) and by loosening that
   `devDependency` to `"*"` (it only needs to resolve to whatever's in the workspace locally;
   the range that matters to a real consumer is `peerDependencies`, checked separately, later).
   Full writeup: `docs/DESIGN.md`'s "Releasing" section.

Re-verified end to end after both fixes: `make update-version VERSION=0.1.1` and back to
`0.1.0` both round-tripped clean, `make typecheck && make test && make lint && make doctor &&
make check-parity && make build` all still pass (268 + 9 tests, 0 fail).
