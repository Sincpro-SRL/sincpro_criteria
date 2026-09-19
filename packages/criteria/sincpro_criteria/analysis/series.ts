import { numberOf } from "@sincpro/criteria/analysis/derive";
import type { AnyRecord, Grain } from "@sincpro/criteria/criteria/grammar";
import { cutTo } from "@sincpro/criteria/engine/grain";
import type { Bucket } from "@sincpro/criteria/page/page";

/** Categories down one axis, and one series of numbers per measure asked for. */
export interface Series {
  categories: string[];
  series: { name: string; values: number[] }[];
}

/** How to read a level of groups as a chart. */
export interface SeriesOptions {
  /** Which measures become series. Without it, every measure the groups carry, plus `count`. */
  measures?: string[];

  /** What a group with no value is called. */
  empty?: string;
}

/**
 * One level of groups as categories and series.
 *
 * @example
 * asSeries(byMonth, { measures: ["total"] });
 * // {categories: ["2026-01", "2026-02"], series: [{name: "total", values: [65000, 30000]}]}
 */
export function asSeries<T = AnyRecord>(
  level: readonly Bucket<T>[],
  options: SeriesOptions = {},
): Series {
  const names = options.measures ?? namesIn(level);
  return {
    categories: level.map((one) => labelOf(one.value, options.empty)),
    series: names.map((name) => ({
      name,
      values: level.map((one) => numberOf(one, name)),
    })),
  };
}

/**
 * The same, for a level whose groups have a level below: the categories are the outer groups
 * and there is one series per inner group — the stacked bar, the grouped bar, the multi-line.
 *
 * A group that answered nothing for an inner category gets a zero, because a chart cannot
 * leave a hole in the middle of a stack.
 *
 * @example
 * asStackedSeries(byJournalThenMonth, { measure: "total" });
 * // {categories: ["SAL", "PUR"], series: [{name: "2026-01", values: [65000, 0]}, …]}
 */
export function asStackedSeries<T = AnyRecord>(
  level: readonly Bucket<T>[],
  options: { measure?: string; empty?: string } = {},
): Series {
  const measure = options.measure ?? "count";
  const inner: string[] = [];
  for (const bucket of level) {
    for (const one of bucket.groups ?? []) {
      const name = labelOf(one.value, options.empty);
      if (!inner.includes(name)) inner.push(name);
    }
  }

  return {
    categories: level.map((one) => labelOf(one.value, options.empty)),
    series: inner.map((name) => ({
      name,
      values: level.map((bucket) => {
        const found = (bucket.groups ?? []).find(
          (one) => labelOf(one.value, options.empty) === name,
        );
        return found === undefined ? 0 : numberOf(found, measure);
      }),
    })),
  };
}

/** The range a series covers, and what a group that is missing from it holds. */
export interface GapOptions {
  grain: Grain;
  from: Date | string;
  to: Date | string;

  /** What the invented groups measure. Zero for every measure, unless said otherwise. */
  measures?: Record<string, unknown>;
}

/**
 * The same groups with the empty periods put back.
 *
 * A grouping answers what the rows said; a month with no rows is not a group, it is an
 * absence. A chart that skips it draws a line from January to March as though February had
 * been the same — so the absence has to be made explicit, and only the caller knows the range
 * it was asking about.
 *
 * The invented groups carry `count: 0`, the measures at zero, and **the criteria of the group
 * that would have been**: opening one answers an empty page rather than failing.
 *
 * @example
 * fillGaps(byMonth, { grain: "month", from: "2026-01-01", to: "2026-04-01" });
 * // the months that answered, plus the ones that did not, in order
 */
export function fillGaps<T = AnyRecord>(
  level: readonly Bucket<T>[],
  options: GapOptions,
): Bucket<T>[] {
  const field = level[0]?.field ?? "";
  const answered = new Map(level.map((one) => [String(one.value), one]));

  const filled: Bucket<T>[] = [];
  for (const label of everyPeriod(options.grain, options.from, options.to)) {
    const found = answered.get(label);
    filled.push(
      found ?? {
        field,
        value: label,
        count: 0,
        measures: options.measures ?? zeroed(level),
        criteria: {} as Bucket<T>["criteria"],
        ids: [],
        cursor: null,
        groups: [],
      },
    );
  }
  return filled;
}

/** Every label of a grain between two instants, in order and both ends included. */
function everyPeriod(grain: Grain, from: Date | string, to: Date | string): string[] {
  const start = new Date(from);
  const end = new Date(to);
  const labels: string[] = [];
  const at = new Date(start.getTime());

  for (let guard = 0; guard < 10000 && at.getTime() <= end.getTime(); guard += 1) {
    const label = String(cutTo(at, grain));
    if (!labels.includes(label)) labels.push(label);
    step(at, grain);
  }
  return labels;
}

function step(at: Date, grain: Grain): void {
  switch (grain) {
    case "year":
      at.setUTCFullYear(at.getUTCFullYear() + 1);
      return;
    case "month":
      at.setUTCMonth(at.getUTCMonth() + 1);
      return;
    case "week":
      at.setUTCDate(at.getUTCDate() + 7);
      return;
    case "day":
      at.setUTCDate(at.getUTCDate() + 1);
  }
}

function zeroed<T>(level: readonly Bucket<T>[]): Record<string, number> {
  const numbers: Record<string, number> = {};
  for (const name of namesIn(level)) numbers[name] = 0;
  return numbers;
}

function namesIn<T>(level: readonly Bucket<T>[]): string[] {
  const names = new Set<string>();
  for (const bucket of level) {
    for (const name of Object.keys(bucket.measures ?? {})) names.add(name);
  }
  return names.size === 0 ? ["count"] : [...names];
}

function labelOf(value: unknown, empty = "—"): string {
  if (value === null || value === undefined) return empty;
  return value instanceof Date ? value.toISOString() : String(value);
}
