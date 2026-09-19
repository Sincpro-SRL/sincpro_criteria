import type { Filter, Triple } from "@sincpro/criteria/criteria/filter";
import { isTriple } from "@sincpro/criteria/criteria/filter";
import type { AnyRecord, Operator, Value } from "@sincpro/criteria/criteria/grammar";
import { InvalidCriteria } from "@sincpro/criteria/criteria/grammar";
import {
  compareValues,
  emptyList,
  missing,
  sameValue,
} from "@sincpro/criteria/engine/compare";

/**
 * One comparison, the way the translator would have SQL answer it.
 *
 * @example
 * holds(3, ">", 1); // true
 * holds(null, ">", 1); // false — NULL compares to nothing
 * holds(null, "is null", true); // true
 * holds([], "=", []); // true — the empty-list question
 */
export function holds(actual: unknown, operator: Operator, value: Value): boolean {
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
      return sameValue(actual, value);
    case "!=":
      return !sameValue(actual, value);
    case "in":
      return asList(value).some((one) => sameValue(actual, one));
    case "not in":
      return !asList(value).some((one) => sameValue(actual, one));
    case ">":
      return compareValues(actual, value) > 0;
    case ">=":
      return compareValues(actual, value) >= 0;
    case "<":
      return compareValues(actual, value) < 0;
    case "<=":
      return compareValues(actual, value) <= 0;
    case "between": {
      const [from, to] = asList(value);
      return compareValues(actual, from) >= 0 && compareValues(actual, to) <= 0;
    }
    case "like":
      return String(actual).toLowerCase().includes(String(value).toLowerCase());
    case "contains":
      return member(actual, value);
    case "not contains":
      return !member(actual, value);
    default:
      throw new InvalidCriteria(`no in-memory evaluation for operator '${operator}'`);
  }
}

/**
 * Whether this record answers the filter. No filter is answered by everything.
 *
 * It takes a filter as it is WRITTEN — triples included — and reads the leaves where it finds
 * them instead of building another tree first: a filter is walked once per row, and a copy
 * per row is a copy too many.
 *
 * @example
 * matches(dataset, ["row_count", ">", 1000]);
 * matches(dataset, where.any(["tags", "contains", "raw"], ["producer_id", "is null", true]));
 */
export function matches<T = AnyRecord>(record: T, filter: Filter<T> | undefined): boolean {
  if (filter === undefined) return true;
  if (isTriple(filter)) {
    const [field, operator, value] = filter as Triple<T>;
    return holds((record as AnyRecord)[field], operator, value);
  }
  if ("all" in filter) return filter.all.every((part) => matches(record, part));
  if ("any" in filter) return filter.any.some((part) => matches(record, part));
  if ("negate" in filter) return !matches(record, filter.negate);
  return holds((record as AnyRecord)[filter.field], filter.operator, filter.value);
}

/** Every record that answers the filter, in the order they were given. */
export function filtered<T = AnyRecord>(
  rows: readonly T[],
  filter: Filter<T> | undefined,
): T[] {
  return filter === undefined ? [...rows] : rows.filter((row) => matches(row, filter));
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
