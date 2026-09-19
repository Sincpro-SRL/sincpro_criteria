import type { AnyRecord, Measure, MeasureFunction } from "@sincpro/criteria/criteria/grammar";
import { compareValues, missing } from "@sincpro/criteria/engine/compare";

/**
 * The value at a fraction of the sorted values, interpolating between the two it falls
 * between — the same `percentile_cont` a database computes, so a reading answered here and
 * answered by Postgres says the same number.
 *
 * @example
 * percentileOf([1, 2, 3, 4], 0.5); // 2.5
 */
function percentileOf(values: unknown[], fraction: number): unknown {
  if (values.length === 0) return null;
  const ordered = [...values].sort((mine, theirs) => compareValues(mine, theirs));
  const at = fraction * (ordered.length - 1);
  const below = Math.floor(at);
  const above = Math.min(below + 1, ordered.length - 1);
  if (below === above) return ordered[below];
  return (
    Number(ordered[below]) + (Number(ordered[above]) - Number(ordered[below])) * (at - below)
  );
}

const MEASURES: Record<MeasureFunction, (values: unknown[]) => unknown> = {
  count: (values) => values.length,
  count_distinct: (values) => new Set(values.map((one) => JSON.stringify(one))).size,
  percentile: (values) => percentileOf(values, 0.5),
  sum: (values) => values.reduce<number>((total, one) => total + Number(one), 0),
  min: (values) => (values.length === 0 ? null : values.reduce(pick(-1))),
  max: (values) => (values.length === 0 ? null : values.reduce(pick(1))),
  avg: (values) =>
    values.length === 0
      ? null
      : values.reduce<number>((total, one) => total + Number(one), 0) / values.length,
};

/**
 * Every measure a grouping asks for, over the rows of one bucket.
 *
 * @example
 * measured(rows, { rows: measure.sum("row_count") }); // {rows: 4012933}
 */
export function measured<T = AnyRecord>(
  rows: readonly T[],
  measures: Record<string, Measure<T>> | undefined,
): Record<string, unknown> {
  const numbers: Record<string, unknown> = {};
  for (const [name, one] of Object.entries(measures ?? {}) as [string, Measure<T>][]) {
    const values = rows
      .map((row) => (row as AnyRecord)[one.field])
      .filter((value) => !missing(value));
    numbers[name] =
      one.function === "percentile"
        ? percentileOf(values, one.argument ?? 0.5)
        : MEASURES[one.function](values);
  }
  return numbers;
}

function pick(side: number) {
  return (chosen: unknown, one: unknown) =>
    compareValues(one, chosen) === side ? one : chosen;
}
