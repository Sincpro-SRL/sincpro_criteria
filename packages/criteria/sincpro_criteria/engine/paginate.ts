import type { AnyRecord, Criteria, Sort } from "@sincpro/criteria/criteria/grammar";
import { beyond, readCursor, signatureOf } from "@sincpro/criteria/engine/cursor";
import { mintCursor } from "@sincpro/criteria/engine/cursor";

/** How many rows a page brings when nobody said. The engine's own default. */
export const DEFAULT_LIMIT = 50;

/** A page of rows and where the next one starts. */
export interface Paged<T> {
  rows: T[];
  cursor: string | null;
}

/**
 * The page a criteria asks for, out of rows already sorted in that criteria's order.
 *
 * The cursor comes back only when there is a next page **and** the strategy is one that
 * resumes: a caller counting rows already knows its next count, so minting a token for it
 * would be inventing a second way to say the same thing.
 *
 * @throws {InvalidCriteria} when the cursor was minted under another ordering.
 */
export function paginate<T = AnyRecord>(
  ordered: readonly T[],
  criteria: Criteria<T>,
  sorts: readonly Sort<T>[],
): Paged<T> {
  const { limit = DEFAULT_LIMIT, strategy } = criteria.pagination ?? {};

  let walked = [...ordered];
  if (strategy !== undefined && "token" in strategy && strategy.token !== null) {
    const keys = readCursor(strategy.token, signatureOf(sorts));
    walked = walked.filter((row) => beyond(row, keys, sorts));
  }
  if (strategy !== undefined && "rows" in strategy) {
    walked = walked.slice(strategy.rows);
  }

  const rows = walked.slice(0, limit);
  const more = walked.length > limit;
  const resumable = strategy === undefined || "token" in strategy;
  const last = rows[rows.length - 1];

  return {
    rows,
    cursor: more && last !== undefined && resumable ? mintCursor(last, sorts) : null,
  };
}
