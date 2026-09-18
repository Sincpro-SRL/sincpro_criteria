/**
 * The grammar of a read request: what a caller sends.
 *
 * This is the exact shape the Sincpro engine declares, in TypeScript. It is written by
 * hand rather than generated: it is the contract everything else hangs from, and reading
 * it should cost less than opening the OpenAPI document.
 *
 * Every type takes the RECORD type as its parameter — `Criteria<Dataset>` — instead of the
 * union of its field names, because that is how it is spoken. Without the parameter, field
 * names are plain `string` and everything still works: typing is opt-in, and gets added the
 * day there is a generated type to hang it on.
 *
 * @module
 */

/** A record nothing is known about: any string is a field name. */
export type AnyRecord = Record<string, unknown>;

/**
 * The field names of a record. `Fields<AnyRecord>` is `string`.
 *
 * **Every parameter typed with this is wrapped in `NoInfer`.** TypeScript can run the type
 * backwards — from the string `"name"` it will happily conclude `T = {name: any}` — and then
 * the second field of the same filter is rejected against the record it invented from the
 * first. With `NoInfer`, `T` only ever comes from the builder that holds it or from an
 * explicit type argument, which is where it is actually known.
 */
export type Fields<T> = Extract<keyof T, string>;

/**
 * What a condition compares against: whatever travels in JSON, plus `Date`, because on
 * this side of the wire a date is a `Date` until `JSON.stringify` writes it out.
 */
export type Value = string | number | boolean | null | Date | Value[];

/**
 * How a question is asked.
 *
 * These are the same symbols the model definition publishes in `FieldMeta.ops`, so a filter
 * builder offers exactly this list without translating anything. Declared in the engine's
 * own order so the two lists can be compared at a glance.
 */
export const OPERATORS = [
  "=",
  "!=",
  "in",
  "not in",
  "like",
  ">",
  ">=",
  "<",
  "<=",
  "is null",
  "contains",
  "not contains",
  "between",
] as const;

export type Operator = (typeof OPERATORS)[number];

/** The operators that compare against more than one value. */
export const MULTI_VALUED: readonly Operator[] = ["in", "not in", "between"];

/**
 * Whether a string is one of the operators the engine declares.
 *
 * This exists for the edge: a filter builder reads its rules from `FieldMeta.ops`, which
 * arrives at runtime, so to it an operator is just a `string`. This is what turns it back
 * into the closed union without an `as`.
 *
 * @example
 * isOperator("like"); // true
 * isOperator("=~");   // false
 */
export function isOperator(written: string): written is Operator {
  return (OPERATORS as readonly string[]).includes(written);
}

/**
 * One question about one field.
 *
 * There is no abbreviated spelling: the operator never travels glued to the field name,
 * because that forces every language talking to the API to split a string to read it.
 */
export interface Condition<T = AnyRecord> {
  field: Fields<T>;
  operator: Operator;
  value: Value;
}

/**
 * A condition, or a group of them. No `Array.isArray` needed: each shape is recognised by
 * the key it carries.
 */
export type Expression<T = AnyRecord> =
  | Condition<T>
  | { all: Expression<T>[] }
  | { any: Expression<T>[] }
  | { negate: Expression<T> };

export interface Sort<T = AnyRecord> {
  field: Fields<T>;
  descending?: boolean;
}

/**
 * How coarsely a date is cut before grouping by it. Without a grain, grouping by a date
 * yields one bucket per row.
 */
export const GRAINS = ["year", "month", "week", "day"] as const;

export type Grain = (typeof GRAINS)[number];

/** Whether a string is one of the grains the engine can cut. See {@link isOperator}. */
export function isGrain(written: string): written is Grain {
  return (GRAINS as readonly string[]).includes(written);
}

/** One level of grouping: the field it splits by, and how finely. */
export interface Level<T = AnyRecord> {
  field: Fields<T>;
  grain?: Grain | null;
}

/** The aggregate functions a fold may ask for. A closed list, because the name reaches SQL. */
export const FOLD_FUNCTIONS = ["sum", "avg", "min", "max", "count"] as const;

export type FoldFunction = (typeof FOLD_FUNCTIONS)[number];

/**
 * One number folded out of a bucket's rows: `["sum", "row_count"]`.
 *
 * A pair and not `"sum:row_count"`, so nobody has to split a string — the same reason a
 * condition is written as a triple.
 */
export type Fold<T = AnyRecord> = [FoldFunction, Fields<T>];

/** How a result set is split when it is counted rather than listed. */
export interface Grouping<T = AnyRecord> {
  by?: Level<T>[];
  totals?: Record<string, Fold<T>>;

  /**
   * A filter over what the groups folded, not over the rows: `count > 10`. The names it may
   * use are the ones in `totals` plus `count` — `where` filters the rows that make the
   * groups, `having` filters the groups those rows made.
   */
  having?: Expression;

  /**
   * How the groups of each level come back: by the level's own field, by a name in `totals`,
   * or by `count`. Empty means by the level's field, ascending.
   */
  order?: Sort[];

  /**
   * How many groups of the FIRST level come back, and from where. Omitted, every group comes
   * back. When a page is asked for, deeper levels answer only for the groups that survived
   * it, and every bucket of the deepest level also carries the `ids` and `cursor` of its own
   * rows — see `Bucket`.
   */
  pagination?: Pagination;
}

/**
 * Where a page starts. **The cursor is one STRATEGY, not the object itself**: a caller that
 * switches to counting rows changes the strategy, not the way it asks for a page.
 *
 * `{token}` names the last row seen, so a row inserted mid-walk moves nothing. `{rows}`
 * counts rows from the start: it is what everybody else does, it costs what it costs, and it
 * is the only thing that works when a grid jumps to page 7.
 */
export type PageStrategy = { token: string | null } | { rows: number };

export interface Pagination {
  limit?: number;
  strategy?: PageStrategy;
}

/**
 * What to bring back of each record: field name → how to bring it. The value is another
 * criteria, so a relation carries its own filter, ordering and page, and the vocabulary
 * inside a node is the vocabulary outside it, at any depth.
 *
 * **`undefined` and `{}` are not the same thing**: with no specification the whole record
 * comes back; with an empty one, only its identity.
 */
export type Specification<T = AnyRecord> = { [K in Fields<T>]?: Criteria };

/** How much counting costs. `capped` stops at a ceiling and says so (`10000+`). */
export type CountMode = "none" | "capped" | "exact";

/** Everything a caller is asking for: the filter, the ordering, the page and what to bring. */
export interface Criteria<T = AnyRecord> {
  where?: Expression<T>;
  order?: Sort<T>[];
  pagination?: Pagination;
  specification?: Specification<T>;
  grouping?: Grouping<T>;
  count?: CountMode;

  /**
   * Whether the answer carries the model definition. On unless somebody turns it off: a door
   * that describes itself is worth more than the kilobyte and a half it costs.
   */
  meta?: boolean;
}

/**
 * What is thrown when something that is not a criteria arrives.
 *
 * Same name as the exception on the Python side, so an error is looked up once.
 */
export class InvalidCriteria extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidCriteria";
  }
}
