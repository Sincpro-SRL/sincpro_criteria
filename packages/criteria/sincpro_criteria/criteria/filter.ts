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
 * One condition, written the short way: field, operator, value.
 *
 * @example
 * ["row_count", ">", 1000]
 * ["producer_id", "is null", true]
 * ["row_count", "between", [10, 20]]
 */
export type Triple<T = AnyRecord> = readonly [Fields<T>, Operator, Value];

/**
 * A filter as it is written: a triple, the condition object a widget produces, or a group of
 * either.
 *
 * This is the type a function that returns a filter should return, so what it gives back fits
 * anywhere a filter is taken.
 *
 * @example
 * function mine(): Filter<Dataset> {
 *   return any(["tags", "contains", "raw"], ["producer_id", "is null", true]);
 * }
 */
export type Filter<T = AnyRecord> =
  | Triple<T>
  | Condition<T>
  | { all: Filter<T>[] }
  | { any: Filter<T>[] }
  | { negate: Filter<T> };

/** Whether a written filter is a triple rather than an object. */
export function isTriple<T>(filter: Filter<T>): filter is Triple<T> {
  return Array.isArray(filter);
}

/**
 * A written filter as the tree the engine reads: every triple becomes a condition, at any
 * depth, and everything else is already what it will be.
 *
 * @throws {InvalidCriteria} when a triple is not a triple, or names an operator the engine
 * does not declare.
 */
export function readFilter<T = AnyRecord>(filter: Filter<T>): Expression<T> {
  if (isTriple(filter)) {
    const [field, operator, value] = filter as readonly [Fields<T>, Operator, Value];
    if (typeof field !== "string") {
      throw new InvalidCriteria(
        `a condition is written [field, operator, value]; got ${JSON.stringify(filter)}`,
      );
    }
    if (!isOperator(operator)) {
      throw new InvalidCriteria(
        `'${String(operator)}' is not an operator the engine declares`,
      );
    }
    return { field, operator, value };
  }

  if ("all" in filter) return { all: filter.all.map((part) => readFilter(part)) };
  if ("any" in filter) return { any: filter.any.map((part) => readFilter(part)) };
  if ("negate" in filter) return { negate: readFilter(filter.negate) };
  return filter;
}

/**
 * AND between whatever is left.
 *
 * One condition needs no wrapper, and **none is not a filter**: an empty `all` matches
 * everything, which is the opposite of what somebody who asked for nothing wanted.
 *
 * `.where(a, b)` already ANDs, so this is for the case where a list is built and may come out
 * empty.
 *
 * @example
 * all(["kind", "=", "book"], undefined); // {field: "kind", operator: "=", value: "book"}
 * all(); // undefined
 */
export function all<T = AnyRecord>(
  ...parts: (Filter<NoInfer<T>> | undefined)[]
): Expression<T> | undefined {
  const kept = read<T>(parts);
  if (kept.length === 0) return undefined;
  if (kept.length === 1) return kept[0];
  return { all: kept };
}

/**
 * OR between whatever is left: ticking another option of the same axis shows MORE.
 *
 * @example
 * any(["tags", "contains", "raw"], ["producer_id", "is null", true]);
 * // {any: [{field: "tags", operator: "contains", value: "raw"}, {field: "producer_id", operator: "is null", value: true}]}
 */
export function any<T = AnyRecord>(
  ...parts: (Filter<NoInfer<T>> | undefined)[]
): Expression<T> | undefined {
  const kept = read<T>(parts);
  if (kept.length === 0) return undefined;
  if (kept.length === 1) return kept[0];
  return { any: kept };
}

/**
 * The negation of a filter, or nothing when there is nothing to negate.
 *
 * @example
 * negate(["name", "like", "draft"]); // {negate: {field: "name", operator: "like", value: "draft"}}
 * negate(undefined); // undefined
 */
export function negate<T = AnyRecord>(
  part: Filter<NoInfer<T>> | undefined,
): Expression<T> | undefined {
  return part === undefined ? undefined : { negate: readFilter<T>(part) };
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
  ...filters: (Filter<NoInfer<T>> | undefined)[]
): Expression<T> | undefined {
  const parts: Expression<T>[] = [];
  for (const one of read<T>(filters)) {
    if ("all" in one) parts.push(...one.all);
    else parts.push(one);
  }
  if (parts.length === 0) return undefined;
  if (parts.length === 1) return parts[0];
  return { all: parts };
}

function read<T>(parts: (Filter<T> | undefined)[]): Expression<T>[] {
  return parts
    .filter((one): one is Filter<T> => one !== undefined)
    .map((one) => readFilter<T>(one));
}

/**
 * The three ways to put filters together, under one name.
 *
 * A namespace and not three loose exports: `all`, `any` and `not` are words every codebase
 * already uses, and one import — `where` — offers the three as soon as the dot is typed. It is
 * named after the place its result goes.
 *
 * @example
 * .where(
 *   ["encoding", "=", "utf-8"],
 *   where.any(["tags", "contains", "raw"], ["producer_id", "is null", true]),
 *   where.negate(["name", "like", "draft"]),
 * )
 */
export const where = { all, any, negate, combined } as const;
