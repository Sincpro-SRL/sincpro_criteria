import type { CriteriaFor } from "@sincpro/criteria/criteria/builder";
import { plain } from "@sincpro/criteria/criteria/builder";
import type { AnyRecord, Criteria } from "@sincpro/criteria/criteria/grammar";
import { DEFAULT_LIMIT } from "@sincpro/criteria/engine/paginate";
import type { Axes } from "@sincpro/criteria/engine/pivot";
import type { Bucket, Page, Pivot } from "@sincpro/criteria/page/page";
import { Buckets } from "@sincpro/criteria/reading/buckets";
import { Reading } from "@sincpro/criteria/reading/reading";
import { fromRows } from "@sincpro/criteria/source/rows";
import type { Source } from "@sincpro/criteria/source/source";

/** How a resource treats what its source does not answer. */
export interface ResourceOptions {
  /**
   * Whether to work out a grouping or a pivot in memory when the source has none.
   *
   * Off by default, and that is deliberate: answering it here means reading **every row the
   * criteria matches** first, and a screen that quietly downloads a table is worse than one
   * that says the source cannot group. Turn it on when the rows are few or already local.
   */
  groupLocally?: boolean;

  /**
   * How many rows to read at a time while gathering them for a local grouping, and the most
   * that will ever be gathered. Reaching the ceiling throws rather than answering a grouping
   * over part of the rows, because a count over half the rows is a wrong count, not a partial
   * one.
   */
  localPageSize?: number;
  localCeiling?: number;
}

/**
 * A source with the reads and the live objects hanging off it.
 *
 * A resource is the door: it takes a source and hands back the one-shot reads and the live
 * objects. It holds no state of its own — every reading it makes is its own.
 */
export interface Resource<T = AnyRecord> {
  /** One page, once. Nothing is remembered. */
  page(criteria?: CriteriaFor<T>, signal?: AbortSignal): Promise<Page<T>>;

  /** The buckets of the first level, once. */
  groups(criteria?: CriteriaFor<T>, signal?: AbortSignal): Promise<Page<Bucket<T>>>;

  /** Groups crossed by groups, once. */
  pivot(criteria: CriteriaFor<T>, axes: Axes<T>, signal?: AbortSignal): Promise<Pivot>;

  /** Every row the criteria matches, walked one page at a time. */
  all(criteria?: CriteriaFor<T>, signal?: AbortSignal): AsyncIterableIterator<T>;

  /** A live reading: rows, cursor, count and the four methods that drive them. */
  read(criteria?: CriteriaFor<T>): Reading<T>;

  /** A live level of buckets. */
  group(criteria?: CriteriaFor<T>): Buckets<T>;

  /** The source underneath, for whoever needs it. */
  source: Source<T>;
}

/**
 * A resource over a source.
 *
 * @example
 * const datasets = resource<Dataset>(async (criteria) =>
 *   pageFrom(await getJson("/datasets", { criteria: pack(criteria) })),
 * );
 *
 * const reading = datasets.read(criteria<Dataset>().order("-registered_at").limit(100));
 * await reading.load();
 *
 * for await (const dataset of datasets.all(criteria<Dataset>().where(["encoding", "=", "utf-8"]))) {
 *   // every matching row, one page at a time, without a cursor in sight
 * }
 *
 * @example
 * // Three plain AND conditions, an OR, a NOT, two grouping levels, two measures, and a
 * // filter over the groups themselves — one criteria, one call.
 * const q = criteria<Dataset>()
 *   .where(
 *     ["row_count", ">", 100],
 *     ["encoding", "!=", "latin-1"],
 *     ["registered_at", ">=", "2026-01-01T00:00:00.000Z"],
 *     where.any(["tags", "contains", "raw"], ["producer_id", "is null", true]),
 *     where.negate(["name", "like", "draft%"]),
 *   )
 *   .groupBy("encoding", "producer_id")
 *   .measures({ total_rows: measure.sum("row_count"), avg_rows: measure.avg("row_count") })
 *   .whereMeasures(["total_rows", ">", 500])
 *   .limit(10);
 * await datasets.groups(q);
 */
export function resource<T = AnyRecord>(
  from: Source<T> | Source<T>["read"],
  options: ResourceOptions = {},
): Resource<T> {
  // The smallest source is the one function that answers a page; anything more comes as the
  // object. Taking both means the simple case has no shape to remember.
  const source: Source<T> = typeof from === "function" ? { read: from } : from;
  const gathering = {
    pageSize: options.localPageSize ?? 500,
    ceiling: options.localCeiling ?? 10000,
  };

  async function gathered(criteria: Criteria<T>, signal?: AbortSignal): Promise<T[]> {
    const rows: T[] = [];
    for await (const row of walk(source, criteria, gathering.pageSize, signal)) {
      rows.push(row);
      if (rows.length > gathering.ceiling) {
        throw new Error(
          `this reading matches more than ${gathering.ceiling} rows, which is more than this ` +
            "resource will gather to group in memory. Give the source a `group`, or raise " +
            "`localCeiling` knowing every row will be read.",
        );
      }
    }
    return rows;
  }

  const resolved: Source<T> = {
    read: (criteria, signal) => source.read(criteria, signal),

    group:
      source.group !== undefined
        ? (criteria, signal) => source.group!(criteria, signal)
        : options.groupLocally
          ? async (criteria, signal) => {
              const rows = await gathered(criteria, signal);
              return fromRows<T>(rows).group!(criteria) as Page<Bucket<T>>;
            }
          : undefined,

    pivot:
      source.pivot !== undefined
        ? (criteria, axes, signal) => source.pivot!(criteria, axes, signal)
        : options.groupLocally
          ? async (criteria, axes, signal) => {
              const rows = await gathered(criteria, signal);
              return fromRows<T>(rows).pivot!(criteria, axes) as Pivot;
            }
          : undefined,

    live: source.live === undefined ? undefined : (criteria) => source.live!(criteria),
  };

  return {
    source: resolved,

    page: async (criteria = {}, signal) => resolved.read(plain(criteria), signal),

    groups: async (criteria = {}, signal) => {
      if (resolved.group === undefined) throw new Error(cannotGroup);
      return resolved.group(plain(criteria), signal);
    },

    pivot: async (criteria, axes, signal) => {
      if (resolved.pivot === undefined) throw new Error(cannotGroup);
      return resolved.pivot(plain(criteria), axes, signal);
    },

    all: (criteria = {}, signal) => walk(resolved, plain(criteria), undefined, signal),

    read: (criteria = {}) => new Reading<T>(resolved, criteria),

    group: (criteria = {}) => new Buckets<T>(resolved, criteria),
  };
}

const cannotGroup =
  "this source does not group. Give it a `group`, or build the resource with " +
  "`{ groupLocally: true }` and it will read every matching row and group them here.";

/**
 * Every row a criteria matches, one page at a time.
 *
 * The cursor is the loop's own business, which is the whole point: a caller writes
 * `for await (const row of ...)` and never holds a token. The walk stops when a page names no
 * next one.
 */
async function* walk<T>(
  source: Source<T>,
  criteria: Criteria<T>,
  pageSize: number | undefined,
  signal?: AbortSignal,
): AsyncIterableIterator<T> {
  const limit = pageSize ?? criteria.pagination?.limit ?? DEFAULT_LIMIT;
  let asked: Criteria<T> = { ...criteria, pagination: { ...criteria.pagination, limit } };

  for (;;) {
    const page: Page<T> = await source.read(asked, signal);
    yield* page.rows;
    if (page.cursor === null) return;
    asked = {
      ...asked,
      pagination: { limit, strategy: { token: page.cursor } },
      meta: false,
    };
  }
}
