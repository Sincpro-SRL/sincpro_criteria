# Working in this repository

`@sincpro/criteria` is the read grammar of the Sincpro engine, in TypeScript, and the
machinery that drives it. It mirrors `sincpro_framework/ddd/` — `criteria.py`, `pagination.py`,
`model_meta.py`, `evaluate.py` and `memory_repository.py`. Nothing here talks to a network,
renders anything, or depends on a package.

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
   of tests. A transport, a cache or a framework binding is a separate package.
2. **One spelling per idea.** A condition is `{field, operator, value}`; a group is `{all}`,
   `{any}` or `{negate}`. Convenience functions (`eq`, `all`, the builder) must produce
   exactly that and never a second wire form.
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
  .where(eq("encoding", "utf-8"), gt("row_count", 1000)) // AND, accumulating
  .order("-registered_at") // replaces; `-` is descending
  .limit(100) // one page
  .resumingFrom(previous.cursor) // the next one
  .by("encoding") // one grouping level, then another
  .totals({ rows: ["sum", "row_count"] })
  .specification({ name: {}, runs: { pagination: { limit: 20 } } });
```

- Read the operators a field takes from `model_meta_data`, never from a list kept by hand.
- Never order by a field whose `sortable` is false.
- Never filter by a relational field: filter by its `identified_by`, which is a scalar field
  of the same model.
- To open a bucket, send `bucket.criteria` unchanged.
