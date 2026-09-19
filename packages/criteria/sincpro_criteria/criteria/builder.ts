import type { Filter } from "@sincpro/criteria/criteria/filter";
import { combined } from "@sincpro/criteria/criteria/filter";
import type {
  AnyRecord,
  CountMode,
  Criteria,
  Fields,
  Grain,
  Grouping,
  Level,
  Measure,
  Pagination,
  Sort,
  Specification,
} from "@sincpro/criteria/criteria/grammar";
import { readMeasure } from "@sincpro/criteria/criteria/measure";
import { merge as mergeCriterias } from "@sincpro/criteria/criteria/merge";
import { parseOrder } from "@sincpro/criteria/criteria/order";

/** A criteria written either way. Everything public accepts this. */
export type CriteriaLike<T = AnyRecord> = Criteria<T> | CriteriaBuilder<T>;

/**
 * A criteria for this record, or one written without a record type at all.
 *
 * **This is what makes typing opt-in where the record type is already fixed by something
 * else.** A resource over `Dataset` knows its type, and `criteria()` — the one a caller
 * writes when it has no generated type to hang on, and the one a saved reading comes back as
 * — is a criteria over no record in particular. Without this union those two do not fit
 * together, because a criteria carries its field names in its type and is therefore invariant
 * in it.
 *
 * Nothing is lost: field names are checked where the criteria is BUILT, which is where the
 * mistake would be made.
 */
export type CriteriaFor<T> = CriteriaLike<T> | CriteriaLike;

/**
 * A name an ordering can use, ascending or descending.
 *
 * Written as the line a URL carries — `"-registered_at"` — and typed, so the editor offers
 * every field in both directions and a typo is a compile error instead of an ordering the
 * server drops.
 */
export type OrderBy<F extends string> = F | `-${F}`;

/** The plain object, however it was written. */
export function plain<T = AnyRecord>(written: CriteriaFor<T>): Criteria<T> {
  // The cast is the union above being collapsed: a criteria over no record in particular is
  // read as one over this record, and its field names were checked when it was written.
  const value = written instanceof CriteriaBuilder ? written.value : written;
  return value as Criteria<T>;
}

/**
 * The door: `criteria<Dataset>()` to have it typed, `criteria()` when there is no type to
 * hang it on yet, and `criteria(saved)` to go on building over a reading that was saved.
 *
 * @example
 * // simple
 * const q = criteria<Dataset>().where(["encoding", "=", "utf-8"]).limit(50);
 *
 * @example
 * // medium: order, a saved/unpacked criteria continued, OR/NOT
 * criteria<Dataset>(unpack(fromTheUrl)).where(["encoding", "=", "utf-8"]);
 *
 * const q = criteria<Dataset>()
 *   .where(
 *     ["encoding", "=", "utf-8"],
 *     where.any(["tags", "contains", "raw"], ["producer_id", "is null", true]),
 *     where.negate(["name", "like", "draft"]),
 *   )
 *   .order("-registered_at")
 *   .limit(100);
 *
 * @example
 * // complex: nested AND/OR/NOT three levels deep, two grouping levels, two measures, a
 * // filter over the groups themselves, group-count paging AND row-count paging — one
 * // criteria, built up the same way regardless of which of those pieces get used.
 * const q = criteria<Dataset>()
 *   .where(
 *     ["row_count", ">", 50],
 *     ["encoding", "!=", "latin-1"],
 *     where.any(
 *       where.all(["tags", "contains", "raw"], ["producer_id", "!=", null]),
 *       ["registered_at", ">=", "2026-03-01T00:00:00.000Z"],
 *     ),
 *     where.negate(["name", "like", "draft"]),
 *   )
 *   .groupBy("encoding", "producer_id")
 *   .measures({ total_rows: measure.sum("row_count"), avg_rows: measure.avg("row_count") })
 *   .whereMeasures(["total_rows", ">", 200])
 *   .orderGroups("-total_rows")
 *   .limitGroups(2)
 *   .limit(2);
 * await datasets.groups(q);
 */
export function criteria<T = AnyRecord>(initial: CriteriaFor<T> = {}): CriteriaBuilder<T> {
  return new CriteriaBuilder<T>(plain<T>(initial));
}

/**
 * An immutable criteria under construction. Built through {@link criteria}.
 *
 * The second type parameter is the names this grouping folds. It is filled in by
 * {@link CriteriaBuilder.totals} and read by {@link CriteriaBuilder.having}, so filtering the
 * groups offers the numbers this very criteria declared.
 */
export class CriteriaBuilder<T = AnyRecord, Totals extends string = never> {
  /**
   * The plain object.
   *
   * Frozen at the top level, so no method of this class can write to it and the builder
   * before a call keeps saying what it said. What it holds is not copied: a mask or a list of
   * levels handed in stays the caller's object, and mutating it afterwards reaches in here.
   * Hand over literals, or freeze your own.
   */
  readonly value: Criteria<T>;

  constructor(written: Criteria<T> = {}) {
    this.value = Object.freeze({ ...written });
  }

  /** What `JSON.stringify` writes out: the criteria, not the builder. */
  toJSON(): Criteria<T> {
    return this.value;
  }

  private with<N extends string = Totals>(part: Criteria<T>): CriteriaBuilder<T, N> {
    return new CriteriaBuilder<T, N>({ ...this.value, ...part });
  }

  /** The grouping, with one more thing said about it and nothing else lost. */
  private withGrouping(part: Grouping<T>): CriteriaBuilder<T, Totals> {
    return this.with({ grouping: { ...(this.value.grouping ?? {}), ...part } });
  }

  /**
   * The filter. **Accumulates with AND** — `.where(a).where(b)` is `a` and `b` — so a screen
   * derives from a base without overwriting it. To start over, derive from the base again: it
   * is still whole, because this is immutable.
   *
   * @example
   * // simple: one condition
   * .where(["encoding", "=", "utf-8"])
   *
   * @example
   * // medium: two conditions ANDed, one of them an OR
   * .where(
   *   ["encoding", "=", "utf-8"],
   *   where.any(["tags", "contains", "raw"], ["producer_id", "is null", true]),
   * )
   *
   * @example
   * // complex: AND(A, B, OR(AND(C, D), E), NOT(F)) — three levels of real nesting
   * .where(
   *   ["row_count", ">", 50],
   *   ["encoding", "!=", "latin-1"],
   *   where.any(
   *     where.all(["tags", "contains", "raw"], ["producer_id", "!=", null]),
   *     ["registered_at", ">=", "2026-03-01T00:00:00.000Z"],
   *   ),
   *   where.negate(["name", "like", "draft"]),
   * )
   */
  where(...parts: (Filter<T> | undefined)[]): CriteriaBuilder<T, Totals> {
    const where = combined<T>(this.value.where, ...parts);
    return this.with(where === undefined ? {} : { where });
  }

  /**
   * The ordering. **Replaces**: two orderings have no combination. Written as the line a URL
   * carries, with `-` for descending, or as the objects. With no arguments, it drops it.
   *
   * @example
   * .order("-registered_at", "name")
   */
  order(
    ...entries: (OrderBy<Fields<T>> | Sort<T> | readonly Sort<T>[])[]
  ): CriteriaBuilder<T, Totals> {
    const sorts = readSorts<T>(entries);
    const next = { ...this.value };
    if (sorts.length === 0) delete next.order;
    else next.order = sorts;
    return new CriteriaBuilder<T, Totals>(next);
  }

  /** How many rows a page brings. */
  limit(rows: number): CriteriaBuilder<T, Totals> {
    return this.with({ pagination: { ...(this.value.pagination ?? {}), limit: rows } });
  }

  /**
   * Where the page goes on: the cursor that came back with the previous one. `null` is the
   * first page.
   *
   * A cursor names the last ROW seen, so a row inserted mid-walk changes nothing.
   */
  cursor(token: string | null): CriteriaBuilder<T, Totals> {
    return this.with({
      pagination: { ...(this.value.pagination ?? {}), strategy: { token } },
    });
  }

  /**
   * The other strategy: counting rows from the start. It is what a grid jumping to page 7
   * needs, and it costs what it costs — the engine says so without dressing it up.
   */
  offset(rows: number): CriteriaBuilder<T, Totals> {
    return this.with({
      pagination: { ...(this.value.pagination ?? {}), strategy: { rows } },
    });
  }

  /**
   * What to bring of each record: field → how to bring it. **Replaces**, because a mask is
   * one thing; to cross two criteria there is {@link CriteriaBuilder.merge}.
   */
  specification(mask: Specification<T>): CriteriaBuilder<T, Totals> {
    return this.with({ specification: mask });
  }

  /**
   * How the result set is split. **In order and accumulating**: `.groupBy("encoding")` and
   * then `.groupBy({field: "registered_at", grain: "month"})` are two levels, and the engine
   * answers one statement per level.
   *
   * A level is a field, or a field with the grain a date is cut to — without a grain,
   * grouping by a date gives one bucket per row.
   *
   * @example
   * .groupBy("encoding", { field: "registered_at", grain: "month" })
   */
  groupBy(...levels: WrittenLevel<T>[]): CriteriaBuilder<T, Totals> {
    const written = levels.map((level) => readLevel<T>(level));
    return this.withGrouping({
      group_by: [...(this.value.grouping?.group_by ?? []), ...written],
    });
  }

  /**
   * The numbers every group answers, each under a name of yours.
   *
   * Added to the ones already asked for, and **the names are remembered**: they are what
   * {@link CriteriaBuilder.whereMeasures} and {@link CriteriaBuilder.orderGroups} offer.
   *
   * Every bucket answers `count` — how many rows it holds — without being asked.
   *
   * @example
   * // simple: one measure
   * .groupBy("encoding").measures({ total_rows: measure.sum("row_count") })
   *
   * @example
   * // medium: two measures, one used to filter the groups themselves
   * .groupBy("encoding")
   *   .measures({ total_rows: measure.sum("row_count"), avg_rows: measure.avg("row_count") })
   *   .whereMeasures(["total_rows", ">", 500])
   *
   * @example
   * // complex: two grouping levels, two measures, and both group-count and row-count paging
   * .groupBy("encoding", "producer_id")
   *   .measures({ total_rows: measure.sum("row_count"), avg_rows: measure.avg("row_count") })
   *   .whereMeasures(["total_rows", ">", 200])
   *   .orderGroups("-total_rows")
   *   .limitGroups(2) // at most 2 groups at THIS level, offset-paged, no cursor
   *   .limit(2) // at most 2 row ids per surviving group, cursor-paged
   */
  measures<Named extends string>(
    numbers: Record<Named, Measure<T>>,
  ): CriteriaBuilder<T, Totals | Named> {
    // Read here and not on the way out: a percentile with no fraction is a mistake made on
    // this line, and that is where it should fail.
    const read: Record<string, Measure<T>> = {};
    for (const [name, one] of Object.entries(numbers) as [string, Measure<T>][]) {
      read[name] = readMeasure<T>(one);
    }
    return this.with<Totals | Named>({
      grouping: {
        ...(this.value.grouping ?? {}),
        measures: { ...(this.value.grouping?.measures ?? {}), ...read },
      },
    });
  }

  /**
   * Filters the GROUPS by the numbers they measured — not the rows that made them, which is
   * what {@link CriteriaBuilder.where} does.
   *
   * It reads the names this criteria measured, plus `count`, and the editor offers exactly
   * those.
   *
   * @example
   * // simple: one measure, one condition on it
   * .groupBy("encoding").measures({ rows: measure.sum("row_count") }).whereMeasures(["rows", ">", 1000])
   *
   * @example
   * // medium: two conditions ANDed — a measure, and the free `count` every group answers
   * .groupBy("encoding")
   *   .measures({ rows: measure.sum("row_count") })
   *   .whereMeasures(["rows", ">", 1000], ["count", ">", 10])
   *
   * @example
   * // complex: applies at EVERY grouping level independently — a subgroup can be dropped
   * // here even when its parent group survives, because each level measures its own rows.
   * .groupBy("encoding", "producer_id")
   *   .measures({ total_rows: measure.sum("row_count") })
   *   .whereMeasures(["total_rows", ">", 200])
   * // a producer whose rows sum to 60 disappears from the second level even though the
   * // encoding it belongs to (summing everyone's rows) comfortably passes the same filter
   */
  whereMeasures(
    ...parts: (Filter<Record<Totals | "count", number>> | undefined)[]
  ): CriteriaBuilder<T, Totals> {
    const kept = combined(
      this.value.grouping?.where_measures,
      ...(parts as (Filter | undefined)[]),
    );
    return this.withGrouping(kept === undefined ? {} : { where_measures: kept });
  }

  /**
   * The order the GROUPS come back in — by a field of the record, by a number this criteria
   * measured, or by `count`, with `-` for descending.
   *
   * Not to be confused with {@link CriteriaBuilder.order}, which orders the ROWS: with a page
   * asked for, that one decides which rows each bucket shows first.
   *
   * @example
   * // simple: by count, descending
   * .groupBy("encoding").orderGroups("-count")
   *
   * @example
   * // medium: by a named measure instead
   * .groupBy("encoding").measures({ rows: measure.sum("row_count") }).orderGroups("-rows")
   *
   * @example
   * // complex: ordered, then only the top 2 groups are even answered — see {@link limitGroups}
   * .groupBy("producer_id")
   *   .measures({ total: measure.sum("row_count") })
   *   .orderGroups("-total")
   *   .limitGroups(2) // the group with the lowest total never appears in the answer at all
   */
  orderGroups(
    ...by: (OrderBy<Fields<T> | Totals | "count"> | Sort)[]
  ): CriteriaBuilder<T, Totals> {
    return this.withGrouping({ order: readSorts(by) as Sort[] });
  }

  /**
   * How many GROUPS of the first level come back, and after how many. Without this, every
   * group does.
   *
   * Groups are paged by counting and never by a cursor, and the engine is explicit about why:
   * ordering by an aggregate leaves no stable row to resume from. The deeper levels answer
   * only for the groups that survived this page.
   *
   * @example
   * // simple
   * .groupBy("encoding").limitGroups(10)
   *
   * @example
   * // medium: paired with an order, since "the first 10" only means something once ordered
   * .groupBy("encoding").orderGroups("-count").limitGroups(10)
   *
   * @example
   * // complex: not to be confused with `.limit()`, which pages the ROWS inside each surviving
   * // group. With 3 real groups (p1: total 950, p2: total 9700, null: total 1200):
   * .groupBy("producer_id")
   *   .measures({ total: measure.sum("row_count") })
   *   .orderGroups("-total")
   *   .limitGroups(2) // keeps p2 and null — "p1" is gone from the answer entirely
   *   .limit(2); // AND at most 2 row ids inside each of p2 and null
   * // → [{ value: "p2", count: 2, ... }, { value: null, count: 1, ... }] — no "p1" anywhere
   */
  limitGroups(groups: number): CriteriaBuilder<T, Totals> {
    return this.withGrouping({
      pagination: { ...(this.value.grouping?.pagination ?? {}), limit: groups },
    });
  }

  /**
   * How many GROUPS to count past before the page begins.
   *
   * There is no cursor here, and that is the engine's own decision: a cursor names a ROW, and
   * a group is a number over many rows — order the groups by a measure and one of them moves
   * as soon as a row changes, so there is nothing to resume past.
   *
   * @example
   * .orderGroups("-count").limitGroups(10).offsetGroups(20) // the third page of ten
   */
  offsetGroups(groups: number): CriteriaBuilder<T, Totals> {
    return this.withGrouping({
      pagination: { ...(this.value.grouping?.pagination ?? {}), strategy: { rows: groups } },
    });
  }

  /** How much counting costs: `none`, `capped` (stops at a ceiling and says so), `exact`. */
  counting(mode: CountMode): CriteriaBuilder<T, Totals> {
    return this.with({ count: mode });
  }

  /**
   * Whether the answer carries the model definition. Turning it off is paid for in surprise:
   * a client that turns it off cannot build its filter form from what it received.
   */
  meta(travels: boolean): CriteriaBuilder<T, Totals> {
    return this.with({ meta: travels });
  }

  /**
   * This criteria plus a more specific one, under the engine's law.
   *
   * This is the typed way to merge: the builder knows its record type and passes it on. The
   * bare {@link merge} function cannot infer it from two plain objects, so it merges them
   * untyped unless it is given an explicit type argument.
   */
  merge(other: CriteriaFor<T>): CriteriaBuilder<T, Totals> {
    return new CriteriaBuilder<T, Totals>(mergeCriterias<T>(this.value, plain<T>(other)));
  }
}

/**
 * A level as it is written: the field alone, the pair when a date is cut, or the object that
 * travels.
 *
 * @example
 * "encoding"
 * ["registered_at", "month"]
 */
export type WrittenLevel<T = AnyRecord> = Fields<T> | readonly [Fields<T>, Grain] | Level<T>;

/** A written level as the `{field, grain}` that travels. */
export function readLevel<T = AnyRecord>(written: WrittenLevel<T>): Level<T> {
  if (typeof written === "string") return { field: written };
  if (Array.isArray(written)) {
    const [field, grain] = written as readonly [Fields<T>, Grain];
    return { field, grain };
  }
  return written as Level<T>;
}

/** Sorts written as lines, as objects or as lists of them, read into the one shape. */
function readSorts<T>(
  entries: readonly (string | Sort<T> | readonly Sort<T>[])[],
): Sort<T>[] {
  return entries.flatMap((entry): Sort<T>[] => {
    if (typeof entry === "string") return parseOrder<T>(entry);
    if (Array.isArray(entry)) return [...(entry as readonly Sort<T>[])];
    return [entry as Sort<T>];
  });
}

export type { Pagination };
