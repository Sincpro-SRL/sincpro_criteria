# @sincpro/criteria-react

React hooks over [`@sincpro/criteria`](https://github.com/Sincpro-SRL/sincpro_criteria)'s
`Reading`/`Buckets`, and a query-key helper for a consumer that already has its own cache. A
separate package from the core on purpose — see `docs/DESIGN.md` at the repo root for why —
because it needs `react` as a real dependency, and that must never leak into installing the
core for `Criteria`/`Source` alone.

There are two ways to use this, and picking between them is one question: **does your app
already have a query cache (react-query, SWR, …)?**

## No cache of your own: `useReading` / `useBuckets`

`Reading` and `Buckets` are already `useSyncExternalStore`-shaped stores. These hooks own the
lifecycle a store by itself cannot: create one per `(resource, criteria)` pair, load it once,
clean it up on unmount.

```tsx
import { useReading } from "@sincpro/criteria-react";
import { criteria } from "@sincpro/criteria";

function DatasetList({ resource, where }: Props) {
  const { rows, status, hasMore, more } = useReading(
    resource,
    criteria<Dataset>().where(where).limit(50),
  );

  if (status === "loading") return <Spinner />;
  return <List rows={rows} onEndReached={more} hasMore={hasMore} />;
}
```

`useBuckets` is the grouping counterpart:

```tsx
import { useBuckets } from "@sincpro/criteria-react";

function EncodingBreakdown({ resource }: Props) {
  const { buckets, status } = useBuckets(resource, criteria<Dataset>().groupBy("encoding"));
  return <BarChart data={buckets} />;
}
```

Both are keyed by `pack(criteria)`, not by object identity — a `criteria` literal built fresh
on every render does not restart the reading.

## Already have a cache: `queryKeyFor`

Reusing `Reading` here would be a second cache fighting the one you already trust.
`queryKeyFor` is the one line that was missing — a stable key from a criteria, so two requests
that ask the same question hit the same cache entry:

```tsx
import { useQuery } from "@tanstack/react-query";
import { queryKeyFor } from "@sincpro/criteria-react";

function useDatasets(criteria: Criteria<Dataset>) {
  return useQuery({
    queryKey: queryKeyFor(["catalog", "datasets"], criteria),
    queryFn: ({ signal }) => datasets.page(criteria, signal),
  });
}
```

This package never imports `react-query`, `SWR`, or anything like them — `queryKeyFor` returns
a plain array, so it works with whichever cache you already have.

## Combining a permission with what the user typed

Merging is `@sincpro/criteria`'s job (`merge`, plain functions, no React in it) — this package
adds nothing to that law, it just gives you a place to call it once instead of at every call
site. A small custom hook is the natural shape, not a HOC — nothing here needs to wrap a
component to do this:

```tsx
import { criteria, merge, plain, where } from "@sincpro/criteria";
import { useReading } from "@sincpro/criteria-react";

function usePermissionedAccounts(resource: Resource<Account>, typed: Expression<Account>) {
  const permission = criteria<Account>().where(
    where.any(["region", "=", "north"], ["owner", "=", useCurrentUser()]),
  );
  const asked = merge(plain(permission), plain(criteria<Account>().where(typed)));
  return useReading(resource, asked);
}
```

`asked` is what actually reaches the network — the user's filter narrows the permission, it
can never widen past it, because `where` always merges by AND. See the core README's "The law
for merging two of them" for what merge does with the rest of a criteria (order, pagination,
grouping), not just `where`.

## Development

```bash
make init           # from the repo root — installs the whole workspace
make test           # node --test over these hooks, react-test-renderer, no DOM needed
make typecheck
make build
```
