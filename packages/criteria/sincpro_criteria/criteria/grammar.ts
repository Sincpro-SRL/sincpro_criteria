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
 * The units a {@link Span} counts in, as the engine spells them. Plural, because a span says
 * how MANY: `{days: -30}`.
 */
export const UNITS = ["minutes", "hours", "days", "weeks", "months", "years"] as const;

export type Unit = (typeof UNITS)[number];

/**
 * A signed amount of time, by unit. Only the units asked for travel: `{days: -30}` is thirty
 * days back and `{months: 1, days: -1}` a month ahead and a day back.
 */
export type Span = { [K in Unit]?: number };

/**
 * The named spans of the calendar a `period` can be, each a range `[start, end)`.
 *
 * A closed list, in the engine's order: a name outside it is refused there, so here it does not
 * compile.
 */
export const PERIODS = [
  "today",
  "yesterday",
  "tomorrow",
  "this_week",
  "last_week",
  "next_week",
  "this_month",
  "last_month",
  "next_month",
  "this_quarter",
  "last_quarter",
  "next_quarter",
  "this_year",
  "last_year",
  "next_year",
] as const;

export type PeriodName = (typeof PERIODS)[number];

/**
 * What a dynamic value is: the name under `"$"`, and the whole of what the engine can read.
 * A closed set, because the name decides what runs.
 */
export const DYNAMIC_KINDS = ["today", "now", "period", "context", "param", "field"] as const;

export type DynamicKind = (typeof DYNAMIC_KINDS)[number];

/** What a date-valued dynamic value may do: move, then snap to the start of a calendar unit. */
export interface Shifted {
  /** How far to move it, signed: `{days: -30}` is thirty days ago. Applied first. */
  plus?: Span;

  /** The start of the calendar unit it falls in once moved: `"month"` is the first of the month. */
  start_of?: Grain;
}

/** The current date, in the timezone of the server's context. */
export interface Today extends Shifted {
  $: "today";
}

/** The current instant, in UTC. */
export interface Now extends Shifted {
  $: "now";
}

/** A value of the server's own context — the user, the tenant, a date it holds. Never the client's. */
export interface FromContext extends Shifted {
  $: "context";
  key: string;
}

/** A value the caller supplied for this call; `name` may be a path with dots. */
export interface Param extends Shifted {
  $: "param";
  name: string;
}

/** A named span of the calendar, as a range `[start, end)`. Only with the operator `between`. */
export interface NamedPeriod {
  $: "period";
  name: PeriodName;
}

/**
 * A window of whole units counted from the current one: the `last` N before it, or the `next` N
 * after it. The current unit is left out unless `include_current`.
 */
export type WindowPeriod = { $: "period"; unit: Grain; include_current?: boolean } & (
  { last: number; next?: never } | { next: number; last?: never }
);

export type Period = NamedPeriod | WindowPeriod;

/** Another field of the same row: a column against a column. Not read before the row. */
export interface FromField {
  $: "field";
  name: string;
}

/**
 * A value that is not a literal: stored as itself and read by the server when the filter runs, so
 * a saved view that says `today` means the day it is opened.
 *
 * It is an object with the reserved key `"$"`; no literal can collide with it. Build one with
 * `dynamic`.
 */
export type Dynamic = Today | Now | FromContext | Param | Period | FromField;

/**
 * What a condition compares against: whatever travels in JSON, plus `Date`, because on
 * this side of the wire a date is a `Date` until `JSON.stringify` writes it out, plus a
 * {@link Dynamic} value, alone or as an item of a list.
 */
export type Value = string | number | boolean | null | Date | Dynamic | Value[];

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
  "starts with",
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
 * How coarsely a date is cut before grouping by it, and the calendar unit a date snaps to the
 * start of. Without a grain, grouping by a date yields one bucket per row.
 */
export const GRAINS = ["day", "week", "month", "quarter", "year"] as const;

export type Grain = (typeof GRAINS)[number];

/**
 * A number extracted from a date: the month of the year, whatever the year.
 *
 * A grain CUTS (a bucket is a range of time, `2026-03`) and a part EXTRACTS (a bucket is a number
 * many dates share, `3`), so a level takes one or the other. Weekdays count from Monday as 1.
 */
export const PARTS = [
  "year",
  "quarter",
  "month",
  "iso_week",
  "day_of_week",
  "day_of_month",
  "hour",
] as const;

export type Part = (typeof PARTS)[number];

/** Whether a string is one of the parts the engine extracts. See {@link isOperator}. */
export function isPart(written: string): written is Part {
  return (PARTS as readonly string[]).includes(written);
}

/** Whether a string is one of the grains the engine can cut. See {@link isOperator}. */
export function isGrain(written: string): written is Grain {
  return (GRAINS as readonly string[]).includes(written);
}

/** One level of grouping: the field it splits by, and how. */
export interface Level<T = AnyRecord> {
  field: Fields<T>;

  /** Cuts a date into ranges of time (`2026-03`). */
  grain?: Grain | null;

  /**
   * Extracts a number from a date (`3`). A group of a part cannot be opened as a filter: its
   * {@link Bucket.openable} is `false`.
   */
  part?: Part | null;

  /**
   * Lists every value the level can take, with a count of 0 for the ones with no rows: all the
   * choices of an enum, both values of a boolean, every number a part can be, every grain of a
   * date range the filter bounds. Not with a filter or a page over the groups.
   */
  fill?: boolean;
}

/**
 * The five functions a measure may ask for.
 *
 * A closed list, because the name reaches SQL: anything outside it is refused before a
 * statement exists. Adding one is a change in the engine, not a string a caller can invent.
 */
export const MEASURE_FUNCTIONS = [
  "sum",
  "avg",
  "min",
  "max",
  "count",
  "count_distinct",
  "percentile",
  "median",
  "bool_and",
  "bool_or",
] as const;

export type MeasureFunction = (typeof MEASURE_FUNCTIONS)[number];

/**
 * One number a group answers: a function over a field.
 *
 * Named parts, like every other thing that travels — `{field, operator, value}` for a
 * condition, `{field, grain}` for a level — so nothing has to be split or guessed by position
 * in whatever language reads it. `measure.sum("row_count")` writes one.
 *
 * It is a measure and not an aggregate on purpose: an *aggregate* is the DDD root, which is
 * what `Meta.aggregate` names, and one word cannot mean two things in the same sentence.
 */
export interface Measure<T = AnyRecord> {
  function: MeasureFunction;
  field: Fields<T>;

  /**
   * What the function needs besides a column, when it needs anything.
   *
   * Only `percentile` does: the fraction it cuts at, `0.5` for the median and `0.95` for a
   * P95. Every other measure refuses one rather than ignoring it, because a number that is
   * quietly dropped is a report that is quietly wrong.
   */
  argument?: number;
}

/** How a result set is split when it is counted rather than listed. */
export interface Grouping<T = AnyRecord> {
  /** The levels the set is split by, one statement each. */
  group_by?: Level<T>[];

  /** The numbers every group answers, each under a name the caller chose. */
  measures?: Record<string, Measure<T>>;

  /**
   * A filter over what the groups measured, not over the rows: `count > 10`.
   *
   * The names it may use are the ones in `measures` plus `count`. `where` filters the rows
   * that make the groups; this filters the groups those rows made — which is why it is not
   * called `where`: it reads measures, not fields.
   */
  where_measures?: Expression;

  /**
   * How the GROUPS of each level come back: by the level's own field, by a name in `measures`,
   * or by `count`. `Criteria.order` orders the rows, and with a page asked for it decides
   * which rows each group shows first.
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
