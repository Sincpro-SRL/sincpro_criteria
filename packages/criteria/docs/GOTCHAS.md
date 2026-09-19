# GOTCHAS — known traps

> Each entry is **symptom → cause → fix**. These are things that **already happened here** and
> that the typechecker does **not** catch. `make doctor` scans for every one of them, so a
> pull request finds them before a reviewer does.

---

## 🔴 A text column grouped by month, or a date filter that accepts anything

- **Symptom:** grouping `encoding` by `month` answers buckets labelled `2001`; a `datetime`
  field accepts `"utf-8"` as a valid value instead of dropping it.
- **Cause:** `Date.parse` is not a date check. In V8, `Date.parse("utf-8")` is the first of
  August 2001 and `Date.parse("3")` is March 2001. Anything that asks "is this a date?" by
  parsing it will quietly turn a text column into months.
- **Fix:** `readInstant` from `engine/temporal.ts`, which only reads a string written as
  ISO-8601 with the date part whole. Nothing else may call `Date.parse` — check 4 of the
  doctor enforces it.

## 🔴 A grained bucket that opens on nothing

- **Symptom:** a grouping by `registered_at:month` shows `2026-01` with 40 rows, and opening
  that bucket answers zero rows and a `dropped` saying `bad_value`.
- **Cause:** the bucket is labelled `"2026-01"` while the rows hold instants, so opening it on
  `registered_at = "2026-01"` matches nothing — and the label does not even read as a date.
- **Fix:** a grained level opens on a RANGE (`>= 2026-01-01 and < 2026-02-01`), read off the
  raw value while it is still an instant, not off the label. See `engine/group.ts`.

## One filter that will not compile, or a typo that does

- **Symptom:** `where.all(["a", "=", 1], ["b", "=", 2])` is refused with "Argument of type `"b"` is
  not assignable to parameter of type `"a"`"; or the other way round, a typo in a field name
  compiles against a typed builder.
- **Cause:** TypeScript runs `Fields<T>` backwards. From the string `"a"` it concludes
  `T = {a: any}`, and then every other field of the same filter is checked against the record
  it invented from the first one.
- **Fix:** every parameter that takes a field name is `NoInfer<Fields<T>>`, so `T` only ever
  comes from the builder that holds it or from an explicit type argument. Check 5 of the
  doctor enforces it.

## A typed criteria that does not fit where it obviously should

- **Symptom:** `datasets.read(criteria())` is refused, although `datasets` is a resource over
  `Dataset` and `criteria()` is a criteria over nothing in particular.
- **Cause:** a criteria carries its field names in its type, which makes it **invariant**:
  `Criteria<Dataset>` and `Criteria<AnyRecord>` are not assignable in either direction.
- **Fix:** public entry points that already know their record type take `CriteriaFor<T>`,
  which is the union of both. Field names were already checked where the criteria was built.

## The package grows a dependency by accident

- **Symptom:** it stops working in React Native, or in a worker, or in plain Node.
- **Cause:** something reached for `fetch`, `localStorage`, a `node:` builtin or React. The
  core answers criteria; where rows come from is a `Source` the caller writes.
- **Fix:** keep it out. Check 1 of the doctor scans for it. A transport, a cache or a
  framework binding is a separate package.

## An import that breaks only in the published package

- **Symptom:** the tests pass, and `dist` fails to resolve a module.
- **Cause:** an import written relatively, or with a `.ts` extension. The source names itself
  `@sincpro/criteria/...`, and `tsc-alias` rewrites that to a relative path with `.js` on
  build; anything else is emitted as it was written.
- **Fix:** always import through the alias. Checks 2 and 3 of the doctor enforce it, and
  `make build` is what proves it.
