import { conditionsOf, isAll } from "@sincpro/criteria/criteria/expression";
import type { AnyRecord, Expression, Grain, Level } from "@sincpro/criteria/criteria/grammar";
import { InvalidCriteria } from "@sincpro/criteria/criteria/grammar";
import { readInstant } from "@sincpro/criteria/engine/temporal";
import type { FieldMeta } from "@sincpro/criteria/meta/meta";

/** The numbers each part can take, for the groups a `fill` lists; a year has no fixed range. */
const PART_RANGES: Record<string, readonly [number, number] | undefined> = {
  quarter: [1, 4],
  month: [1, 12],
  iso_week: [1, 53],
  day_of_week: [1, 7],
  day_of_month: [1, 31],
  hour: [0, 23],
};

/**
 * The range a filter holds a date field to, `[low, high)`, when it bounds BOTH ends.
 *
 * Only what every row must meet counts — the parts of an `all` — and `between` is closed at both
 * ends, so its upper bound is nudged to the instant after it.
 */
function boundsOf(
  expression: Expression | undefined,
  field: string,
): [Date, Date] | undefined {
  if (expression === undefined) return undefined;
  const parts = isAll(expression) ? expression.all : [expression];
  let low: Date | undefined;
  let high: Date | undefined;
  for (const part of parts) {
    for (const one of conditionsOf(part)) {
      if (one.field !== field || part !== one) continue;
      const at = (value: unknown): Date => {
        const read = readInstant(value);
        if (read === undefined) {
          throw new InvalidCriteria(`a date range is bounded by dates; got ${String(value)}`);
        }
        return read;
      };
      if (one.operator === ">=" || one.operator === ">") low = at(one.value);
      else if (one.operator === "<") high = at(one.value);
      else if (one.operator === "<=") high = new Date(at(one.value).getTime() + 1);
      else if (one.operator === "between" && Array.isArray(one.value)) {
        low = at(one.value[0]);
        high = new Date(at(one.value[1]).getTime() + 1);
      }
    }
  }
  return low !== undefined && high !== undefined ? [low, high] : undefined;
}

function startOf(at: Date, grain: Grain): Date {
  const year = at.getUTCFullYear();
  const month = at.getUTCMonth();
  switch (grain) {
    case "year":
      return new Date(Date.UTC(year, 0, 1));
    case "quarter":
      return new Date(Date.UTC(year, Math.floor(month / 3) * 3, 1));
    case "month":
      return new Date(Date.UTC(year, month, 1));
    case "week": {
      const day = new Date(Date.UTC(year, month, at.getUTCDate()));
      day.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7));
      return day;
    }
    case "day":
      return new Date(Date.UTC(year, month, at.getUTCDate()));
  }
}

function after(at: Date, grain: Grain): Date {
  const next = new Date(at.getTime());
  switch (grain) {
    case "year":
      next.setUTCFullYear(next.getUTCFullYear() + 1);
      break;
    case "quarter":
      next.setUTCMonth(next.getUTCMonth() + 3);
      break;
    case "month":
      next.setUTCMonth(next.getUTCMonth() + 1);
      break;
    case "week":
      next.setUTCDate(next.getUTCDate() + 7);
      break;
    case "day":
      next.setUTCDate(next.getUTCDate() + 1);
      break;
  }
  return next;
}

/** The text the engine writes for the grain a date falls in. */
function labelOf(start: Date, grain: Grain): string {
  const pad = (value: number): string => String(value).padStart(2, "0");
  switch (grain) {
    case "year":
      return String(start.getUTCFullYear());
    case "quarter":
      return `${start.getUTCFullYear()}-Q${Math.floor(start.getUTCMonth() / 3) + 1}`;
    case "month":
      return `${start.getUTCFullYear()}-${pad(start.getUTCMonth() + 1)}`;
    case "day":
      return start.toISOString().slice(0, 10);
    case "week": {
      const thursday = new Date(start.getTime());
      thursday.setUTCDate(thursday.getUTCDate() + 3);
      const firstThursday = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 4));
      firstThursday.setUTCDate(
        firstThursday.getUTCDate() - ((firstThursday.getUTCDay() + 6) % 7) + 3,
      );
      const week = 1 + Math.round((thursday.getTime() - firstThursday.getTime()) / 604800000);
      return `${thursday.getUTCFullYear()}-W${pad(week)}`;
    }
  }
}

/**
 * Every value a level can take, in ascending order — what `fill` lists so a group with no rows is
 * still a group.
 *
 * A date grain, and a year part, need the filter to bound the field at both ends: an axis with no
 * ends has no «every». A level with no choices to list is refused, naming what can be filled.
 *
 * @example
 * axisValues({ field: "status", fill: true }, statusMeta, undefined); // ["open", "paid", "overdue"]
 * axisValues({ field: "at", part: "month", fill: true }, atMeta, undefined); // 1 … 12
 */
export function axisValues<T = AnyRecord>(
  level: Level<T>,
  field: FieldMeta,
  where: Expression<T> | undefined,
): unknown[] {
  if (level.part != null) {
    const known = PART_RANGES[level.part];
    if (known !== undefined) {
      return Array.from({ length: known[1] - known[0] + 1 }, (_, index) => known[0] + index);
    }
    const span = boundsOf(where as Expression | undefined, level.field);
    if (span === undefined) {
      throw new InvalidCriteria(
        `'${level.field}' filled by year needs the filter to bound it at both ends`,
      );
    }
    const last = new Date(span[1].getTime() - 1).getUTCFullYear();
    return Array.from(
      { length: last - span[0].getUTCFullYear() + 1 },
      (_, index) => span[0].getUTCFullYear() + index,
    );
  }

  if (level.grain != null) {
    const span = boundsOf(where as Expression | undefined, level.field);
    if (span === undefined) {
      throw new InvalidCriteria(
        `'${level.field}' filled by ${level.grain} needs the filter to bound it at both ends: ` +
          "the groups of an axis with no ends cannot be listed",
      );
    }
    const labels: string[] = [];
    const last = span[1].getTime() - 1;
    for (
      let at = startOf(span[0], level.grain);
      at.getTime() <= last;
      at = after(at, level.grain)
    ) {
      labels.push(labelOf(at, level.grain));
    }
    return labels;
  }

  if (field.type === "boolean") return [false, true];
  if (field.choices !== undefined && field.choices.length > 0) return [...field.choices];
  throw new InvalidCriteria(
    `'${level.field}' cannot be filled: it has no choices to list. Fill an enum, a boolean, a ` +
      "date part, or a date grain that the filter bounds",
  );
}
