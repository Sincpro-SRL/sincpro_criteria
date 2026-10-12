import type {
  AnyRecord,
  Dynamic,
  Fields,
  FromContext,
  FromField,
  Grain,
  Now,
  Param,
  PeriodName,
  Span,
  Today,
  Unit,
  Value,
  WindowPeriod,
} from "@sincpro/criteria/criteria/grammar";
import {
  DYNAMIC_KINDS,
  GRAINS,
  InvalidCriteria,
  PERIODS,
  UNITS,
} from "@sincpro/criteria/criteria/grammar";

/**
 * How a date-valued dynamic value moves, written the way a person says it.
 *
 * `minus` and `startOf` are only a way of writing: what travels is the signed `plus` and
 * `start_of`, so there is one spelling on the wire. `plus` is applied first, then `startOf`.
 */
export interface Shift {
  /** How far forward, by unit: `{days: 7}`. */
  plus?: Span;

  /** How far back, by unit: `{days: 30}` is thirty days ago. */
  minus?: Span;

  /** The start of the calendar unit it falls in once moved. */
  startOf?: Grain;
}

/**
 * A window of whole units counted from the current one: the `last` N before it or the `next` N
 * after it. The current unit is left out unless `includeCurrent`.
 */
export type Window = { unit: Grain; includeCurrent?: boolean } & (
  { last: number; next?: never } | { next: number; last?: never }
);

/**
 * What a dynamic value does besides being itself, as it travels: only the units and the snap
 * that were asked for.
 */
function shifted(shift: Shift): { plus?: Span; start_of?: Grain } {
  const plus: Span = {};
  for (const unit of UNITS) {
    const amount = (shift.plus?.[unit] ?? 0) - (shift.minus?.[unit] ?? 0);
    if (amount !== 0) plus[unit] = amount;
  }
  return {
    ...(Object.keys(plus).length > 0 ? { plus } : {}),
    ...(shift.startOf === undefined ? {} : { start_of: shift.startOf }),
  };
}

/**
 * The current date, read by the server in its context's timezone.
 *
 * It computes nothing: it is the object `{"$": "today"}`, and the server reads it when the
 * filter runs. A saved view that holds it means the day it is opened.
 *
 * @example
 * ["due", "<", dynamic.today()];
 * ["created_at", ">=", dynamic.today({ minus: { days: 30 } })];
 * ["posted_at", ">=", dynamic.today({ startOf: "month" })];
 */
function today(shift: Shift = {}): Today {
  return { $: "today", ...shifted(shift) };
}

/**
 * The current instant, in UTC.
 *
 * @example
 * ["seen_at", ">=", dynamic.now({ minus: { hours: 2 } })];
 */
function now(shift: Shift = {}): Now {
  return { $: "now", ...shifted(shift) };
}

/**
 * A value of the SERVER's context: the user, the tenant, a date it holds. A client cannot say
 * who it is: the server reads the key from its own context and never from what is sent.
 *
 * @example
 * ["owner_id", "=", dynamic.context("user_id")];
 * ["closed_at", ">=", dynamic.context("report_date", { minus: { months: 3 }, startOf: "month" })];
 */
function context(key: string, shift: Shift = {}): FromContext {
  return { $: "context", key, ...shifted(shift) };
}

/**
 * A value the caller supplied for this call. `name` may be a path with dots.
 *
 * @example
 * ["total", ">", dynamic.param("steps.order.total")];
 */
function param(name: string, shift: Shift = {}): Param {
  return { $: "param", name, ...shifted(shift) };
}

/**
 * A span of the calendar as a range `[start, end)`: only with the operator `between`.
 *
 * Either a name, or a window of whole units counted from the current one.
 *
 * @example
 * ["closed_at", "between", dynamic.period("this_month")];
 * ["closed_at", "between", dynamic.period({ unit: "day", last: 30 })];
 * ["due", "between", dynamic.period({ unit: "week", next: 2, includeCurrent: true })];
 *
 * @throws {InvalidCriteria} when a name is not one the engine declares, or a window counts less
 * than one unit.
 */
function period(name: PeriodName): { $: "period"; name: PeriodName };
function period(window: Window): WindowPeriod;
function period(
  written: PeriodName | Window,
): { $: "period"; name: PeriodName } | WindowPeriod {
  if (typeof written === "string") {
    if (!(PERIODS as readonly string[]).includes(written)) {
      throw new InvalidCriteria(
        `'${written}' is not a period the engine declares; use one of ${PERIODS.join(", ")}`,
      );
    }
    return { $: "period", name: written };
  }
  const count = written.last ?? written.next;
  if (!Number.isInteger(count) || (count as number) < 1) {
    throw new InvalidCriteria(`a period counts at least one unit; got ${String(count)}`);
  }
  return {
    $: "period",
    unit: written.unit,
    ...(written.last === undefined ? { next: written.next } : { last: written.last }),
    ...(written.includeCurrent ? { include_current: true } : {}),
  } as WindowPeriod;
}

/**
 * Another field of the SAME row: a column against a column. It is not read before the row, and
 * takes `=`, `!=`, `<`, `<=`, `>` and `>=` against a field of the same type.
 *
 * @example
 * ["total", ">", dynamic.field<Invoice>("credit_limit")];
 */
function field<T = AnyRecord>(name: NoInfer<Fields<T>>): FromField {
  return { $: "field", name };
}

/**
 * The values that are read when a filter runs, under one name.
 *
 * A namespace and not loose exports: `today`, `now` and `field` are words every codebase
 * already has, and one import offers all of them as soon as the dot is typed. Every one returns
 * a plain object that serialises as it is — nothing is computed here: the server resolves, with
 * its own clock, its own timezone and its own context.
 *
 * @example
 * criteria<Invoice>().where(
 *   ["due", "<", dynamic.today()],
 *   ["owner_id", "=", dynamic.context("user_id")],
 *   ["posted_at", ">=", dynamic.today({ minus: { days: 30 } })],
 * );
 */
export const dynamic = { today, now, context, param, period, field } as const;

/**
 * Whether a value is one the server reads when the filter runs, rather than a literal.
 *
 * @example
 * isDynamic({ $: "today" }); // true
 * isDynamic({ today: 1 }); // false — an object without the reserved key is a literal
 */
export function isDynamic(value: unknown): value is Dynamic {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    !(value instanceof Date) &&
    "$" in value &&
    (DYNAMIC_KINDS as readonly unknown[]).includes((value as { $: unknown }).$)
  );
}

/**
 * A value that came from outside — a URL, local storage, another service — with every dynamic
 * value in it checked, or an {@link InvalidCriteria} naming what is wrong.
 *
 * A literal passes untouched, and so does a list of them; a list may hold dynamic values.
 *
 * @throws {InvalidCriteria} when a `"$"` names something the engine does not resolve, or a value
 * lacks what it needs.
 */
export function readValue(value: unknown): Value {
  if (Array.isArray(value)) return value.map((one) => readValue(one));
  if (value === null || typeof value !== "object" || value instanceof Date) {
    return value as Value;
  }
  if (!("$" in value)) return value as Value;

  const kind = (value as { $: unknown }).$;
  if (!isDynamic(value)) {
    throw new InvalidCriteria(
      `'${String(kind)}' is not a value the engine resolves; use one of ${DYNAMIC_KINDS.join(", ")}`,
    );
  }
  const written = value as unknown as Record<string, unknown>;
  const needs = { context: "key", param: "name", field: "name" }[value.$ as string];
  if (needs !== undefined && typeof written[needs] !== "string") {
    throw new InvalidCriteria(`a '${value.$}' value carries a '${needs}', a text`);
  }
  if (value.$ === "period") {
    const named = written.name !== undefined;
    const counted = [written.last, written.next].filter((one) => one !== undefined);
    if (named) {
      period(written.name as PeriodName);
      if (written.unit !== undefined || counted.length > 0 || written.include_current) {
        throw new InvalidCriteria(
          "a named period takes nothing else; `unit`, `last`, `next` and `include_current` " +
            "describe a window",
        );
      }
    } else if (
      typeof written.unit !== "string" ||
      !(GRAINS as readonly string[]).includes(written.unit) ||
      counted.length !== 1
    ) {
      throw new InvalidCriteria(
        'a period is a name, or a unit with `last` or `next`: {"$": "period", "unit": "day", "last": 30}',
      );
    } else if (!Number.isInteger(counted[0]) || (counted[0] as number) < 1) {
      throw new InvalidCriteria(
        `a period counts at least one unit; got ${String(counted[0])}`,
      );
    }
  }
  for (const part of ["plus"] as const) {
    const span = written[part];
    if (span === undefined) continue;
    for (const unit of Object.keys(span as object)) {
      if (!(UNITS as readonly string[]).includes(unit as Unit)) {
        throw new InvalidCriteria(
          `'${unit}' is not a unit of a span; use one of ${UNITS.join(", ")}`,
        );
      }
    }
  }
  if (
    written.start_of !== undefined &&
    !(GRAINS as readonly unknown[]).includes(written.start_of)
  ) {
    throw new InvalidCriteria(
      `'${String(written.start_of)}' is not a granularity; use one of ${GRAINS.join(", ")}`,
    );
  }
  return value;
}
