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
import { criteria, pack, pageFrom, resource } from "@sincpro/criteria";

// The only thing that touches the outside world: one function.
const datasets = resource<Dataset>(async (q) =>
  pageFrom(await fetch(`/datasets?criteria=${pack(q)}`).then((r) => r.json())),
);

const reading = datasets.read(
  criteria<Dataset>()
    .where(["encoding", "=", "utf-8"], ["row_count", ">", 1000])
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

### A filter that reads left to right

A condition is written as a triple — field, operator, value — and nothing is imported to
write one. The editor offers the fields at the first position and the operators at the second,
and a typo is a compile error naming the field you meant.

```ts
import { where } from "@sincpro/criteria";

.where(
  ["encoding", "=", "utf-8"],
  ["row_count", ">", 1000],
  where.any(["tags", "contains", "raw"], ["producer_id", "is null", true]),
  where.negate(["name", "like", "draft"]),
)
```

Arguments are ANDed. Structure is three functions under one name — `where.all`, `where.any`,
`where.negate` — and they are functions because they hold the rule about what is empty: **an
`any` with no parts matches nothing and an `all` with no parts matches everything**, so a row
of chips that are all switched off has to disappear rather than turn into its opposite.

The operators are the symbols the model definition publishes in `ops`, so what a filter widget
reads and what you write are the same vocabulary — there is no table translating `gt` to `>`
anywhere.

**The triple never travels.** It is read into `{field, operator, value}` before it leaves, so
the wire, a saved reading and `model_meta_data` all keep saying the same thing. `q.value` is
that plain object; it goes in a URL, a POST body or a queue message unchanged.

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

A permission the server hands out, and a filter the user typed, in the shape they actually
take — `where.any`/`where.negate` included — merged into the one criteria that goes out:

```ts
// The server's rule — the user never sees or edits this.
const permission = criteria<Account>().where(
  where.any(["region", "=", "north"], ["owner", "=", currentUser]),
);

// What the user typed into a search box.
const typed = criteria<Account>().where(
  ["kind", "=", "asset"],
  where.negate(["region", "=", "south"]),
);

const asked = merge(plain(permission), plain(typed));
// { where: { all: [
//   { any: [{ field: "region", operator: "=", value: "north" }, { field: "owner", operator: "=", value: "ana" }] },
//   { field: "kind", operator: "=", value: "asset" },
//   { negate: { field: "region", operator: "=", value: "south" } },
// ] } }
```

`asked` is what actually goes to `read()` — the user's filter narrows the permission, it can
never widen past it, because `merge`'s law for `where` is always AND.

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

`matches(row, filter)` and `filtered(rows, filter)` answer the same filter over rows already
in hand, and agree with SQL including where SQL is odd: `NULL` compares to nothing, two lists
are compared by their members. The rest of the machine — sorting, keyset cursors, folds,
pivots — is `@sincpro/criteria/engine`, and a token minted there can be read by the server.

## Where rows come from

The whole seam between this package and the outside world is one function:

```ts
interface Source<T> {
  read(criteria: Criteria<T>, signal?: AbortSignal): Awaitable<Page<T>>;
  group?(criteria: Criteria<T>, signal?: AbortSignal): Awaitable<Page<Bucket<T>>>;
  pivot?(criteria: Criteria<T>, axes: Axes<T>, signal?: AbortSignal): Awaitable<Pivot>;
}
```

A source that only reads is written as the bare function: `resource(async (q) => …)`.

`pageFrom(answer)` turns whatever the server sent into the `Page` everything else reads, so a
REST adapter is one line and a JSON-RPC one is another. `group` and `pivot` are optional: a
source without them says so, and `resource(source, { groupLocally: true })` will read the
matching rows and group them here instead — opt-in, because a screen that quietly downloads a
table is worse than one that says the source cannot group.

`@sincpro/criteria/rest` writes that one line for the common case — `GET {baseUrl}?criteria=…`.
`group()` reuses that same URL by default: the criteria's own `grouping` is what asks for it,
not a path this package would otherwise have to guess. Pass `groupUrl` only when a backend
genuinely answers grouping at a different endpoint (some do — that is the backend's routing
choice to declare, never this package's to assume):

```ts
import { restSource } from "@sincpro/criteria/rest";

const datasets = resource<Dataset>(
  restSource("/datasets", {
    headers: () => ({ Authorization: `Bearer ${token()}` }),
    // groupUrl: "/datasets/groups",  // only if that backend actually routes it separately
  }),
);
```

A non-2xx answer throws `RestError` with the status and the body. There is no `pivot`: no
endpoint anywhere follows a convention for one yet.

`@sincpro/criteria/rpc` does the same over the framework's own JSON-RPC 2.0 entrypoint — every
read `Query` there carries one field, `criteria`, so a method call is `{criteria: plain(...)}`
in `params`, no packing needed (there is no URL length to save):

```ts
import { rpcSource } from "@sincpro/criteria/rpc";

const datasets = resource<Dataset>(
  rpcSource("/rpc", {
    read: "catalog.query.ListDatasets",
    group: "catalog.query.GroupDatasets",
  }),
);
```

A transport failure or a JSON-RPC `error` in the envelope both throw `RpcError`, carrying the
JSON-RPC error object (`code`, `message`, `data`). The method names are application-specific —
`{instance}.{layer}.{dto_name}` — so this asks for them rather than guessing.

**`where.any`/`where.negate`, a saved reading, a permission merged with what the user typed —
none of it is transport-specific.** Both `restSource` and `rpcSource` send whatever `Criteria<T>`
they are handed through `pack`/`plain`; the criteria from "The law for merging two of them"
above travels identically whether `read()` ends up calling `restSource` or `rpcSource` — the
addon does not know or care how the `where` tree is shaped.

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

When a source answers `live` — a channel that says "this may be stale", never rows, see
`docs/DESIGN.md` at the repo root for why — a reading can keep itself current:

```ts
const stop = reading.follow(); // reloads on invalidation, debounced
// later
stop(); // closes the channel
```

`follow()` throws when the source has no `live`: there is nothing to invalidate the reading.

To walk everything, no cursor appears at all:

```ts
for await (const dataset of datasets.all(
  criteria<Dataset>().where(["encoding", "=", "utf-8"]),
)) {
  // one page at a time, under the hood
}
```

## Grouping

Five verbs, and each one says which of the two things it is about — the rows, or the groups
the rows made:

| Verb                                        | What it is about                                                   |
| ------------------------------------------- | ------------------------------------------------------------------ |
| `.order(…)`, `.limit(n)`                    | the ROWS; grouping, they decide which rows each bucket shows first |
| `.groupBy(…)`                               | how the set is split, one level at a time                          |
| `.measures({ name: measure.sum("field") })` | the numbers every bucket answers, each under a name of yours       |
| `.whereMeasures(…)`                         | filters the GROUPS by those numbers, plus `count`                  |
| `.orderGroups(…)`, `.limitGroups(n)`        | the order and the page of the GROUPS                               |

The measures are a closed list, because the name reaches SQL: anything outside it is refused
before a statement exists.

|                                                             |                                                                                                                                                                                              |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `measure.sum` `avg` `min` `max`                             | over the values that are there; an empty one is left out, not counted as zero                                                                                                                |
| `measure.count(field)`                                      | how many rows hold a value in it — every bucket answers `count` for its rows without being asked                                                                                             |
| `measure.countDistinct(field)`                              | how many DIFFERENT values — "how many customers", not how many rows                                                                                                                          |
| `measure.percentile(field, 0.95)` · `measure.median(field)` | the value at a fraction of the sorted ones, interpolating. **Not every engine computes it**: SQLite has none, and the repository refuses it by name instead of letting it reach the database |

What is open is where the rows come from, what each model publishes it can be asked, and
everything worked out from the answer — see below.

One statement per level, and every bucket carries **the criteria that opens it** — no client
rebuilds a filter it did not write:

```ts
const tree = datasets.group(
  criteria<Dataset>()
    .groupBy("encoding")
    .measures({ rows: measure.sum("row_count") })
    .whereMeasures(["count", ">", 10]),
);
await tree.load();

const rows = tree.open(tree.buckets[0]); // the bucket's rows, as a reading
const months = tree.drill(tree.buckets[0], ["registered_at", "month"]);
```

A grained level is labelled the way the engine labels it — `"2026-01"` — and opens on a range,
because the rows hold instants and the label holds a month. With an explicit page on the
criteria, every bucket also carries the `ids` and `cursor` of its own first page.

`pivot` crosses two axes and folds the cells, with margins folded from the rows rather than
added up from the cells: an average of averages is not an average.

### The two orders and the two pages

A criteria carries **two of each**, and the nesting says which is which:

|               | the rows                        | the groups              |
| ------------- | ------------------------------- | ----------------------- |
| how many      | `.limit(n)`                     | `.limitGroups(n)`       |
| from where    | `.cursor(token)` · `.offset(n)` | `.offsetGroups(n)`      |
| in what order | `.order("-registered_at")`      | `.orderGroups("-rows")` |

Grouping, the rows' order and page decide **which rows each bucket shows first** — its `ids`
and its own `cursor`. The groups have no cursor on purpose: a cursor names a row, and a group
is a number over many rows, so ordering by a measure leaves nothing to resume past.

## A saved reading

A criteria is a value, so saving what somebody filtered and grouped is saving one thing:

```ts
localStorage.setItem("my-reading", pack(forSaving(reading.criteria)));

const saved = unpack(localStorage.getItem("my-reading")!);

await datasets.page(saved); // run it
criteria<Dataset>(saved).where(["row_count", ">", 1000]); // go on building over it
merge(saved, whatTheScreenAlwaysAdds); // cross it, under the law
conditionsOf(saved.where).map((one) => explainFilter(one, { meta })); // draw its chips
```

`forSaving` drops the cursor: it names a row under one ordering over one filter and does not
outlive either, so it has no business in something that is kept.

## What is worked out from the answer

A measure is computed by whoever answered the reading. **A derived number is not a measure**:
it is arithmetic over the groups already in hand, and it needs no engine, no round trip and no
permission. That is `@sincpro/criteria/analysis`, and unlike the measures it is open:

```ts
import {
  asSeries,
  cumulative,
  derive,
  fillGaps,
  percentOfTotal,
} from "@sincpro/criteria/analysis";

const shown = derive(tree.buckets, {
  share: percentOfTotal("total"),
  running: cumulative("total"),
  margin: (bucket) => Number(bucket.measures?.income) - Number(bucket.measures?.cost),
});
```

For a chart, the groups already **are** its shape — the bucket values are the categories and
the measures are the series:

```ts
asSeries(byMonth, { measures: ["total"] });
// {categories: ["2026-01", "2026-02"], series: [{name: "total", values: [65000, 30000]}]}

asStackedSeries(byRegionThenRep, { measure: "total" }); // one series per inner group
asTable(pivot); // the pivot as a rectangle: every crossing present, margins and grand total
```

And a month that answered nothing is not a group, it is an absence — only the caller knows the
range it asked about, so only the caller can put it back:

```ts
fillGaps(byMonth, { grain: "month", from, to }); // the empty months, with count 0
```

Nothing here imports a chart library: what comes out is plain data that ECharts, Recharts,
Vega or a `<table>` all take.

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
grouping levels and the mask — and `having` offers the numbers this very criteria folds,
because the builder remembers what `measures` declared:

```ts
criteria<Dataset>()
  .groupBy("encoding")
  .measures({ rows: measure.sum("row_count") })
  .whereMeasures(["rows", ">", 1000]) // "rows" and "count" are offered; anything else is an error
  .orderGroups("-rows");
```

The two mix freely — a resource over `Dataset` takes a typed criteria and an untyped one
alike, which is what makes a saved reading easy to pick back up.

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
