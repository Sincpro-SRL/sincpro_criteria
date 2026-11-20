"use client";

import type {
  CriteriaFor,
  Reading,
  ReadingOptions,
  ReadingState,
  Resource,
} from "@sincpro/criteria";
import { pack, plain } from "@sincpro/criteria";
import { useEffect, useMemo, useSyncExternalStore } from "react";

/**
 * A reading's state, plus the four methods that drive it, bound and ready to call.
 *
 * `more` is renamed to {@link hasMore} here: `ReadingState.more` is the boolean "is there a
 * next page", and the class's own action method is also called `more()` — two different
 * namespaces on the class, but one flat object here, so one of them has to give.
 */
export interface UseReadingResult<T> extends Omit<ReadingState<T>, "more"> {
  /** Whether there is another page to ask for. */
  hasMore: boolean;
  /** The first page. Calling it again is a reload. */
  load(): Promise<void>;
  /** The next page, appended. A no-op while one is already on its way, or there is none. */
  more(): Promise<void>;
  /** Another reading, from the first page — for a search box or a filter change. */
  refine(criteria: CriteriaFor<T>): Promise<void>;
  /** The same reading, read again from the first page. */
  reload(): Promise<void>;
}

/**
 * A live `Reading` over a resource, re-rendering this component when it changes.
 *
 * The reading is created once per distinct `(resource, criteria)` pair — a fresh-but-equal
 * `criteria` object literal built inline on every render does not restart it, because the
 * identity compared is `pack(criteria)`, not the object. `load()` runs once, when that pair
 * first appears, and the reading is reset (its in-flight request aborted) when the component
 * unmounts or the pair changes.
 *
 * It renders on the server too. `options.page` is the first page of this same criteria already
 * read there (`resource.page(criteria)`): the reading starts `ready` with it, the server's HTML
 * carries its rows, and in the browser the mount keeps it instead of asking again. Without it,
 * the server renders the reading `idle` and the browser loads it as a SPA does.
 *
 * @example
 * // simple
 * function DatasetList({ resource }: Props) {
 *   const { rows, status, hasMore, more } = useReading(
 *     resource,
 *     criteria<Dataset>().selection(["encoding", "=", "utf-8"]).limit(50),
 *   );
 *   if (status === "loading") return <Spinner />;
 *   return <List rows={rows} onEndReached={more} hasMore={hasMore} />;
 * }
 *
 * @example
 * // medium: a saved permission merged with what the user typed, refined on every keystroke
 * import { merge, plain, selection } from "@sincpro/criteria";
 *
 * function DatasetSearch({ resource, typed }: Props) {
 *   const permission = criteria<Dataset>().selection(selection.any(["region", "=", "north"]));
 *   const asked = merge(plain(permission), plain(criteria<Dataset>().selection(typed)));
 *   const { rows, refine } = useReading(resource, asked);
 *   // call refine(nextCriteria) again whenever `typed` changes
 *   return <List rows={rows} />;
 * }
 *
 * @example
 * // complex: AND(A, B, OR(AND(C, D), E), NOT(F)) — three real levels of nesting. useReading
 * // only needs the finished criteria; grouping is {@link useBuckets}'s job, not this one's.
 * function RecentRawUploads({ resource }: Props) {
 *   const q = criteria<Dataset>().selection(
 *     ["row_count", ">", 50],
 *     ["encoding", "!=", "latin-1"],
 *     selection.any(
 *       selection.all(["tags", "contains", "raw"], ["producer_id", "!=", null]),
 *       ["registered_at", ">=", "2026-03-01T00:00:00.000Z"],
 *     ),
 *     selection.negate(["name", "like", "draft"]),
 *   );
 *   const { rows } = useReading(resource, q);
 *   return <List rows={rows} />;
 * }
 *
 * @example
 * // server-rendered: a route's loader reads the page, the screen starts from it
 * const loader = () => datasets.page(recent);                  // on the server
 * function Recent({ page }: { page: Page<Dataset> }) {
 *   const { rows } = useReading(datasets, recent, { page });   // server HTML and hydration
 *   return <List rows={rows} />;
 * }
 */
export function useReading<T>(
  resource: Resource<T>,
  criteria: CriteriaFor<T> = {},
  options: ReadingOptions<T> = {},
): UseReadingResult<T> {
  // `key` and not `criteria` itself in the dependency list: a criteria built inline is a new
  // object on every render, and `pack` is the identity that already means "the same reading"
  // everywhere else in this package (query keys, URLs). The page is where a reading starts, read
  // for this criteria: it is not part of what a reading is, so it does not restart one.
  const key = pack(plain(criteria));
  const reading: Reading<T> = useMemo(
    () => resource.read(criteria, options),
    [resource, key],
  );

  useEffect(() => {
    void reading.load();
    return () => reading.reset();
  }, [reading]);

  // The same snapshot on the server: React asks for it there, and refuses to render without it.
  const snapshot = () => reading.snapshot();
  const state = useSyncExternalStore(
    (onChange) => reading.subscribe(onChange),
    snapshot,
    snapshot,
  );

  return useMemo(
    () => ({
      criteria: state.criteria,
      rows: state.rows,
      cursor: state.cursor,
      count: state.count,
      meta: state.meta,
      dropped: state.dropped,
      status: state.status,
      error: state.error,
      hasMore: state.more,
      load: () => reading.load(),
      more: () => reading.more(),
      refine: (next: CriteriaFor<T>) => reading.refine(next),
      reload: () => reading.reload(),
    }),
    [state, reading],
  );
}
