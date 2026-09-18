/**
 * The numbers a bucket folds out of its rows.
 *
 * A missing value is left out of the fold rather than counted as zero: an average over rows
 * that hold no value is an average over fewer rows, not an average dragged towards nothing.
 *
 * @module
 */

import type { AnyRecord, Fold, FoldFunction } from "@sincpro/criteria/criteria/grammar";
import { compareValues, missing } from "@sincpro/criteria/engine/compare";

const FOLDS: Record<FoldFunction, (values: unknown[]) => unknown> = {
  count: (values) => values.length,
  sum: (values) => values.reduce<number>((total, one) => total + Number(one), 0),
  min: (values) => (values.length === 0 ? null : values.reduce(pick(-1))),
  max: (values) => (values.length === 0 ? null : values.reduce(pick(1))),
  avg: (values) =>
    values.length === 0
      ? null
      : values.reduce<number>((total, one) => total + Number(one), 0) / values.length,
};

/**
 * Every fold a grouping asks for, over the rows of one bucket.
 *
 * @example
 * folded(rows, { rows: ["sum", "row_count"] }); // {rows: 4012933}
 */
export function folded<T = AnyRecord>(
  rows: readonly T[],
  totals: Record<string, Fold<T>> | undefined,
): Record<string, unknown> {
  const numbers: Record<string, unknown> = {};
  for (const [name, [aggregate, field]] of Object.entries(totals ?? {})) {
    const values = rows
      .map((row) => (row as AnyRecord)[field])
      .filter((one) => !missing(one));
    numbers[name] = FOLDS[aggregate](values);
  }
  return numbers;
}

function pick(side: number) {
  return (chosen: unknown, one: unknown) =>
    compareValues(one, chosen) === side ? one : chosen;
}
