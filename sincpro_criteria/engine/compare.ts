/**
 * Comparing two values the way the engine compares them.
 *
 * SQL and JavaScript disagree in three places that matter here, and every one of them showed
 * up as a wrong row rather than as an error: `NULL` compares to nothing, two dates are two
 * objects unless something turns them into numbers, and two lists are never the same list.
 *
 * @module
 */

import type { Value } from "@sincpro/criteria/criteria/grammar";
import { readInstant } from "@sincpro/criteria/engine/temporal";

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

/**
 * Whether two values are the same one, as the engine reads "the same".
 *
 * Lists are compared by their members — `["a"] == ["a"]` is true in the database and false
 * between two arrays in JavaScript — and a date by the instant it names.
 */
export function sameValue(mine: unknown, theirs: unknown): boolean {
  if (mine instanceof Date || theirs instanceof Date) {
    return ordered(mine, theirs) === ordered(theirs, mine);
  }
  if (Array.isArray(mine) && Array.isArray(theirs)) {
    return (
      mine.length === theirs.length && mine.every((one, at) => sameValue(one, theirs[at]))
    );
  }
  return mine === theirs;
}

/**
 * Where one value falls against another: negative, zero or positive.
 *
 * Missing values sort last, which is the one decision here that is not the database's: the
 * engine refuses to page by a nullable column precisely because the answer is arbitrary. This
 * only has to be consistent so that a local sort is stable.
 */
export function compareValues(mine: unknown, theirs: unknown): number {
  if (missing(mine) && missing(theirs)) return 0;
  if (missing(mine)) return 1;
  if (missing(theirs)) return -1;
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
