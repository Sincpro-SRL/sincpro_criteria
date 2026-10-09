# sincpro_criteria

Build a **Criteria** in TypeScript and send it to a service written with
[`sincpro_framework`](https://github.com/Sincpro-SRL/sincpro_framework).

A criteria is one object: the filter, the order, the page, what to expand, how to group. In
Python that object is `Criteria` (`sincpro_framework/ddd/criteria`). This repository is the
client that constructs the same JSON, so a screen, a script or a saved reading all ask in the
language the framework already reads.

```bash
npm install @sincpro/criteria
```

React, when the screen needs a hook:

```bash
npm install @sincpro/criteria @sincpro/criteria-react
```

`@sincpro/criteria` has no runtime dependencies. It does not import the Python framework. The
two sides meet on the wire: you send `criteria`, the service answers a page.

| If you are…                                        | Start here                                           |
| -------------------------------------------------- | ---------------------------------------------------- |
| A list of invoices, with the partner and the lines | [Invoices](#invoices-with-the-partner-and-the-lines) |
| Analytic totals by account and month               | [Analytic accounting](#analytic-accounting)          |
| Filtering rows you already have                    | [TypeScript, no server](#typescript-no-server)       |
| Calling a Sincpro service                          | [JSON-RPC](#json-rpc-against-sincpro_framework)      |
| Rendering that reading in React                    | [React](#react)                                      |
| A REST route that already takes `?criteria=`       | [REST](#rest)                                        |

The reference for the whole grammar — merge, saved readings, what gets dropped — is
[`packages/criteria/README.md`](packages/criteria/README.md).

The examples below are the reads an accounting service actually publishes. `Invoice` and
`InvoiceLine` are two models, so they are two queries. Field names are the ones
`model_meta_data` publishes. A relation is expanded in `specification`; the filter names the
key (`partner_id`), never the relation (`partner`).

```ts
type Partner = { partner_id: string; name: string };
type AnalyticAccount = { analytic_account_id: string; code: string; name: string };

type InvoiceLine = {
  line_id: string;
  name: string;
  account_id: string;
  analytic_account_id: string | null;
  debit: number;
  credit: number;
  date: string;
  analytic_account?: AnalyticAccount;
};

type Invoice = {
  invoice_id: string;
  number: string;
  partner_id: string;
  journal_id: string;
  state: "draft" | "posted" | "cancelled";
  move_type: "out_invoice" | "out_refund" | "in_invoice";
  invoice_date: string;
  amount_total: number;
  currency: string;
  partner?: Partner;
  lines?: InvoiceLine[];
};
```

## Invoices, with the partner and the lines

Posted customer invoices of the quarter, for two partners or the sales journal, above zero,
whose number is not a draft. Each row comes back with the partner's name and the lines that
carry an analytic account — twenty lines per invoice, each line with its analytic account's
code and name.

`plain()` of this is the `criteria` the framework validates. A condition is a triple. Several
arguments are ANDed. `where.any` and `where.negate` are OR and NOT. `.order("-invoice_date")`
is written with a minus and travels as `{ field, descending: true }`.

```ts
import { criteria, plain, where } from "@sincpro/criteria";

const postedSales = criteria<Invoice>()
  .where(
    ["move_type", "=", "out_invoice"],
    ["state", "=", "posted"],
    ["invoice_date", "between", ["2026-01-01", "2026-03-31"]],
    ["amount_total", ">", 0],
    where.any(["partner_id", "in", ["p-acme", "p-andes"]], ["journal_id", "=", "sale"]),
    where.negate(["number", "like", "DRAFT"]),
  )
  .order("-invoice_date", "number")
  .limit(50)
  .counting("exact")
  .specification({
    number: {},
    invoice_date: {},
    amount_total: {},
    currency: {},
    partner: plain(criteria<Partner>().specification({ name: {} })),
    lines: plain(
      criteria<InvoiceLine>()
        .where(["analytic_account_id", "is null", false]) // false → IS NOT NULL
        .order("date")
        .limit(20)
        .specification({
          name: {},
          debit: {},
          credit: {},
          analytic_account: plain(
            criteria<AnalyticAccount>().specification({ code: {}, name: {} }),
          ),
        }),
    ),
  });
```

The lines are a criteria of their own, nested inside the invoice's. The framework resolves
that node with the same machinery it used for the page: filter, order, page, and what to
bring. `["analytic_account_id", "is null", false]` keeps the lines that have an analytic
account. `["analytic_account_id", "is null", true]` would be the ones that do not.

## Analytic accounting

A report is a grouping, not a longer list. Invoice lines of the quarter that have an analytic
account, split by that account and then by month, with the debit and the credit of each
bucket. Buckets whose debit is zero are left out. The first twelve accounts, largest debit
first.

```ts
import { criteria, measure } from "@sincpro/criteria";

const byAnalytic = criteria<InvoiceLine>()
  .where(
    ["date", "between", ["2026-01-01", "2026-03-31"]],
    ["analytic_account_id", "is null", false],
  )
  .groupBy("analytic_account_id", { field: "date", grain: "month" })
  .measures({
    debit: measure.sum("debit"),
    credit: measure.sum("credit"),
  })
  .whereMeasures(["debit", ">", 0])
  .orderGroups("-debit")
  .limitGroups(12);
```

`.limit(n)` pages the rows inside a bucket. `.limitGroups(n)` pages the buckets. A group has
no cursor: it is a number over many rows, so the next page of accounts is an offset, and
`limitGroups` is what asks for it.

The balance is not a third measure. `debit` and `credit` are what the engine folds; the
balance is arithmetic over buckets already in hand, in `@sincpro/criteria/analysis`, with no
second round trip:

```ts
import { derive } from "@sincpro/criteria/analysis";

const shown = derive(buckets, {
  balance: (bucket) => Number(bucket.measures?.debit) - Number(bucket.measures?.credit),
});
```

On the wire the grouping is one object. `where` still filters the lines; `where_measures`
filters the buckets:

```json
{
  "grouping": {
    "group_by": [{ "field": "analytic_account_id" }, { "field": "date", "grain": "month" }],
    "measures": {
      "debit": { "function": "sum", "field": "debit" },
      "credit": { "function": "sum", "field": "credit" }
    },
    "where_measures": { "field": "debit", "operator": ">", "value": 0 },
    "order": [{ "field": "debit", "descending": true }],
    "pagination": { "limit": 12 }
  }
}
```

Opening one account is not a new filter. The bucket carries the criteria that produced it;
send that criteria back as the next read.

## TypeScript, no server

`fromRows` answers the same criteria over an array. The lines below are already in hand, so
there is no partner to expand and no `specification` to send. Point the same `byAnalytic` at
a service later by swapping the source.

```ts
import { criteria, fromRows, resource } from "@sincpro/criteria";

const lines = resource(
  fromRows<InvoiceLine>(
    [
      {
        line_id: "l1",
        name: "Hosting",
        account_id: "4100",
        analytic_account_id: "a-ops",
        debit: 1200,
        credit: 0,
        date: "2026-01-15",
      },
      {
        line_id: "l2",
        name: "Rent",
        account_id: "6100",
        analytic_account_id: null,
        debit: 800,
        credit: 0,
        date: "2026-02-01",
      },
    ],
    { identity: "line_id" },
  ),
);

const page = await lines.page(
  criteria<InvoiceLine>()
    .where(["analytic_account_id", "is null", false], ["debit", ">", 1000])
    .order("-date")
    .limit(20),
);

page.rows; // the hosting line
page.count; // { value: 1, exact: true }
```

## JSON-RPC against sincpro_framework

This is the usual way a TypeScript app talks to a service built on the framework.

On the server, a listing is a `Query`. The framework's RPC gateway publishes it under
`{namespace}.{operation}` — `CommandListInvoices` in a group whose namespace is `accounting`
becomes `accounting.list_invoices`. The live list is `GET /openrpc.json` on that service
(`rpc.discover` returns the same document).

```python
from sincpro_framework.ddd.query import Query, ResponsePaginatedQuery

class CommandListInvoices(Query):
    pass

class ResponseListInvoices(ResponsePaginatedQuery):
    invoices: list[Invoice]

class CommandListInvoiceLines(Query):
    pass

class ResponseListInvoiceLines(ResponsePaginatedQuery):
    lines: list[InvoiceLine]
```

The analytic report is a third query, the one whose answer is buckets. Its method is named the
same way (`accounting.group_invoice_lines`). The records keep the response's own field name;
`pageFrom` takes whichever array is not part of the envelope.

On the client, one resource per query. `params` is always `{ criteria: <the plain object> }`.
`postedSales` and `byAnalytic` are the criteria from the sections above.

```ts
import { resource } from "@sincpro/criteria";
import { RpcError, rpcSource } from "@sincpro/criteria/rpc";

const rpc = {
  headers: () => ({ Authorization: `Bearer ${token()}` }),
  // Merged server-side with the context the transport already attached.
  context: () => ({ company_id: currentCompany() }),
};

const invoices = resource<Invoice>(
  rpcSource("https://api.example.com/rpc", { read: "accounting.list_invoices" }, rpc),
);

const lines = resource<InvoiceLine>(
  rpcSource(
    "https://api.example.com/rpc",
    { read: "accounting.list_invoice_lines", group: "accounting.group_invoice_lines" },
    rpc,
  ),
);

try {
  const page = await invoices.page(postedSales);
  page.rows; // invoices, each with partner.name and lines[]

  const report = await lines.groups(byAnalytic);
  report.rows; // one bucket per analytic account, months nested in bucket.groups
} catch (error) {
  if (error instanceof RpcError) {
    console.error(error.rpcError.code, error.rpcError.message);
  }
}
```

What leaves the browser for the list. `params.criteria` is `plain(postedSales)` and `context`
rides beside `params`, not inside the criteria. The `where` and the `specification` here are
cut down to the shape; the call sends every condition and every nested field from the invoice
section above:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "accounting.list_invoices",
  "params": {
    "criteria": {
      "where": {
        "all": [
          { "field": "move_type", "operator": "=", "value": "out_invoice" },
          { "field": "state", "operator": "=", "value": "posted" }
        ]
      },
      "order": [{ "field": "invoice_date", "descending": true }, { "field": "number" }],
      "pagination": { "limit": 50 },
      "specification": {
        "partner": { "specification": { "name": {} } },
        "lines": {
          "where": { "field": "analytic_account_id", "operator": "is null", "value": false },
          "pagination": { "limit": 20 }
        }
      }
    }
  },
  "context": { "company_id": "co-1" }
}
```

**`context` is the framework's, and it is optional.** It is the JSON-RPC field the entrypoint
already reads (`sincpro_framework/entrypoints/rpc`): a plain object merged into the call —
tenant, locale, whatever that service decided to carry. It is not a React context and it is
not a package you install. Leave `context` out and the call is still a valid criteria read.
A function is called on every request, so a value that changes (the current tenant) stays
current.

The answer is the same paginated DTO a REST route returns for that command. `pageFrom` reads
`rows`, `cursor`, `count`, `model_meta_data` and `dropped` out of it.

The next page is the cursor the previous page handed back. A reading holds that for you:

```ts
const reading = invoices.read(postedSales);
await reading.load();
await reading.more();
reading.rows; // both pages, lines included
reading.hasMore;
```

## React

`@sincpro/criteria-react` is a separate package so installing the core never pulls in React.
It takes the same `resource` from the sections above — an in-memory one, an RPC one, a REST
one.

```tsx
import { resource } from "@sincpro/criteria";
import { rpcSource } from "@sincpro/criteria/rpc";
import { useBuckets, useReading } from "@sincpro/criteria-react";

const invoices = resource<Invoice>(
  rpcSource("https://api.example.com/rpc", { read: "accounting.list_invoices" }),
);
const lines = resource<InvoiceLine>(
  rpcSource("https://api.example.com/rpc", {
    read: "accounting.list_invoice_lines",
    group: "accounting.group_invoice_lines",
  }),
);

function InvoiceList() {
  const { rows, status, hasMore, more } = useReading(invoices, postedSales);

  if (status === "loading") return <p>Loading…</p>;
  return (
    <ul>
      {rows.map((invoice) => (
        <li key={invoice.invoice_id}>
          {invoice.number} · {invoice.partner?.name} · {invoice.lines?.length ?? 0} lines
        </li>
      ))}
      {hasMore && <button onClick={() => more()}>More</button>}
    </ul>
  );
}

function AnalyticReport() {
  const { buckets, status } = useBuckets(lines, byAnalytic);
  if (status === "loading") return <p>Loading…</p>;
  return (
    <ul>
      {buckets.map((bucket) => (
        <li key={String(bucket.value)}>
          {String(bucket.value)} · debit {String(bucket.measures?.debit)}
        </li>
      ))}
    </ul>
  );
}
```

The hook is keyed by the packed criteria, so writing `criteria()` inline on every render does
not restart the request.

If the app already has TanStack Query (or any cache that takes an array key), skip the hook
and take only the key. This package does not import react-query.

```tsx
import { useQuery } from "@tanstack/react-query";
import type { Criteria } from "@sincpro/criteria";
import { queryKeyFor } from "@sincpro/criteria-react";

function useInvoices(q: Criteria<Invoice>) {
  return useQuery({
    queryKey: queryKeyFor(["accounting", "invoices"], q),
    queryFn: ({ signal }) => invoices.page(q, signal),
  });
}
```

Hooks, permissions merged with what the user typed, and grouping are in
[`packages/criteria-react/README.md`](packages/criteria-react/README.md).

## REST

A framework service that exposes the same query over REST already accepts one query
parameter, `criteria`, holding `pack(q)` — the plain JSON as one URL-safe string.

```ts
import { resource } from "@sincpro/criteria";
import { restSource } from "@sincpro/criteria/rest";

const invoices = resource<Invoice>(
  restSource("https://api.example.com/invoices", {
    headers: () => ({ Authorization: `Bearer ${token()}` }),
  }),
);

const page = await invoices.page(postedSales);
```

That is `GET /invoices?criteria=<packed>`. The same `postedSales` object goes out; `pack` is
only how it fits in a URL. Grouping reuses the same URL; pass `groupUrl` only when that
backend answers groups somewhere else.

## Who depends on what

```
your app
  └── @sincpro/criteria          builds the criteria, reads the page
        └── (no packages)
  └── @sincpro/criteria-react    optional; peers: react, @sincpro/criteria

the service you call
  └── sincpro_framework          defines Criteria, validates it, answers the page
```

| This repository                          | The framework                                                    |
| ---------------------------------------- | ---------------------------------------------------------------- |
| `criteria()`, `where`, `plain`, `merge`  | `ddd/criteria` — the object and the merge law                    |
| `@sincpro/criteria/engine`               | `ddd/criteria/evaluate.py` — the in-memory specification         |
| `pageFrom`, `model_meta_data`, `dropped` | the paginated answer                                             |
| `@sincpro/criteria/rpc`                  | `POST /rpc`, method `{namespace}.{operation}`, `params.criteria` |
| `@sincpro/criteria/rest`                 | the REST entrypoint's `criteria` query parameter                 |

The grammar is defined in the framework. This repo mirrors it, and a parity suite runs the
same cases through both in-memory engines. The language as the engine writes it is
[`docs/persistence/criteria.md`](https://github.com/Sincpro-SRL/sincpro_framework/blob/main/docs/persistence/criteria.md).
When the law changes, it changes there first.

## Packages

| Package                                                        |                                                        |
| -------------------------------------------------------------- | ------------------------------------------------------ |
| [`@sincpro/criteria`](packages/criteria/README.md)             | Grammar, builder, in-memory engine, REST and JSON-RPC. |
| [`@sincpro/criteria-react`](packages/criteria-react/README.md) | `useReading`, `useBuckets`, `queryKeyFor`.             |

Where a new addon belongs, and why a live update invalidates a reading instead of streaming
row diffs, is [docs/DESIGN.md](docs/DESIGN.md). Versions of the two packages move together.

## Development

Node 22 or newer.

```bash
make init            # install
make test            # both packages
make typecheck
make verify-format   # eslint, prettier, doctor; fails if the tree changed
```

## License

MIT © Sincpro SRL
