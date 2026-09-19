import { decodeBase64Url, encodeBase64Url } from "@sincpro/criteria/criteria/base64";
import type { AnyRecord, Sort } from "@sincpro/criteria/criteria/grammar";
import { InvalidCriteria } from "@sincpro/criteria/criteria/grammar";
import { formatOrder } from "@sincpro/criteria/criteria/order";
import { compareValues, sameValue } from "@sincpro/criteria/engine/compare";

const DATETIME_TAG = "__dt__";
const DATE_TAG = "__d__";
const DECIMAL_TAG = "__dec__";

/** The keys of a page's last row, and the ordering they belong to. */
export interface CursorKeys {
  keys: unknown[];
  ordering: string;
}

/** The ordering a cursor is stamped with, tiebreaker included. */
export function signatureOf<T = AnyRecord>(sorts: readonly Sort<T>[]): string {
  return formatOrder(sorts);
}

/**
 * The token the next page resumes from, minted from the last row of this one.
 *
 * @example
 * mintCursor(lastRow, [{field: "size"}, {field: "thing_id", descending: true}]);
 * // "eyJrIjpbMywidGhfOSJdLCJvIjoic2l6ZSwtdGhpbmdfaWQifQ"
 */
export function mintCursor<T = AnyRecord>(record: T, sorts: readonly Sort<T>[]): string {
  const payload = {
    k: sorts.map((sort) => tagged((record as AnyRecord)[sort.field])),
    o: signatureOf(sorts),
  };
  return encodeBase64Url(JSON.stringify(payload));
}

/**
 * A token back into its keys, or a refusal naming which half went wrong.
 *
 * @throws {InvalidCriteria} when the token will not read, or was minted under another
 * ordering — in which case the caller's fix is to drop it and start from the first page, not
 * to retry.
 */
export function readCursor(token: string, ordering: string): CursorKeys {
  let payload: { k?: unknown; o?: unknown };
  try {
    payload = JSON.parse(decodeBase64Url(token));
  } catch (error) {
    throw new InvalidCriteria(`cursor is not readable: ${String(error)}`);
  }
  if (!Array.isArray(payload.k) || typeof payload.o !== "string") {
    throw new InvalidCriteria("cursor is not readable: it carries no keys and no ordering");
  }
  if (payload.o !== ordering) {
    throw new InvalidCriteria(
      "this cursor belongs to a different ordering; start from the first page",
    );
  }
  return { keys: payload.k.map(untagged), ordering };
}

/**
 * Whether this row falls past the one a cursor names, compared the way the keyset compares.
 *
 * The first sort that differs decides, in its own direction; a row equal on every key is the
 * row the cursor was minted from and does not come back.
 */
export function beyond<T = AnyRecord>(
  record: T,
  keys: CursorKeys,
  sorts: readonly Sort<T>[],
): boolean {
  for (const [at, sort] of sorts.entries()) {
    const mine = (record as AnyRecord)[sort.field];
    const theirs = keys.keys[at];
    if (sameValue(mine, theirs)) continue;
    const side = compareValues(mine, theirs);
    return sort.descending ? side < 0 : side > 0;
  }
  return false;
}

/**
 * Marks a key whose type JSON cannot carry on its own.
 *
 * A key has to come back as the type its column compares against: a date returning as text
 * would compare as text and move the page boundary.
 */
function tagged(value: unknown): unknown {
  if (value instanceof Date) return { [DATETIME_TAG]: value.toISOString() };
  return value;
}

function untagged(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  const tags = value as Record<string, string>;
  if (DATETIME_TAG in tags) return new Date(tags[DATETIME_TAG]!);
  // A date and a decimal are tagged by the engine and read back as what they are on this
  // side: a date with no time is still a date, and a decimal that became a float would move
  // the page boundary, so it stays the text the engine wrote.
  if (DATE_TAG in tags) return tags[DATE_TAG];
  if (DECIMAL_TAG in tags) return tags[DECIMAL_TAG];
  return value;
}
