import type { CriteriaFor, Reading, ReadingState, Resource } from "@sincpro/criteria";
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
 * @example
 * // simple
 * function DatasetList({ resource }: Props) {
 *   const { rows, status, hasMore, more } = useReading(
 *     resource,
 *     criteria<Dataset>().where(["encoding", "=", "utf-8"]).limit(50),
 *   );
 *   if (status === "loading") return <Spinner />;
 *   return <List rows={rows} onEndReached={more} hasMore={hasMore} />;
 * }
 *
 * @example
 * // medium: a saved permission merged with what the user typed, refined on every keystroke
 * import { merge, plain, where } from "@sincpro/criteria";
 *
 * function DatasetSearch({ resource, typed }: Props) {
 *   const permission = criteria<Dataset>().where(where.any(["region", "=", "north"]));
 *   const asked = merge(plain(permission), plain(criteria<Dataset>().where(typed)));
 *   const { rows, refine } = useReading(resource, asked);
 *   // call refine(nextCriteria) again whenever `typed` changes
 *   return <List rows={rows} />;
 * }
 *
 * @example
 * // complex: AND(A, B, OR(AND(C, D), E), NOT(F)) — three real levels of nesting. useReading
 * // only needs the finished criteria; grouping is {@link useBuckets}'s job, not this one's.
 * function RecentRawUploads({ resource }: Props) {
 *   const q = criteria<Dataset>().where(
 *     ["row_count", ">", 50],
 *     ["encoding", "!=", "latin-1"],
 *     where.any(
 *       where.all(["tags", "contains", "raw"], ["producer_id", "!=", null]),
 *       ["registered_at", ">=", "2026-03-01T00:00:00.000Z"],
 *     ),
 *     where.negate(["name", "like", "draft"]),
 *   );
 *   const { rows } = useReading(resource, q);
 *   return <List rows={rows} />;
 * }
 */
export function useReading<T>(
  resource: Resource<T>,
  criteria: CriteriaFor<T> = {},
): UseReadingResult<T> {
  // `key` and not `criteria` itself in the dependency list: a criteria built inline is a new
  // object on every render, and `pack` is the identity that already means "the same reading"
  // everywhere else in this package (query keys, URLs).
  const key = pack(plain(criteria));
  const reading: Reading<T> = useMemo(() => resource.read(criteria), [resource, key]);

  useEffect(() => {
    void reading.load();
    return () => reading.reset();
  }, [reading]);

  const state = useSyncExternalStore(
    (onChange) => reading.subscribe(onChange),
    () => reading.snapshot(),
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
