/**
 * The filter language answered in memory, over records already in hand.
 *
 * The same `Expression` a server translates to SQL, evaluated with a property read and a
 * comparison. Two reasons it exists: a criteria can be tested without a server, and a list
 * already in hand can narrow itself by the same filter a caller would have sent.
 *
 * **It agrees with SQL, including where SQL is odd.** A `NULL` compared with anything is
 * neither true nor false, so the row is excluded; here a missing value fails every operator
 * except `is null` and the empty-list question, which the engine's translator special-cases
 * the same way.
 *
 * Values are expected in the field's own type. A condition that arrived as text from a URL
 * goes through {@link validate} first, which is what reads `"1000"` into `1000`.
 *
 * @module
 */

import { isAll, isAny, isCondition } from "@sincpro/criteria/criteria/expression";
import type {
  AnyRecord,
  Expression,
  Operator,
  Value,
} from "@sincpro/criteria/criteria/grammar";
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

/** Whether this record answers the filter. No filter is answered by everything. */
export function matches<T = AnyRecord>(
  record: T,
  expression: Expression<T> | undefined,
): boolean {
  if (expression === undefined) return true;
  if (isCondition(expression)) {
    return holds(
      (record as AnyRecord)[expression.field],
      expression.operator,
      expression.value,
    );
  }
  if (isAll(expression)) return expression.all.every((part) => matches(record, part));
  if (isAny(expression)) return expression.any.some((part) => matches(record, part));
  return !matches(record, expression.negate);
}

/** Every record that answers the filter, in the order they were given. */
export function filtered<T = AnyRecord>(
  rows: readonly T[],
  expression: Expression<T> | undefined,
): T[] {
  return expression === undefined
    ? [...rows]
    : rows.filter((row) => matches(row, expression));
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
