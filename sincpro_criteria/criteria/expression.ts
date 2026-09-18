/**
 * Writing a filter: one condition, and how conditions combine.
 *
 * A condition is `{field, operator, value}` and a group is `{all}`, `{any}` or `{negate}`.
 * **There is no other form.** These functions do not add a second way of saying it: they
 * save writing the object by hand and, above all, they put the rules about what happens to
 * empty parts in one place.
 *
 * @module
 */

import type {
  AnyRecord,
  Condition,
  Expression,
  Fields,
  Operator,
  Value,
} from "@sincpro/criteria/criteria/grammar";
import { InvalidCriteria, isOperator } from "@sincpro/criteria/criteria/grammar";

/**
 * Any condition. The ones below are this one with the operator filled in.
 *
 * @example
 * condition("row_count", ">", 1000); // {field: "row_count", operator: ">", value: 1000}
 */
export function condition<T = AnyRecord>(
  field: NoInfer<Fields<T>>,
  operator: Operator,
  value: Value,
): Condition<T> {
  return { field, operator, value };
}

/** Equality. */
export function eq<T = AnyRecord>(field: NoInfer<Fields<T>>, value: Value): Condition<T> {
  return { field, operator: "=", value };
}

/** Inequality. */
export function ne<T = AnyRecord>(field: NoInfer<Fields<T>>, value: Value): Condition<T> {
  return { field, operator: "!=", value };
}

/** Greater than. */
export function gt<T = AnyRecord>(field: NoInfer<Fields<T>>, value: Value): Condition<T> {
  return { field, operator: ">", value };
}

/** Greater than or equal. */
export function gte<T = AnyRecord>(field: NoInfer<Fields<T>>, value: Value): Condition<T> {
  return { field, operator: ">=", value };
}

/** Less than. */
export function lt<T = AnyRecord>(field: NoInfer<Fields<T>>, value: Value): Condition<T> {
  return { field, operator: "<", value };
}

/** Less than or equal. */
export function lte<T = AnyRecord>(field: NoInfer<Fields<T>>, value: Value): Condition<T> {
  return { field, operator: "<=", value };
}

/** One of these values. */
export function oneOf<T = AnyRecord>(
  field: NoInfer<Fields<T>>,
  values: Value[],
): Condition<T> {
  return { field, operator: "in", value: values };
}

/** None of these values. */
export function notOneOf<T = AnyRecord>(
  field: NoInfer<Fields<T>>,
  values: Value[],
): Condition<T> {
  return { field, operator: "not in", value: values };
}

/** Text match, as the engine's `like` defines it. */
export function like<T = AnyRecord>(field: NoInfer<Fields<T>>, value: string): Condition<T> {
  return { field, operator: "like", value };
}

/** Asks about ONE member of a list column, not about the list as a whole. */
export function contains<T = AnyRecord>(
  field: NoInfer<Fields<T>>,
  value: Value,
): Condition<T> {
  return { field, operator: "contains", value };
}

/** The negation of {@link contains}. */
export function notContains<T = AnyRecord>(
  field: NoInfer<Fields<T>>,
  value: Value,
): Condition<T> {
  return { field, operator: "not contains", value };
}

/**
 * "Is empty" / "is not empty". **The value IS the question**, not the field's type.
 *
 * @example
 * isNull("producer_id");        // rows with no producer
 * isNull("producer_id", false); // rows that have one
 */
export function isNull<T = AnyRecord>(field: NoInfer<Fields<T>>, empty = true): Condition<T> {
  return { field, operator: "is null", value: empty };
}

/** Between two bounds, both included. Two of them, not a list of arbitrary length. */
export function between<T = AnyRecord>(
  field: NoInfer<Fields<T>>,
  from: Value,
  to: Value,
): Condition<T> {
  return { field, operator: "between", value: [from, to] };
}

/** The negation of an expression, or nothing when there is nothing to negate. */
export function negate<T = AnyRecord>(
  part: Expression<T> | undefined,
): Expression<T> | undefined {
  return part === undefined ? undefined : { negate: part };
}

/**
 * AND between whatever is left.
 *
 * One condition needs no wrapper, and **none is not a filter**: an empty `all` matches
 * everything, which is the opposite of what somebody who asked for nothing wanted.
 *
 * @example
 * all(eq("kind", "book"), undefined); // {field: "kind", operator: "=", value: "book"}
 * all();                              // undefined
 */
export function all<T = AnyRecord>(
  ...parts: (Expression<T> | undefined)[]
): Expression<T> | undefined {
  const kept = parts.filter((one): one is Expression<T> => one !== undefined);
  if (kept.length === 0) return undefined;
  if (kept.length === 1) return kept[0];
  return { all: kept };
}

/** OR between whatever is left: ticking another option of the same axis shows MORE. */
export function any<T = AnyRecord>(
  ...parts: (Expression<T> | undefined)[]
): Expression<T> | undefined {
  const kept = parts.filter((one): one is Expression<T> => one !== undefined);
  if (kept.length === 0) return undefined;
  if (kept.length === 1) return kept[0];
  return { any: kept };
}

/**
 * The AND of whatever is not empty, kept FLAT.
 *
 * This is {@link all} with one difference that matters: an incoming `all` is spliced instead
 * of nested. Criteria get merged repeatedly — a saved reading, what the user typed, what the
 * screen always adds — and wrapping each merge nests the tree as deep as the number of
 * merges, for a query that is one `WHERE`.
 *
 * @example
 * combined({all: [a, b]}, c); // {all: [a, b, c]}, not {all: [{all: [a, b]}, c]}
 */
export function combined<T = AnyRecord>(
  ...expressions: (Expression<T> | undefined)[]
): Expression<T> | undefined {
  const parts: Expression<T>[] = [];
  for (const expression of expressions) {
    if (expression === undefined) continue;
    if (isAll(expression)) parts.push(...expression.all);
    else parts.push(expression);
  }
  if (parts.length === 0) return undefined;
  if (parts.length === 1) return parts[0];
  return { all: parts };
}

/** Whether this node is a condition rather than a group. */
export function isCondition<T>(expression: Expression<T>): expression is Condition<T> {
  return "field" in expression;
}

/** Whether this node is an `all` group. */
export function isAll<T>(expression: Expression<T>): expression is { all: Expression<T>[] } {
  return "all" in expression;
}

/** Whether this node is an `any` group. */
export function isAny<T>(expression: Expression<T>): expression is { any: Expression<T>[] } {
  return "any" in expression;
}

/** Whether this node is a negation. */
export function isNegate<T>(
  expression: Expression<T>,
): expression is { negate: Expression<T> } {
  return "negate" in expression;
}

/**
 * Every leaf of a tree, in reading order. What a screen looks at to draw the filter chips
 * without understanding the tree's shape.
 *
 * @example
 * conditionsOf(all(any(a, b), negate(c))); // [a, b, c]
 */
export function conditionsOf<T = AnyRecord>(
  expression: Expression<T> | undefined,
): Condition<T>[] {
  if (expression === undefined) return [];
  if (isCondition(expression)) return [expression];
  if (isAll(expression)) return expression.all.flatMap((part) => conditionsOf(part));
  if (isAny(expression)) return expression.any.flatMap((part) => conditionsOf(part));
  return conditionsOf(expression.negate);
}

/**
 * A filter that came from outside — a URL, local storage, another service — as the tree the
 * engine reads, or an {@link InvalidCriteria} naming what is wrong with it.
 *
 * It exists because TypeScript's types are gone by the time the JSON is taken apart, and a
 * half-read filter does not fail here: it fails on the other side, far away, with another
 * message.
 *
 * @throws {InvalidCriteria} when the value is not a condition nor a group.
 */
export function readExpression(value: unknown): Expression {
  if (value === null || typeof value !== "object") {
    throw new InvalidCriteria(`a filter is an object; got ${JSON.stringify(value)}`);
  }
  const written = value as Record<string, unknown>;

  if ("any" in written) return { any: readParts(written.any, "any") };
  if ("all" in written) return { all: readParts(written.all, "all") };
  if ("negate" in written) return { negate: readExpression(written.negate) };

  if ("field" in written) {
    if (typeof written.field !== "string") {
      throw new InvalidCriteria("'field' is the name of a field, a string");
    }
    const operator = written.operator ?? "=";
    if (typeof operator !== "string" || !isOperator(operator)) {
      throw new InvalidCriteria(
        `'${String(operator)}' is not an operator the engine declares`,
      );
    }
    if (!("value" in written)) {
      throw new InvalidCriteria(
        `the condition on '${written.field}' carries no 'value'; a condition without a value is not a condition`,
      );
    }
    return { field: written.field, operator, value: written.value as Value };
  }

  throw new InvalidCriteria(
    "a filter is {'field', 'operator', 'value'} or an object with 'all', 'any' or 'negate'; " +
      `got {${Object.keys(written).sort().join(", ")}}`,
  );
}

function readParts(value: unknown, key: string): Expression[] {
  if (!Array.isArray(value)) {
    throw new InvalidCriteria(`'${key}' carries a list of filters`);
  }
  return value.map((one) => readExpression(one));
}
