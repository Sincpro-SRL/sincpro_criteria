import { isDynamic } from "@sincpro/criteria/criteria/dynamic";
import { conditionsOf, isAll, isAny } from "@sincpro/criteria/criteria/expression";
import type {
  AnyRecord,
  Condition,
  Dynamic,
  Expression,
  FromContext,
  Grain,
  Now,
  Param,
  Period,
  PERIODS,
  Span,
  Today,
  Value,
} from "@sincpro/criteria/criteria/grammar";
import { InvalidCriteria, UNITS } from "@sincpro/criteria/criteria/grammar";
import { readInstant } from "@sincpro/criteria/engine/temporal";

/**
 * What a dynamic value needs to become a literal: the instant, the timezone, and where to read.
 *
 * Every field is optional and the defaults are the engine's: the moment of the call, UTC,
 * Monday as the first weekday, and nothing in the context. The server builds this from its own
 * clock and its own context; a client that resolves locally — a form hint, rows it already
 * holds — builds one of its own, and what it reads stays on the client.
 */
export interface ResolutionContext {
  /** The instant, read once: every value of one filter agrees on it. Pass it to pin the day. */
  now?: Date;

  /** An IANA name (`"America/La_Paz"`); only decides where a calendar boundary falls. */
  timeZone?: string;

  /** The weekday a week begins on, 0 being Monday. */
  weekStartsOn?: number;

  /** What `{"$": "context", "key"}` reads: the server's own context. */
  context?: Record<string, unknown>;

  /** What `{"$": "param", "name"}` reads: what the caller supplied for this call. */
  params?: Record<string, unknown>;
}

/** A moment as the wall clock of a timezone shows it. */
interface Wall {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  ms: number;
}

/** What a value is once its anchor is read: a day with no time, or an instant. */
type Anchor = { date: Wall } | { at: Date };

interface Settled {
  now: Date;
  timeZone: string;
  weekStartsOn: number;
  context: Record<string, unknown>;
  params: Record<string, unknown>;
}

const NAMED_STARTS: Record<(typeof PERIODS)[number], [Grain, number]> = {
  today: ["day", 0],
  yesterday: ["day", -1],
  tomorrow: ["day", 1],
  this_week: ["week", 0],
  last_week: ["week", -1],
  next_week: ["week", 1],
  this_month: ["month", 0],
  last_month: ["month", -1],
  next_month: ["month", 1],
  this_quarter: ["quarter", 0],
  last_quarter: ["quarter", -1],
  next_quarter: ["quarter", 1],
  this_year: ["year", 0],
  last_year: ["year", -1],
  next_year: ["year", 1],
};

const ONE_OF: Record<Grain, Span> = {
  day: { days: 1 },
  week: { weeks: 1 },
  month: { months: 1 },
  quarter: { months: 3 },
  year: { years: 1 },
};

const formatters = new Map<string, Intl.DateTimeFormat>();

function pad(value: number, width = 2): string {
  return String(value).padStart(width, "0");
}

function daysIn(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function plain(year: number, month: number, day: number): Wall {
  const at = new Date(Date.UTC(year, month - 1, day));
  return {
    year: at.getUTCFullYear(),
    month: at.getUTCMonth() + 1,
    day: at.getUTCDate(),
    hour: 0,
    minute: 0,
    second: 0,
    ms: 0,
  };
}

/** The day a wall clock shows, with no time. */
function dateOnly(wall: Wall): Wall {
  return plain(wall.year, wall.month, wall.day);
}

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let found = formatters.get(timeZone);
  if (found === undefined) {
    try {
      found = new Intl.DateTimeFormat("en-US", {
        timeZone,
        hourCycle: "h23",
        year: "numeric",
        month: "numeric",
        day: "numeric",
        hour: "numeric",
        minute: "numeric",
        second: "numeric",
      });
    } catch {
      throw new InvalidCriteria(`'${timeZone}' is not a timezone name`);
    }
    formatters.set(timeZone, found);
  }
  return found;
}

/** What the wall clock of a timezone shows at an instant. */
function wallOf(at: Date, timeZone: string): Wall {
  if (timeZone === "UTC") {
    return {
      year: at.getUTCFullYear(),
      month: at.getUTCMonth() + 1,
      day: at.getUTCDate(),
      hour: at.getUTCHours(),
      minute: at.getUTCMinutes(),
      second: at.getUTCSeconds(),
      ms: at.getUTCMilliseconds(),
    };
  }
  const read: Record<string, number> = {};
  for (const part of formatterFor(timeZone).formatToParts(at)) {
    if (part.type !== "literal") read[part.type] = Number(part.value);
  }
  return {
    year: read.year as number,
    month: read.month as number,
    day: read.day as number,
    hour: read.hour as number,
    minute: read.minute as number,
    second: read.second as number,
    ms: at.getUTCMilliseconds(),
  };
}

function asUtcMs(wall: Wall): number {
  return Date.UTC(
    wall.year,
    wall.month - 1,
    wall.day,
    wall.hour,
    wall.minute,
    wall.second,
    wall.ms,
  );
}

/**
 * The instant a wall clock shows in a timezone.
 *
 * The offset is asked twice, because the first answer is the offset at the guess and the guess
 * may sit on the other side of a clock change from the instant it names.
 */
function instantOf(wall: Wall, timeZone: string): Date {
  const guess = asUtcMs(wall);
  if (timeZone === "UTC") return new Date(guess);
  const offsetAt = (ms: number): number => asUtcMs(wallOf(new Date(ms), timeZone)) - ms;
  const first = guess - offsetAt(guess);
  const second = guess - offsetAt(first);
  return new Date(second);
}

function weekdayOf(wall: Wall): number {
  return (new Date(Date.UTC(wall.year, wall.month - 1, wall.day)).getUTCDay() + 6) % 7;
}

/** A day moved by months and years first, a month end clamped, then by days and weeks. */
function onCalendar(wall: Wall, span: Span): Wall {
  const index =
    wall.year * 12 + (wall.month - 1) + (span.months ?? 0) + 12 * (span.years ?? 0);
  const year = Math.floor(index / 12);
  const month = (((index % 12) + 12) % 12) + 1;
  const day = Math.min(wall.day, daysIn(year, month));
  const moved = plain(year, month, day + (span.days ?? 0) + 7 * (span.weeks ?? 0));
  return { ...moved, hour: wall.hour, minute: wall.minute, second: wall.second, ms: wall.ms };
}

/** The start of the calendar unit a day falls in, with no time. */
function snapped(wall: Wall, grain: Grain, weekStartsOn: number): Wall {
  switch (grain) {
    case "day":
      return plain(wall.year, wall.month, wall.day);
    case "week":
      return plain(
        wall.year,
        wall.month,
        wall.day - ((weekdayOf(wall) - weekStartsOn + 7) % 7),
      );
    case "month":
      return plain(wall.year, wall.month, 1);
    case "quarter":
      return plain(wall.year, 3 * Math.floor((wall.month - 1) / 3) + 1, 1);
    case "year":
      return plain(wall.year, 1, 1);
  }
}

function scaled(unit: Span, times: number): Span {
  const out: Span = {};
  for (const name of UNITS) {
    if (unit[name] !== undefined) out[name] = (unit[name] as number) * times;
  }
  return out;
}

function dateText(wall: Wall): string {
  return `${pad(wall.year, 4)}-${pad(wall.month)}-${pad(wall.day)}`;
}

/** A day moved by a span. Calendar units follow the wall clock; hours and minutes are elapsed. */
function moved(anchor: Anchor, span: Span, settled: Settled): Anchor {
  if ("date" in anchor) {
    if (span.hours || span.minutes) {
      throw new InvalidCriteria("a date has no hours or minutes; use `now` to move by them");
    }
    return { date: onCalendar(anchor.date, span) };
  }
  const wall = onCalendar(wallOf(anchor.at, settled.timeZone), span);
  const elapsed = ((span.hours ?? 0) * 60 + (span.minutes ?? 0)) * 60000;
  return { at: new Date(instantOf(wall, settled.timeZone).getTime() + elapsed) };
}

function snappedAnchor(anchor: Anchor, grain: Grain, settled: Settled): Anchor {
  if ("date" in anchor) return { date: snapped(anchor.date, grain, settled.weekStartsOn) };
  const start = snapped(wallOf(anchor.at, settled.timeZone), grain, settled.weekStartsOn);
  return { at: instantOf(start, settled.timeZone) };
}

/** A path of names with dots read from what the server holds, or a refusal naming it. */
function readPath(source: Record<string, unknown>, path: string, what: string): unknown {
  let found: unknown = source;
  for (const step of path.split(".")) {
    if (
      found === null ||
      typeof found !== "object" ||
      Array.isArray(found) ||
      !(step in (found as Record<string, unknown>))
    ) {
      throw new InvalidCriteria(`${what} has no '${path}'`);
    }
    found = (found as Record<string, unknown>)[step];
  }
  return found;
}

/** A value that has to be a date: itself, or the ISO text a context may hold it as. */
function dateRead(given: unknown): Anchor {
  if (given instanceof Date && !Number.isNaN(given.getTime())) return { at: given };
  if (typeof given === "string") {
    const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(given);
    if (day) return { date: plain(Number(day[1]), Number(day[2]), Number(day[3])) };
    // Text with a time and no offset is UTC, as the engine reads it; `Date` would call it local.
    const zoned = /(Z|[+-]\d{2}:?\d{2})$/.test(given) ? given : `${given}Z`;
    const at = readInstant(zoned);
    if (at !== undefined) return { at };
  }
  throw new InvalidCriteria(
    `a value that is moved or snapped is not a date: ${String(given)}`,
  );
}

function settle(resolution: ResolutionContext): Settled {
  return {
    now: resolution.now ?? new Date(),
    timeZone: resolution.timeZone ?? "UTC",
    weekStartsOn: resolution.weekStartsOn ?? 0,
    context: resolution.context ?? {},
    params: resolution.params ?? {},
  };
}

function anchorOf(value: Today | Now | FromContext | Param, settled: Settled): unknown {
  switch (value.$) {
    case "today":
      return { date: dateOnly(wallOf(settled.now, settled.timeZone)) } satisfies Anchor;
    case "now":
      return { at: settled.now } satisfies Anchor;
    case "context":
      return readPath(settled.context, value.key, "the context");
    case "param":
      return readPath(settled.params, value.name, "the parameters");
  }
}

/** The literal a dynamic value stands for. */
function valueOf(value: Today | Now | FromContext | Param, settled: Settled): Value {
  const read = anchorOf(value, settled);
  if (value.plus === undefined && value.start_of === undefined) {
    return value.$ === "today" || value.$ === "now"
      ? finished(read as Anchor)
      : (read as Value);
  }
  let anchor = value.$ === "today" || value.$ === "now" ? (read as Anchor) : dateRead(read);
  if (value.plus !== undefined) anchor = moved(anchor, value.plus, settled);
  if (value.start_of !== undefined) anchor = snappedAnchor(anchor, value.start_of, settled);
  return finished(anchor);
}

function finished(anchor: Anchor): Value {
  return "date" in anchor ? dateText(anchor.date) : anchor.at.toISOString();
}

/** The `[start, end)` a period covers, in dates of the timezone. */
function rangeOf(period: Period, settled: Settled): [string, string] {
  const today = dateOnly(wallOf(settled.now, settled.timeZone));
  const day = (wall: Wall, span: Span): Wall => onCalendar(wall, span);

  if ("name" in period) {
    const [grain, away] = NAMED_STARTS[period.name];
    const unit = ONE_OF[grain];
    const start = snapped(day(today, scaled(unit, away)), grain, settled.weekStartsOn);
    return [dateText(start), dateText(day(start, unit))];
  }

  const unit = ONE_OF[period.unit];
  const current = snapped(today, period.unit, settled.weekStartsOn);
  const units = (amount: number): string => dateText(day(current, scaled(unit, amount)));
  const including = period.include_current === true;
  if (period.last !== undefined) {
    return [units(-(including ? period.last - 1 : period.last)), units(including ? 1 : 0)];
  }
  const next = period.next as number;
  return [units(including ? 0 : 1), units(next + (including ? 0 : 1))];
}

function itemOf(value: Value, field: string, settled: Settled): Value {
  if (isDynamic(value) && value.$ === "period") {
    throw new InvalidCriteria(
      `a period is a range and cannot be one item of a list; '${field}' asked for it so`,
    );
  }
  if (isDynamic(value) && value.$ !== "field") return valueOf(value, settled);
  return value;
}

/** One condition with its dynamic values read; a period becomes the two bounds it stands for. */
function resolved(condition: Condition, settled: Settled): Expression {
  const { value } = condition;
  if (isDynamic(value) && value.$ === "period") {
    if (condition.operator !== "between") {
      throw new InvalidCriteria(
        `a period is a range and takes the operator 'between'; ` +
          `'${condition.field}' asked it with '${condition.operator}'`,
      );
    }
    const [start, end] = rangeOf(value, settled);
    return {
      all: [
        { field: condition.field, operator: ">=", value: start },
        { field: condition.field, operator: "<", value: end },
      ],
    };
  }
  if (Array.isArray(value)) {
    return { ...condition, value: value.map((one) => itemOf(one, condition.field, settled)) };
  }
  return { ...condition, value: itemOf(value, condition.field, settled) };
}

function readByServer(value: Value): value is Dynamic {
  return isDynamic(value) && value.$ !== "field";
}

/**
 * Whether any condition of the tree holds a value that is read before any row is — alone or as
 * an item of a list. A column against another (`field`) is the row's own, so it does not count.
 *
 * @example
 * hasDynamicValues({ field: "due", operator: "<", value: { $: "today" } }); // true
 */
export function hasDynamicValues<T = AnyRecord>(
  expression: Expression<T> | undefined,
): boolean {
  return conditionsOf(expression).some(
    (one) =>
      readByServer(one.value) ||
      (Array.isArray(one.value) && one.value.some((item) => readByServer(item))),
  );
}

function rebuilt(
  expression: Expression,
  leaf: (condition: Condition) => Expression,
): Expression {
  if ("field" in expression) return leaf(expression);
  if (isAll(expression)) return { all: expression.all.map((part) => rebuilt(part, leaf)) };
  if (isAny(expression)) return { any: expression.any.map((part) => rebuilt(part, leaf)) };
  return { negate: rebuilt(expression.negate, leaf) };
}

/**
 * The same filter with every dynamic value replaced by the literal it stands for.
 *
 * The tree stays symbolic until it is used, and the server is the one that resolves it: with its
 * own clock, its own timezone and its own context. This is the same step for a client that
 * answers a filter over rows it already holds. Dates come out as `YYYY-MM-DD` and instants as
 * UTC ISO text, which is what the engine writes.
 *
 * A tree with nothing dynamic is handed back as it came. What cannot be read — a context key
 * that is absent, a period asked with `=` — is refused naming it, because a filter that quietly
 * dropped the condition would bring back more than was asked for.
 *
 * @example
 * resolve(
 *   { field: "due", operator: "<", value: { $: "today" } },
 *   { now: new Date("2026-10-12T15:30:00Z") },
 * );
 * // { field: "due", operator: "<", value: "2026-10-12" }
 *
 * @throws {InvalidCriteria} when a value cannot be read.
 */
export function resolve<T = AnyRecord>(
  expression: Expression<T> | undefined,
  resolution: ResolutionContext = {},
): Expression<T> | undefined {
  if (expression === undefined || !hasDynamicValues(expression)) return expression;
  const settled = settle(resolution);
  return rebuilt(expression as Expression, (condition) =>
    resolved(condition, settled),
  ) as Expression<T>;
}
