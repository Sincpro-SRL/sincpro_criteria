import type { AnyRecord } from "@sincpro/criteria/criteria/grammar";
import type { Bucket } from "@sincpro/criteria/page/page";

/**
 * A number worked out for one group.
 *
 * It is given the group and the whole level it belongs to, because a share and a running sum
 * cannot be answered by looking at one group alone.
 */
export type Derivation<T = AnyRecord> = (
  bucket: Bucket<T>,
  level: readonly Bucket<T>[],
  at: number,
) => unknown;

/**
 * The same groups, each carrying the numbers named here beside the ones it measured.
 *
 * The groups are not touched: a new list of new objects comes back, with the levels below
 * derived the same way, so a tree renders from one call.
 *
 * @example
 * derive(buckets, { share: percentOfTotal("total") })[0].measures.share; // 0.42
 */
export function derive<T = AnyRecord>(
  level: readonly Bucket<T>[],
  numbers: Record<string, Derivation<T>>,
): Bucket<T>[] {
  return level.map((bucket, at) => {
    const derived: Record<string, unknown> = { ...(bucket.measures ?? {}) };
    for (const [name, of] of Object.entries(numbers)) {
      derived[name] = of(bucket, level, at);
    }
    return {
      ...bucket,
      measures: derived,
      ...(bucket.groups === undefined ? {} : { groups: derive(bucket.groups, numbers) }),
    };
  });
}

/**
 * What share of the level this group holds, between 0 and 1.
 *
 * @param measure - the name of the measure to share out, or `"count"` for the rows
 *
 * @example
 * derive(buckets, { share: percentOfTotal("total") });
 */
export function percentOfTotal<T = AnyRecord>(measure: string): Derivation<T> {
  return (bucket, level) => {
    const whole = level.reduce((total, one) => total + numberOf(one, measure), 0);
    return whole === 0 ? 0 : numberOf(bucket, measure) / whole;
  };
}

/**
 * This group's number plus every one before it, **in the order the groups came back**.
 *
 * Which is why the ordering matters: a running total over groups ordered by size is not a
 * running total over groups ordered by month.
 *
 * @example
 * derive(byMonth, { running: cumulative("total") });
 */
export function cumulative<T = AnyRecord>(measure: string): Derivation<T> {
  return (_bucket, level, at) =>
    level.slice(0, at + 1).reduce((total, one) => total + numberOf(one, measure), 0);
}

/**
 * How this group compares with the one before it, as a fraction: `0.1` is ten percent more.
 *
 * The first group has nothing to compare against and answers `null` rather than zero, which
 * would read as "it did not change".
 */
export function changeFromPrevious<T = AnyRecord>(measure: string): Derivation<T> {
  return (bucket, level, at) => {
    if (at === 0) return null;
    const before = numberOf(level[at - 1]!, measure);
    if (before === 0) return null;
    return (numberOf(bucket, measure) - before) / before;
  };
}

/** The ranking of this group within its level, `1` being the first one that came back. */
export function rank<T = AnyRecord>(): Derivation<T> {
  return (_bucket, _level, at) => at + 1;
}

/** One measure of a group as a number, with an empty one reading as zero. */
export function numberOf<T>(bucket: Bucket<T>, measure: string): number {
  if (measure === "count") return bucket.count;
  const value = bucket.measures?.[measure];
  return value === null || value === undefined ? 0 : Number(value);
}
