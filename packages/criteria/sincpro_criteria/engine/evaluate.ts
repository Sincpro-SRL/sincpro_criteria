import { isDynamic } from "@sincpro/criteria/criteria/dynamic";
import type { Filter, Triple } from "@sincpro/criteria/criteria/filter";
import { isTriple, readFilter } from "@sincpro/criteria/criteria/filter";
import type { AnyRecord, Operator, Value } from "@sincpro/criteria/criteria/grammar";
import { InvalidCriteria } from "@sincpro/criteria/criteria/grammar";
import {
  compareValues,
  emptyList,
  isExact,
  missing,
  sameValue,
} from "@sincpro/criteria/engine/compare";
import type { ResolutionContext } from "@sincpro/criteria/engine/resolve";
import { resolve } from "@sincpro/criteria/engine/resolve";
import type { Meta } from "@sincpro/criteria/meta/meta";

/**
 * One comparison, the way the translator would have SQL answer it.
 *
 * @example
 * holds(3, ">", 1); // true
 * holds(null, ">", 1); // false — NULL compares to nothing
 * holds(null, "is null", true); // true
 * holds([], "=", []); // true — the empty-list question
 * holds("Labs 2024", "starts with", "lab"); // true — a prefix, case-insensitive
 * holds("a_b", "like", "a_b"); // true — `%` and `_` are the text itself, as SQL is told
 * holds("10.00", ">", "9.5", true); // true — a decimal field (`exact`) compares as numbers
 */
export function holds(
  actual: unknown,
  operator: Operator,
  value: Value,
  exact = false,
): boolean {
  if (operator === "is null") return value ? missing(actual) : !missing(actual);

  if (operator === "=" && emptyList(value)) {
    return missing(actual) || (Array.isArray(actual) && actual.length === 0);
  }
  if (operator === "!=" && emptyList(value)) {
    return !missing(actual) && !(Array.isArray(actual) && actual.length === 0);
  }

  if (missing(actual)) return false;

  switch (operator) {
    case "=":
      return sameValue(actual, value, exact);
    case "!=":
      return !sameValue(actual, value, exact);
    case "in":
      return asList(value).some((one) => sameValue(actual, one, exact));
    case "not in":
      return !asList(value).some((one) => sameValue(actual, one, exact));
    case ">":
      return compareValues(actual, value, exact) > 0;
    case ">=":
      return compareValues(actual, value, exact) >= 0;
    case "<":
      return compareValues(actual, value, exact) < 0;
    case "<=":
      return compareValues(actual, value, exact) <= 0;
    case "between": {
      const [from, to] = asList(value);
      return compareValues(actual, from, exact) >= 0 && compareValues(actual, to, exact) <= 0;
    }
    case "like":
      return String(actual).toLowerCase().includes(String(value).toLowerCase());
    case "starts with":
      return String(actual).toLowerCase().startsWith(String(value).toLowerCase());
    case "contains":
      return member(actual, value);
    case "not contains":
      return !member(actual, value);
    default:
      throw new InvalidCriteria(`no in-memory evaluation for operator '${operator}'`);
  }
}

/** Whether a written filter holds a value that is read before any row is, anywhere in it. */
function readsBeforeTheRow<T>(filter: Filter<T>): boolean {
  if (isTriple(filter)) return mustResolve(filter[2]);
  if ("all" in filter) return filter.all.some((part) => readsBeforeTheRow(part));
  if ("any" in filter) return filter.any.some((part) => readsBeforeTheRow(part));
  if ("negate" in filter) return readsBeforeTheRow(filter.negate);
  return mustResolve(filter.value);
}

function mustResolve(value: Value): boolean {
  if (Array.isArray(value)) return value.some((one) => mustResolve(one));
  return isDynamic(value) && value.$ !== "field";
}

/**
 * The filter as it is run: its dynamic values read, once. A filter with none is handed back
 * as it is, so the common case costs nothing per row.
 */
function ready<T>(filter: Filter<T>, resolution: ResolutionContext | undefined): Filter<T> {
  if (!readsBeforeTheRow(filter)) return filter;
  return resolve(readFilter(filter), resolution) as Filter<T>;
}

/** The value a condition compares against: itself, or another field of the same row. */
function comparedWith(record: AnyRecord, value: Value): Value {
  return isDynamic(value) && value.$ === "field" ? (record[value.name] as Value) : value;
}

function answers<T>(record: T, filter: Filter<T>, meta?: Meta): boolean {
  if (isTriple(filter)) {
    const [field, operator, value] = filter as Triple<T>;
    return holdsOver(record as AnyRecord, field, operator, value, meta);
  }
  if ("all" in filter) return filter.all.every((part) => answers(record, part, meta));
  if ("any" in filter) return filter.any.some((part) => answers(record, part, meta));
  if ("negate" in filter) return !answers(record, filter.negate, meta);
  return holdsOver(record as AnyRecord, filter.field, filter.operator, filter.value, meta);
}

function holdsOver(
  record: AnyRecord,
  field: string,
  operator: Operator,
  value: Value,
  meta?: Meta,
): boolean {
  const other = comparedWith(record, value);
  // A column against a column that holds nothing is not true and not false, as in SQL.
  if (other === null && value !== null) return false;
  return holds(record[field], operator, other, isExact(meta, field));
}

/**
 * Whether this record answers the filter. No filter is answered by everything.
 *
 * It takes a filter as it is WRITTEN — triples included — and reads the leaves where it finds
 * them instead of building another tree first: a filter is walked once per row, and a copy
 * per row is a copy too many.
 *
 * A dynamic value (`today`, the user) is read first, with the `resolution` given. Without one it
 * is read at this moment in UTC; pass one to pin the day — and for `context`, which holds only
 * what the caller puts in it. A `field` value is the row's own: it reads the other column of
 * this record.
 *
 * With the model's `meta`, a field it marks `exact` (a decimal, sent as text so no digit is
 * lost) is compared as a number: `"10.00"` is more than `"9.5"` and equal to `"10.0"`.
 * Without it, values compare as they are — which is what a field nobody described can do.
 *
 * @example
 * matches(dataset, ["row_count", ">", 1000]);
 * matches(dataset, where.any(["tags", "contains", "raw"], ["producer_id", "is null", true]));
 * matches(invoice, ["amount", ">", "100.00"], meta); // `amount` is exact: compared as a number
 * matches(invoice, ["due", "<", dynamic.today()], meta, { now }); // read on the day `now` says
 */
export function matches<T = AnyRecord>(
  record: T,
  filter: Filter<T> | undefined,
  meta?: Meta,
  resolution?: ResolutionContext,
): boolean {
  if (filter === undefined) return true;
  return answers(record, ready(filter, resolution), meta);
}

/**
 * Every record that answers the filter, in the order they were given. A dynamic value is read
 * once, not once per row.
 */
export function filtered<T = AnyRecord>(
  rows: readonly T[],
  filter: Filter<T> | undefined,
  meta?: Meta,
  resolution?: ResolutionContext,
): T[] {
  if (filter === undefined) return [...rows];
  const run = ready(filter, resolution);
  return rows.filter((row) => answers(row, run, meta));
}

function asList(value: Value): Value[] {
  return Array.isArray(value) ? value : [value];
}

/** `contains` asks about one member: of a list, or of a text. */
function member(actual: unknown, value: Value): boolean {
  if (Array.isArray(actual)) return actual.some((one) => sameValue(one, value));
  if (typeof actual === "string") return actual.includes(String(value));
  return false;
}
