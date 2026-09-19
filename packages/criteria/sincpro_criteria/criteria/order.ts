import type { AnyRecord, Fields, Sort } from "@sincpro/criteria/criteria/grammar";

/**
 * Reads an ordering written the way a URL carries it. Blank and empty parts are ignored.
 *
 * @example
 * parseOrder("-registered_at,name");
 * // [{field: "registered_at", descending: true}, {field: "name"}]
 */
export function parseOrder<T = AnyRecord>(written: string): Sort<T>[] {
  return written
    .split(",")
    .map((piece) => piece.trim())
    .filter((piece) => piece.length > 0)
    .map((piece) =>
      piece.startsWith("-")
        ? { field: piece.slice(1) as Fields<T>, descending: true }
        : { field: piece as Fields<T> },
    );
}

/**
 * The inverse: an ordering as one line.
 *
 * @example
 * formatOrder([{field: "registered_at", descending: true}, {field: "name"}]);
 * // "-registered_at,name"
 */
export function formatOrder<T = AnyRecord>(sorts: readonly Sort<T>[]): string {
  return sorts.map((sort) => (sort.descending ? `-${sort.field}` : sort.field)).join(",");
}
