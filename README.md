# @sincpro/criteria

The read grammar of the Sincpro engine, in TypeScript, and the machinery that drives it. One
object says what to bring — the filter, the ordering, the page, what to expand, how to group —
and the answer says what the model is, so a client never carries a schema of its own.

**No transport, no framework, no dependencies.** Where the rows come from is one function you
write; everything else is here.

```bash
npm install @sincpro/criteria
```

## Quick start

```ts
import { criteria, eq, gt, pageFrom, pack, resource } from "@sincpro/criteria";

// The only thing that touches the outside world.
const datasets = resource<Dataset>({
  read: async (written) =>
    pageFrom(await fetch(`/datasets?criteria=${pack(written)}`).then((r) => r.json())),
});

const reading = datasets.read(
  criteria<Dataset>()
    .where(eq("encoding", "utf-8"), gt("row_count", 1000))
    .order("-registered_at")
    .limit(100),
);

await reading.load();
await reading.more(); // infinite scroll — the cursor never appears in your code

reading.rows;
reading.count; // {value: 197, exact: true}
reading.meta; // what may be filtered, ordered and grouped
reading.dropped; // what the model could not answer, and why
reading.hasMore;
```

Rows already in hand are a source too, with nothing to write:

```ts
import { fromRows, resource } from "@sincpro/criteria";

const datasets = resource(fromRows(rows)); // filter, sort, page, group and pivot, in memory
```

## What this knows

### The grammar, and only one spelling of it

A condition is `{field, operator, value}`; a group is `{all}`, `{any}` or `{negate}`. The
operator never travels glued to the field name, so no language talking to this API has to
split a string to read a filter.

```ts
all(like("name", "labs"), any(eq("encoding", "utf-8"), isNull("producer_id")));
```

The builder is the same grammar without writing the object by hand, and it is immutable —
which is what lets a screen keep one base criteria and derive from it on every keystroke.
`q.value` is the plain object; it travels in a URL, a POST body or a queue message unchanged.

### The law for merging two of them

A saved reading, what the user typed and what a permission imposes are three criteria over the
same rows. `merge` is total, so they never disagree quietly:

| Part                              | Law                                                                                   |
| --------------------------------- | ------------------------------------------------------------------------------------- |
| `where`                           | AND — both restrictions hold                                                          |
| `specification`                   | intersection — a mask can only take away, which is what makes it safe as a permission |
| `order`, `pagination`, `grouping` | the more specific one replaces                                                        |
| `count`, `meta`                   | the more specific one replaces; `meta` ANDs, so `meta: false` can be said at all      |
| the cursor                        | **never carried over** — it belongs to one ordering over one filter                   |

### What the model says about itself

Every answer carries `model_meta_data` unless the criteria turned it off. A filter form, a
column menu and a search box are built from it, so a client can never ask for a field it was
not shown:

```ts
fieldsThatFilter(meta); // what a filter may name
fieldsThatSort(meta); // never a nullable column: a page ordered by one loses rows
operatorsFor(meta, "row_count"); // ["=", "!=", "<", "<=", ">", ">=", "between", "in", "not in"]
labelOf(meta, "row_count", "es"); // "Filas"
searchOver(meta, typed); // `like` over every text field the model says takes it
```

When the rows came from somewhere that says nothing about them, `describeRows(rows)` reads a
definition off the rows themselves.

### What the engine would answer, checked before sending

```ts
const { criteria: checked, dropped, refused } = validate(q, meta);
```

- **dropped** — the condition disappears and the read still runs. An unknown field, an
  operator a type does not take, a value that will not read. A dropped filter always _widens_
  the result, so saying it out loud is enough — and a shared link outlives the schema it was
  written against.
- **refused** — the whole request would fail. Ordering by a nullable column is the one that
  matters: a page ordered by one silently loses the rows that hold no value. A menu can grey
  the entry out instead of finding out later.

### The read itself, over rows in hand

`answer(rows, criteria, meta)` filters, sorts, pages and counts exactly as the engine does,
with the same keyset cursor — `matches` agrees with SQL including where SQL is odd, `NULL`
compares to nothing, and a token minted here can be read there.

## Where rows come from

The whole seam between this package and the outside world is one function:

```ts
interface Source<T> {
  read(criteria: Criteria<T>, signal?: AbortSignal): Awaitable<Page<T>>;
  group?(criteria: Criteria<T>, signal?: AbortSignal): Awaitable<Page<Bucket<T>>>;
  pivot?(criteria: Criteria<T>, axes: Axes<T>, signal?: AbortSignal): Awaitable<Pivot>;
}
```

`pageFrom(answer)` turns whatever the server sent into the `Page` everything else reads, so a
REST adapter is one line and a JSON-RPC one is another. `group` and `pivot` are optional: a
source without them says so, and `resource(source, { groupLocally: true })` will read the
matching rows and group them here instead — opt-in, because a screen that quietly downloads a
table is worse than one that says the source cannot group.

## A reading

The rules that are easy to get wrong live in one place:

- the definition is asked for on the first page and not on the rest;
- an answer that arrives after a newer one was asked for is dropped — the race every search
  box loses — and the request in flight is aborted;
- refining drops the cursor, because it belongs to one ordering over one filter;
- a first page resumed from a cursor the server refuses is read again from the beginning,
  since a criteria that came back from a URL outlives the ordering it was written under;
- `dropped` is a warning, never a failure.

```ts
const reading = datasets.read(base);
await reading.load();
await reading.more();
await reading.refine(base.where(searchOver(reading.meta!, typed)));
await reading.reload();

reading.subscribe(() => render()); // headless: React, Vue, Svelte, or nothing
reading.snapshot(); // the same object until something changes
```

To walk everything, no cursor appears at all:

```ts
for await (const dataset of datasets.all(
  criteria<Dataset>().where(eq("encoding", "utf-8")),
)) {
  // one page at a time, under the hood
}
```

## Grouping

One statement per level, and every bucket carries **the criteria that opens it** — no client
rebuilds a filter it did not write:

```ts
const tree = datasets.group(
  criteria<Dataset>()
    .by("encoding")
    .totals({ rows: ["sum", "row_count"] })
    .having(gt("count", 10)),
);
await tree.load();

const rows = tree.open(tree.buckets[0]); // the bucket's rows, as a reading
const months = tree.drill(tree.buckets[0], { field: "registered_at", grain: "month" });
```

A grained level is labelled the way the engine labels it — `"2026-01"` — and opens on a range,
because the rows hold instants and the label holds a month. With an explicit page on the
criteria, every bucket also carries the `ids` and `cursor` of its own first page.

`pivot` crosses two axes and folds the cells, with margins folded from the rows rather than
added up from the cells: an average of averages is not an average.

## Reading it out loud

```ts
explain(q, { meta, locale: "es" });
// 'Conjuntos, where Codificación = "utf-8" and Filas > 1000, by Registrado ↓, 100 per page'
```

A read that can be printed is a read that can be logged, diffed in a test, shown in a "what am
I looking at" bar, and understood by an agent that did not build it.

## Typing is opt-in

`criteria()` asks nothing of a caller that has no generated type yet: field names are plain
strings. `criteria<Dataset>()` checks every field name in the filter, the ordering, the
grouping levels and the mask. The two mix freely — a resource over `Dataset` takes either.

## Development

```bash
make init           # install
make test           # node --test over the TypeScript sources
make typecheck      # tsc --noEmit, which also checks the @ts-expect-error contract in tests
make verify-format  # eslint --fix + prettier + doctor, and fails if anything changed
make doctor         # the traps tsc does not catch — see docs/GOTCHAS.md
make build          # dist/ (JS + .d.ts)
```

## License

MIT © Sincpro SRL
