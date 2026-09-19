# Working in this package

This is `packages/criteria` in a monorepo — see the repo root's `docs/DESIGN.md` for how the
other packages (`criteria-react`, …) relate to this one. `@sincpro/criteria` is the read
grammar of the Sincpro engine, in TypeScript, and the machinery that drives it. It mirrors
`sincpro_framework/ddd/` — `criteria.py`, `pagination.py`, `model_meta.py`, `evaluate.py` and
`memory_repository.py`. Nothing here talks to a network, renders anything, or depends on a
package.

The layout says what each part is:

| Folder      | What lives there                                                                |
| ----------- | ------------------------------------------------------------------------------- |
| `criteria/` | the grammar, the builder, the merge law, the URL packing                        |
| `meta/`     | the model definition, and what can be asked of it                               |
| `page/`     | the answer: envelope, count, dropped, buckets, pivot                            |
| `engine/`   | the same read answered over rows in hand: evaluate, sort, page, group, pivot    |
| `reading/`  | the live objects: a reading, a level of buckets, the store they publish through |
| `source/`   | the one seam to the outside, and the resource hanging off it                    |

## The rules that are not negotiable

1. **The core imports nothing.** No `fetch`, no `axios`, no React, no Node built-ins outside
   of tests. The cut for anything else — a transport, a cache, a framework binding — is not
   "is this transport-shaped", it is **does it need a real dependency**:
   - Needs none beyond an ambient global (`fetch`, `AbortController`) → a subpath of this
     package, same as `@sincpro/criteria/analysis` or `@sincpro/criteria/rest`. Nobody who
     does not import that subpath pays anything for it — no line in anyone's `package.json`.
   - Needs an actual package (`react`, `react-query`, `axios`, a WS client, `expo-sqlite`) →
     a **separate package** (`@sincpro/criteria-react`, …), even if it is a thin wrapper. That
     dependency must never appear in this package's own `package.json`, or everyone who
     installs `@sincpro/criteria` for `Criteria`/`Source` alone inherits it for nothing.
     See [`docs/DESIGN.md`](../../docs/DESIGN.md) (repo root — it spans every package in this
     monorepo) for where each addon in flight lands on this line.
2. **One spelling per idea.** A condition is written as a triple and travels as
   `{field, operator, value}`; a group is `{all}`, `{any}` or `{negate}`. Sugar is read into
   that before it leaves, and never becomes a second WIRE form. There is no second name for
   an operator either: what `ops` publishes is what is written.
3. **The law of `merge` is the engine's law.** If it changes here, it changed there first.
   The cursor is never carried through a merge.
4. **What cannot be answered is dropped and reported, never thrown** — except where the
   engine itself refuses, which `validate` reports as `refused`.
5. **Typing is opt-in.** `criteria()` works with no type; `criteria<Dataset>()` checks field
   names. Every parameter that takes a field name is wrapped in `NoInfer`, or TypeScript runs
   the type backwards and invents a record out of the first field name it sees. A public
   entry point that already has its record type from somewhere else takes `CriteriaFor<T>`, so
   an untyped criteria still fits.
6. **The engine agrees with the database.** `matches` answers what SQL answers, including
   where SQL is odd, and a cursor minted here reads there. Anything that changes an operator's
   meaning needs the reason written down and a test both sides would pass.
7. **No guessing with dates.** `Date.parse("utf-8")` is a day in 2001. Use `readInstant`.
8. **English, everywhere.** Identifiers, comments, docs, commit messages.

## Docstrings

Every exported symbol carries a JSDoc block. It says _why_ the thing is the way it is, not
what the signature already says, and carries an `@example` when the shape is not obvious.
Comments explain decisions; git holds the history, so nothing here describes what something
used to be.

## Before opening a pull request

```bash
make verify-format   # eslint --fix + prettier + doctor; fails if anything changed
make typecheck       # also enforces the @ts-expect-error contract in tests/types.test.ts
make test
```

`make doctor` scans for the traps `tsc` does not catch — the ones in
[docs/GOTCHAS.md](docs/GOTCHAS.md). `pre-commit install` (which `make init` does) runs
`make verify-format` on every commit, so all of it happens before the push.

A change to the grammar or to a law needs a test that would fail without it, and a line in
the README if it changes what a caller writes.

## Writing a criteria (for an agent generating one)

```ts
criteria<Dataset>()
  .where(
    ["encoding", "=", "utf-8"], // a condition is a triple; arguments are ANDed
    ["row_count", ">", 1000],
    where.any(["tags", "contains", "raw"], ["producer_id", "is null", true]),
    where.negate(["name", "like", "draft"]),
  )
  .order("-registered_at", "name") // replaces; `-` is descending
  .limit(100) // one page
  .cursor(previous.cursor) // the next one
  .groupBy("encoding") // one grouping level, then another
  .measures({ rows: measure.sum("row_count") })
  .whereMeasures(["rows", ">", 1000]) // reads what measures declared, plus `count`
  .specification({ name: {}, runs: { pagination: { limit: 20 } } });
```

- Read the operators a field takes from `model_meta_data`, never from a list kept by hand.
- The root export is the door; the engine that answers a criteria over rows in hand is
  `@sincpro/criteria/engine`, and nothing from it belongs in the root.
- Never order by a field whose `sortable` is false.
- Never filter by a relational field: filter by its `identified_by`, which is a scalar field
  of the same model.
- To open a bucket, send `bucket.criteria` unchanged.
