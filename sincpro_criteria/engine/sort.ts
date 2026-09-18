/**
 * Putting rows in the order a criteria asks for.
 *
 * @module
 */

import type { AnyRecord, Criteria, Sort } from "@sincpro/criteria/criteria/grammar";
import { parseOrder } from "@sincpro/criteria/criteria/order";
import { compareValues } from "@sincpro/criteria/engine/compare";
import type { Meta } from "@sincpro/criteria/meta/meta";

/**
 * The rows in the given order, one sort at a time from the last to the first, so an earlier
 * sort wins over a later one — which a stable sort gives for free.
 */
export function sortRows<T = AnyRecord>(rows: readonly T[], sorts: readonly Sort<T>[]): T[] {
  const ordered = [...rows];
  for (const sort of [...sorts].reverse()) {
    ordered.sort((mine, theirs) => {
      const side = compareValues(
        (mine as AnyRecord)[sort.field],
        (theirs as AnyRecord)[sort.field],
      );
      return sort.descending ? -side : side;
    });
  }
  return ordered;
}

/**
 * The ordering a page is actually walked in: what the criteria asked for, or the model's
 * default, **plus the identity as a tiebreaker**.
 *
 * The tiebreaker is not a nicety. A keyset cursor names a row by its sort keys, so an
 * ordering that two rows can share names two rows — and a page walk either repeats them or
 * skips them.
 */
export function orderingFor<T = AnyRecord>(criteria: Criteria<T>, meta: Meta): Sort<T>[] {
  const asked = criteria.order?.length ? criteria.order : parseOrder<T>(meta.default_order);
  const sorts = asked.length > 0 ? [...asked] : [{ field: meta.identity } as Sort<T>];
  if (sorts.some((sort) => sort.field === meta.identity)) return sorts;
  return [...sorts, { field: meta.identity, descending: sorts[0]!.descending } as Sort<T>];
}
