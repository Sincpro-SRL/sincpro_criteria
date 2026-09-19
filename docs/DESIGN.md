# Design — the standard, and where it stops being this package's job

This is permanent documentation, unlike `packages/criteria/docs/STATUS.md` (a disposable
session handoff). It lives at the repo root, not inside a package, because it spans every
package this monorepo holds — `packages/criteria` today, `packages/criteria-react` and
whatever follows it. It answers two questions that come up every time a new way to use
`Criteria<T>` shows up: _does this belong in the core, in a subpath of a package, or in a
separate package?_ and _how does "live" fit a grammar built around pull and a cursor?_

## Repo layout

```
packages/
  criteria/        @sincpro/criteria — the grammar, the in-memory engine, the seam, plus the
                   zero-dependency addons (analysis, rest) as subpaths. See its own AGENTS.md.
  criteria-react/  @sincpro/criteria-react — react peer dep, see below.
```

**Versioning is lockstep, not independent — a constraint, not a preference.** The intent when
this repo became a monorepo was that an addon would only need a new release when its own code
changed. Checked against the actual shared pipeline (`Sincpro-SRL/.github`, cloned locally at
`~/dev/.github` for anyone verifying this): `03-release_draft.yaml` computes exactly one
version from the GitHub release tag and calls `make update-version VERSION=x` **once, at the
repo root** — it has no notion of separate packages. The root `Makefile` fans that one call out
to every package in `$(PACKAGES)`, so every release bumps and republishes all of them, whether
or not a given package's code changed. See "Releasing" below for what that took to get right.

`@sincpro/criteria` is pre-1.0, which matters here too: a `^0.y.z` peer dependency range only
matches that exact minor, unlike `^x.y.z` for `x ≥ 1` — worth moving the core to `1.0.0` once
its vocabulary is considered settled, so `criteria-react`'s `peerDependencies` range stops
needing a bump on every compatible core release (this does not affect the lockstep constraint
above — that is about the release pipeline, not semver ranges).

## Releasing

Two things broke on the first real dry run of `make update-version` after the monorepo split,
both from the same root cause: `npm version` and `npm publish`, unlike this repo's own
`yarn install`, do not know how to read `yarn.lock` or follow yarn's workspace symlinks —
they fall back to asking the real npm registry, which 404s for a package this monorepo has not
published yet.

1. **`npm version` rebuilds its dependency tree as part of a bump** (v7+), which means
   resolving every dependency — including a sibling workspace package — against the registry.
   Fixed with `--package-lock=false` in both packages' `update-version` targets; harmless here
   since this repo has no `package-lock.json` to keep in sync in the first place (`yarn.lock`
   is the one lockfile).
2. **A workspace-internal `devDependency` pinned to an exact version goes stale the moment its
   sibling bumps.** `criteria-react`'s `package.json` had `"@sincpro/criteria": "0.1.0"` in
   `devDependencies` — once the root `update-version` bumped `packages/criteria` to `0.1.1`
   first (dependency order), that exact pin no longer matched what was actually in the
   workspace, and npm went looking for the now-nonexistent `0.1.0` on the registry instead of
   using the local sibling. Fixed by loosening it to `"*"` — this entry only exists so
   `criteria-react` can build/test against its sibling locally; the version that actually
   matters to a real external consumer is the `peerDependencies` range (`^0.1.0`), checked at
   a different time (that consumer's own install), against packages that are, by then, already
   published at consistent versions.

Both were reproduced and fixed against a real `make update-version VERSION=0.1.1` /
`VERSION=0.1.0` round trip, not just reasoned about — see `packages/criteria/Makefile` and
`packages/criteria-react/Makefile`'s `update-version` targets for the comments in place.

Order is guaranteed by `$(PACKAGES)` in the root `Makefile` — `packages/criteria` before
`packages/criteria-react` — for `update-version`, `build`, `test`, `typecheck` and `publish`
alike, so a dependent package always builds and publishes against its already-updated sibling.

## The core is a complete, standalone API

`Criteria`, `Source`, `Reading`, `Buckets`, `resource`, the in-memory `evaluate` engine,
`pack`/`unpack`/`pageFrom` — none of it needs an addon. A consumer with no interest in React,
REST, or any specific transport can build a `Source` by hand in five lines and get paging,
grouping, a live reading with cancellation-safe search, and an in-memory filter engine, with
zero dependencies. Every addon below is convenience for a specific ecosystem, never a missing
piece of the core — if using this package _requires_ installing an addon to do something the
README describes as core behavior, that is a bug in the addon's design, not a reason to weaken
the core.

## Where a new addon lands: the dependency test, not the transport test

It is tempting to sort addons by "is this a transport" — `criteria-rest`, `criteria-rpc`,
`criteria-live` all sound alike, so it looks like they should all live the same way. They
don't. The line is **does it need a real dependency**:

| Addon                                               | Needs                                                                                        | Lands as                                                                                                                  |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `@sincpro/criteria/rest` (done)                     | `fetch` (ambient global)                                                                     | subpath, this package                                                                                                     |
| `@sincpro/criteria/analysis` (done)                 | nothing                                                                                      | subpath, this package                                                                                                     |
| `criteria-rest-axios`                               | `axios`                                                                                      | recipe in the README, not shipped code, unless real demand justifies a separate package later                             |
| `@sincpro/criteria-react`                           | `react`, optionally `@tanstack/react-query` as a peer                                        | **separate package**                                                                                                      |
| `@sincpro/criteria-offline`                         | a storage engine (`expo-sqlite`, IndexedDB, …)                                               | **separate package**, likely more than one (the storage engine is platform-specific)                                      |
| `@sincpro/criteria-grid`                            | `ag-grid`/`@tanstack/table` types                                                            | **separate package**                                                                                                      |
| `criteria-rpc` against the framework's own JSON-RPC | nothing beyond `fetch` (ambient)                                                             | **done** — subpath, this package                                                                                          |
| `criteria-live` (see below)                         | nothing in the core seam; the transport binding (a `WebSocket`, an `EventSource`) is ambient | subpath for the seam, separate package only if a specific client library (socket.io, etc.) is chosen over the ambient one |

Reading the table: an addon written _against a Sincpro-owned protocol_ (the framework's own
REST envelope, its own JSON-RPC, its own live channel) tends to need nothing but an ambient
API, so it tends to be a subpath. An addon written for _someone else's ecosystem_ (React, a
specific HTTP client, a specific storage engine) needs a real dependency, so it is always a
separate package — this is also why an Odoo adapter for `sincpro_mobile_odoo` is not a
`@sincpro/criteria` addon at all: Odoo is a third party with its own domain notation, and that
translation belongs in the consumer repo, built against this package's exported types.

`axios` is the concrete case that motivated writing this down: `Source.read` does not care
which HTTP client fetched the page, so an axios version of `restSource` is a five-line rewrite
of the fetch one. Shipping it as a dependency-bearing addon would put `axios` one hop away from
every installer of this package for a convenience anyone can copy-paste. It stays a README
recipe until real, repeated demand says otherwise.

## Real time: invalidate, don't stream diffs

**The seam below is implemented** — `Source.live?`, `LiveChannel`, `Reading.follow()` all
exist in `packages/criteria` now, tested against a fake channel
(`packages/criteria/tests/live.test.ts`). What is **not** implemented, and still needs the
cross-repo decision this section asks for, is a concrete transport binding — a real `Source`
that opens an actual `WebSocket`/`EventSource` against `sincpro_framework`. Until that protocol
is agreed, `live` only has test doubles to talk to.

A `Reading` is a cursor over an ordering — paginated, stable, resumable. Streaming row-level
diffs (insert/update/delete) into it means deciding what a delete does to a page that already
rendered, and what an insert does to every cursor after it — that is not a transport detail,
it is building a replica, and it is not what any consumer surveyed so far actually needed.

What every case actually needed was **invalidation**: something changed, this reading might be
stale, ask again. That reuses `Reading` exactly as it stands — the race handling, the abort on
a newer request, the stale-response drop are already there for `refine()`; invalidation is
just another caller of the same path.

The extension point is a capability on `Source`, the same shape as the existing optional
`group`/`pivot`:

```ts
interface Source<T> {
  read(criteria: Criteria<T>, signal?: AbortSignal): Awaitable<Page<T>>;
  group?(criteria: Criteria<T>, signal?: AbortSignal): Awaitable<Page<Bucket<T>>>;
  pivot?(criteria: Criteria<T>, axes: Axes<T>, signal?: AbortSignal): Awaitable<Pivot>;

  /**
   * Optional: a channel that says "this reading may be stale now" — never rows. `read()`
   * stays the one source of truth, so nothing arriving live can ever disagree with a pull
   * about what a row looks like.
   */
  live?(criteria: Criteria<T>): Awaitable<LiveChannel>;
}

interface LiveChannel {
  onInvalidate(fn: () => void): () => void; // returns an unsubscribe
  close(): void;
}
```

`Reading` would gain an opt-in `follow()`: open the channel, call `reload()` on invalidation,
debounced so ten changes in a row cause one refetch and not ten. Nothing about `LiveChannel`
names a transport — a `WebSocket`, an `EventSource`, a Postgres `LISTEN/NOTIFY` forwarded
through anything, or a consumer's own event bus (`sincpro_mobile`'s `mitt`-based one already
does the equivalent job locally) can all implement it. Nobody is forced onto WebSockets to get
this, and nobody who already solved live updates their own way has to adopt it.

**Not this package's decision alone.** The thing that emits an invalidation is
`sincpro_framework` (Python) — the message shape (per aggregate? per criteria? what counts as
"reason") and the channel it rides on are a cross-repo protocol question, the same way the
wire envelope (`pack`/`pageFrom`) is defined in Python and mirrored here. This section is the
proposal to bring to that repo, not a shipped feature yet.

## What this means for the roadmap in `packages/criteria/docs/STATUS.md`

- `criteria-react`: **done** — `packages/criteria-react`, `@sincpro/criteria-react`. Both
  halves predicted here shipped: `useReading`/`useBuckets` (a `Reading`/`Buckets`-backed hook
  via `useSyncExternalStore`) for a consumer with no query cache of its own, and `queryKeyFor`
  (`pack(plain(criteria))` under a caller-chosen prefix) for a consumer that already has one —
  `sincpro_synthesis` is squarely the second case, and does not need the first. Tested with
  `react-test-renderer` (no DOM/jsdom needed for hook-only tests). Not yet used anywhere —
  wiring it into `sincpro_synthesis` is still roadmap #7 in `packages/criteria/docs/STATUS.md`.
- `criteria-offline`: a **separate package** per storage engine, not one package with
  conditional imports — `expo-sqlite` and a browser's IndexedDB do not share a dependency
  surface, and this package still promises zero dependencies.
- The Odoo adapter mobile needs stays in `sincpro_mobile_odoo`, built against this package's
  `Criteria`/`Expression`/`Source` types — not a `@sincpro/criteria` addon.
