import type {
  AnyRecord,
  Condition,
  Expression,
  Value,
} from "@sincpro/criteria/criteria/grammar";
import { InvalidCriteria, isOperator } from "@sincpro/criteria/criteria/grammar";

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
 * Every leaf of a tree, in reading order.
 *
 * What a screen looks at to draw the chips of a saved filter without understanding the shape
 * of the tree it was saved as.
 *
 * @example
 * conditionsOf(saved.where).map((one) => explainCondition(one, { meta }));
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

  // A filter written by hand carries triples, and a saved one may have been written by hand.
  if (Array.isArray(value)) {
    const [field, operator, written] = value as [unknown, unknown, unknown];
    if (typeof field !== "string" || typeof operator !== "string" || !isOperator(operator)) {
      throw new InvalidCriteria(
        `a condition is written [field, operator, value]; got ${JSON.stringify(value)}`,
      );
    }
    return { field, operator, value: written as Value };
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
