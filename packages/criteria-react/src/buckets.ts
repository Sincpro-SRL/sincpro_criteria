import type { Bucket, BucketsState, CriteriaFor, Reading, Resource } from "@sincpro/criteria";
import { pack, plain } from "@sincpro/criteria";
import { useEffect, useMemo, useSyncExternalStore } from "react";

/** A level of buckets' state, plus the methods that drive it and open what it found. */
export interface UseBucketsResult<T> extends BucketsState<T> {
  /** The buckets of this level. */
  load(): Promise<void>;
  /** The same levels over another reading. */
  refine(criteria: CriteriaFor<T>): Promise<void>;
  /** The rows of one bucket, as a `Reading` of its own — pass this to {@link useReading}. */
  open(bucket: Bucket<T>): Reading<T>;
}

/**
 * A live level of buckets over a resource, re-rendering this component when it changes.
 *
 * Same identity rule as {@link useReading}: the level is keyed by `pack(criteria)`, not by
 * object identity, so an inline `criteria` literal does not restart it on every render.
 *
 * @example
 * // simple
 * function EncodingBreakdown({ resource }: Props) {
 *   const { buckets, status } = useBuckets(resource, criteria<Dataset>().groupBy("encoding"));
 *   return <BarChart data={buckets} />;
 * }
 *
 * @example
 * // medium: a measure, and opening a clicked bucket's rows with useReading
 * import { measure } from "@sincpro/criteria";
 * import { useReading } from "@sincpro/criteria-react";
 *
 * function EncodingTotals({ resource }: Props) {
 *   const tree = useBuckets(
 *     resource,
 *     criteria<Dataset>().groupBy("encoding").measures({ rows: measure.sum("row_count") }),
 *   );
 *   const [opened, setOpened] = useState<Bucket<Dataset>>();
 *   const rows = useReading(resource, opened ? opened.criteria : {});
 *   return (
 *     <>
 *       <BarChart data={tree.buckets} onBarClick={setOpened} />
 *       {opened && <List rows={rows.rows} />}
 *     </>
 *   );
 * }
 *
 * @example
 * // complex: two grouping levels, two measures, a filter over the groups themselves,
 * // group-count paging AND row-count paging, and following one bucket's own cursor further.
 * import { resumingFrom, where } from "@sincpro/criteria";
 *
 * function HighVolumeProducers({ resource }: Props) {
 *   const tree = useBuckets(
 *     resource,
 *     criteria<Dataset>()
 *       .where(
 *         ["row_count", ">", 50],
 *         where.any(
 *           where.all(["tags", "contains", "raw"], ["producer_id", "!=", null]),
 *           ["registered_at", ">=", "2026-03-01T00:00:00.000Z"],
 *         ),
 *         where.negate(["name", "like", "draft"]),
 *       )
 *       .groupBy("encoding", "producer_id")
 *       .measures({ total_rows: measure.sum("row_count") })
 *       .whereMeasures(["total_rows", ">", 200])
 *       .orderGroups("-total_rows")
 *       .limitGroups(2) // at most 2 top-level groups
 *       .limit(2), // at most 2 row ids per surviving group
 *   );
 *
 *   async function loadMoreOf(bucket: Bucket<Dataset>) {
 *     if (bucket.cursor === null) return;
 *     const next = await resource.page(resumingFrom(bucket.criteria, bucket.cursor));
 *     // next.rows -> the next page of ids INSIDE that one bucket, not the whole catalog
 *   }
 *
 *   return <Tree buckets={tree.buckets} onLoadMore={loadMoreOf} />;
 * }
 */
export function useBuckets<T>(
  resource: Resource<T>,
  criteria: CriteriaFor<T> = {},
): UseBucketsResult<T> {
  const key = pack(plain(criteria));
  const buckets = useMemo(() => resource.group(criteria), [resource, key]);

  useEffect(() => {
    void buckets.load();
    // `Buckets` has no `reset()` — an in-flight request left over from an unmounted component
    // resolves into a `write()` on a store nobody is subscribed to any more, which is a no-op.
  }, [buckets]);

  const state = useSyncExternalStore(
    (onChange) => buckets.subscribe(onChange),
    () => buckets.snapshot(),
  );

  return useMemo(
    () => ({
      ...state,
      load: () => buckets.load(),
      refine: (next: CriteriaFor<T>) => buckets.refine(next),
      open: (bucket: Bucket<T>) => buckets.open(bucket),
    }),
    [state, buckets],
  );
}
