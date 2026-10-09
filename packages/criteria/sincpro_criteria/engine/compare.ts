import type { Value } from "@sincpro/criteria/criteria/grammar";
import { readInstant } from "@sincpro/criteria/engine/temporal";
import type { Meta } from "@sincpro/criteria/meta/meta";

/** Whether the model marks this field `exact`: a decimal, compared as a number. */
export function isExact(meta: Meta | undefined, field: string): boolean {
  return meta?.fields[field]?.exact === true;
}

/** Whether a value is the absence of one. JSON carries `null`; a missing key is `undefined`. */
export function missing(value: unknown): boolean {
  return value === null || value === undefined;
}

/**
 * A value as something that can be ordered.
 *
 * A `Date` becomes its time, and so does a string compared against a `Date` — a filter that
 * travelled through JSON carries the date as text, and comparing that text against a `Date`
 * object would be a comparison between a string and `[object Date]`.
 */
function ordered(value: unknown, against: unknown): number | string | boolean {
  if (value instanceof Date) return value.getTime();
  if (against instanceof Date && typeof value === "string") {
    // Read strictly, or a text column compared against a date turns "utf-8" into a day in
    // 2001 and the comparison answers something. See `engine/temporal.ts`.
    const parsed = readInstant(value);
    if (parsed !== undefined) return parsed.getTime();
  }
  return value as number | string | boolean;
}

/** A decimal literal as JSON carries one: an optional sign, digits, an optional fraction. */
const DECIMAL = /^(-?)(\d+)(?:\.(\d+))?$/;

/** A decimal read as its parts, with the zeros that change nothing taken off. */
export interface DecimalParts {
  negative: boolean;
  whole: string;
  fraction: string;
}

/**
 * A value read as an exact decimal, or `undefined` when it is not one.
 *
 * The engine sends a `Decimal` as text so no digit is lost on the way (`"10.50"`), and a
 * JavaScript number has no exact form for most fractions — so a decimal is compared digit by
 * digit, never through `Number`. A number in exponent form is not read: it already lost the
 * digits a decimal column keeps.
 *
 * @example
 * readDecimal("10.50"); // { negative: false, whole: "10", fraction: "5" }
 * readDecimal("-0.0"); // { negative: false, whole: "0", fraction: "" }
 * readDecimal("1.2.3"); // undefined — an account code, not a number
 */
export function readDecimal(value: unknown): DecimalParts | undefined {
  const text = typeof value === "number" ? String(value) : value;
  if (typeof text !== "string") return undefined;
  const parts = DECIMAL.exec(text);
  if (parts === null) return undefined;
  const whole = parts[2]!.replace(/^0+(?=\d)/, "");
  const fraction = (parts[3] ?? "").replace(/0+$/, "");
  const zero = whole === "0" && fraction === "";
  return { negative: parts[1] === "-" && !zero, whole, fraction };
}

/**
 * Where one decimal falls against another: negative, zero or positive — exactly, as a
 * `NUMERIC` column compares. `undefined` when either side is not a decimal.
 *
 * @example
 * compareDecimals("10.00", "9.5"); // 1 — as text, "10.00" sorts before "9.5"
 * compareDecimals("10.0", "10.00"); // 0
 */
export function compareDecimals(mine: unknown, theirs: unknown): number | undefined {
  const left = readDecimal(mine);
  const right = readDecimal(theirs);
  if (left === undefined || right === undefined) return undefined;
  if (left.negative !== right.negative) return left.negative ? -1 : 1;
  const magnitude = compareMagnitudes(left, right);
  return left.negative ? -magnitude : magnitude;
}

function compareMagnitudes(left: DecimalParts, right: DecimalParts): number {
  if (left.whole.length !== right.whole.length) {
    return left.whole.length < right.whole.length ? -1 : 1;
  }
  if (left.whole !== right.whole) return left.whole < right.whole ? -1 : 1;
  const width = Math.max(left.fraction.length, right.fraction.length);
  const mine = left.fraction.padEnd(width, "0");
  const theirs = right.fraction.padEnd(width, "0");
  if (mine === theirs) return 0;
  return mine < theirs ? -1 : 1;
}

/**
 * Whether two values are the same one, as the engine reads "the same".
 *
 * Lists are compared by their members — `["a"] == ["a"]` is true in the database and false
 * between two arrays in JavaScript — and a date by the instant it names. On a field the model
 * marks `exact` (a decimal), two decimals are the same number however many zeros they carry.
 */
export function sameValue(mine: unknown, theirs: unknown, exact = false): boolean {
  if (exact) {
    const side = compareDecimals(mine, theirs);
    if (side !== undefined) return side === 0;
  }
  if (mine instanceof Date || theirs instanceof Date) {
    return ordered(mine, theirs) === ordered(theirs, mine);
  }
  if (Array.isArray(mine) && Array.isArray(theirs)) {
    return (
      mine.length === theirs.length &&
      mine.every((one, at) => sameValue(one, theirs[at], exact))
    );
  }
  return mine === theirs;
}

/**
 * Where one value falls against another: negative, zero or positive.
 *
 * Missing values sort last, which is the one decision here that is not the database's: the
 * engine refuses to page by a nullable column precisely because the answer is arbitrary. This
 * only has to be consistent so that a local sort is stable. On a field the model marks `exact`,
 * two decimals compare as numbers: `"10.00"` comes after `"9.5"`.
 */
export function compareValues(mine: unknown, theirs: unknown, exact = false): number {
  if (missing(mine) && missing(theirs)) return 0;
  if (missing(mine)) return 1;
  if (missing(theirs)) return -1;
  if (exact) {
    const side = compareDecimals(mine, theirs);
    if (side !== undefined) return side;
  }
  const left = ordered(mine, theirs);
  const right = ordered(theirs, mine);
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

/** Whether a value is a list with nothing in it — the question an empty list asks. */
export function emptyList(value: Value): boolean {
  return Array.isArray(value) && value.length === 0;
}
