/**
 * A criteria as it travels in a URL, and back.
 *
 * **It is not another format** — the engine reads both, and plain JSON pasted into the
 * address bar keeps working. It is sent packed because a URL percent-encodes raw JSON and
 * leaves it about 82% longer, while base64 adds 33%: for the same request, 195 characters
 * instead of 266.
 *
 * @module
 */

import { decodeBase64Url, encodeBase64Url } from "@sincpro/criteria/criteria/base64";
import type { CriteriaLike } from "@sincpro/criteria/criteria/builder";
import { plain } from "@sincpro/criteria/criteria/builder";
import { readExpression } from "@sincpro/criteria/criteria/expression";
import type {
  AnyRecord,
  Criteria,
  Fold,
  FoldFunction,
  Grouping,
  Level,
  Pagination,
  Sort,
} from "@sincpro/criteria/criteria/grammar";
import {
  FOLD_FUNCTIONS,
  GRAINS,
  InvalidCriteria,
  isGrain,
} from "@sincpro/criteria/criteria/grammar";
import { parseOrder } from "@sincpro/criteria/criteria/order";

/**
 * A criteria as one URL-safe string.
 *
 * @example
 * apiUrl("/datasets", { criteria: pack(q) });
 */
export function pack<T = AnyRecord>(written: CriteriaLike<T>): string {
  return encodeBase64Url(JSON.stringify(plain(written)));
}

/**
 * The inverse of {@link pack}. Takes the packed string and plain JSON alike, because both
 * are what the engine accepts and a hand-written URL is a real thing.
 *
 * @throws {InvalidCriteria} when what arrives does not read as a criteria.
 */
export function unpack(written: string): Criteria {
  const text = written.trimStart().startsWith("{") ? written : decodeBase64Url(written);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new InvalidCriteria(`'criteria' does not read as JSON: ${String(error)}`);
  }
  return readCriteria(parsed);
}

/**
 * A criteria that came from outside — a URL, local storage, a saved reading — validated into
 * the shape the engine declares.
 *
 * Only what cannot be checked by looking is left alone: which fields exist and which
 * operators they take is the model definition's business, and that is {@link validate}.
 *
 * @throws {InvalidCriteria} when a part is written in a shape that does not exist.
 */
export function readCriteria(value: unknown): Criteria {
  if (value === null || typeof value !== "object") {
    throw new InvalidCriteria(`a criteria is an object; got ${JSON.stringify(value)}`);
  }
  const written = value as Record<string, unknown>;
  const criteria: Criteria = {};

  if (written.where !== undefined && written.where !== null) {
    criteria.where = readExpression(written.where);
  }
  if (written.order !== undefined && written.order !== null) {
    criteria.order = readOrder(written.order);
  }
  if (written.pagination !== undefined && written.pagination !== null) {
    criteria.pagination = readPagination(written.pagination);
  }
  if (written.specification !== undefined && written.specification !== null) {
    criteria.specification = readSpecification(written.specification);
  }
  if (written.grouping !== undefined && written.grouping !== null) {
    criteria.grouping = readGrouping(written.grouping);
  }
  if (written.count !== undefined) {
    const count = written.count;
    if (count !== "none" && count !== "capped" && count !== "exact") {
      throw new InvalidCriteria(
        `'count' is 'none', 'capped' or 'exact'; got ${String(count)}`,
      );
    }
    criteria.count = count;
  }
  if (written.meta !== undefined) {
    if (typeof written.meta !== "boolean") {
      throw new InvalidCriteria("'meta' is a boolean");
    }
    criteria.meta = written.meta;
  }
  return criteria;
}

function readOrder(value: unknown): Sort[] {
  if (typeof value === "string") return parseOrder(value);
  if (!Array.isArray(value)) {
    throw new InvalidCriteria(
      "'order' is a list of {field, descending} or the line a URL carries",
    );
  }
  return value.map((one) => {
    if (one === null || typeof one !== "object" || typeof (one as Sort).field !== "string") {
      throw new InvalidCriteria(
        `a sort is written {field, descending}; got ${JSON.stringify(one)}`,
      );
    }
    const sort = one as { field: string; descending?: unknown };
    return sort.descending ? { field: sort.field, descending: true } : { field: sort.field };
  });
}

function readPagination(value: unknown): Pagination {
  if (value === null || typeof value !== "object") {
    throw new InvalidCriteria("'pagination' is {limit, strategy}");
  }
  const written = value as { limit?: unknown; strategy?: unknown };
  const pagination: Pagination = {};
  if (written.limit !== undefined) {
    if (typeof written.limit !== "number" || written.limit < 0) {
      throw new InvalidCriteria("'limit' is a number of rows, zero or more");
    }
    pagination.limit = written.limit;
  }
  if (written.strategy !== undefined && written.strategy !== null) {
    const strategy = written.strategy as { token?: unknown; rows?: unknown };
    if ("token" in strategy) {
      const { token } = strategy;
      if (token !== null && typeof token !== "string") {
        throw new InvalidCriteria(
          "a cursor is the token that came back with a page, or null",
        );
      }
      pagination.strategy = { token };
    } else if ("rows" in strategy) {
      if (typeof strategy.rows !== "number") {
        throw new InvalidCriteria("'rows' is how many rows to skip");
      }
      pagination.strategy = { rows: strategy.rows };
    } else {
      throw new InvalidCriteria("a strategy is {token} or {rows}, never both");
    }
  }
  return pagination;
}

function readSpecification(value: unknown): Record<string, Criteria> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new InvalidCriteria("'specification' maps a field name to a criteria");
  }
  const mask: Record<string, Criteria> = {};
  for (const [name, node] of Object.entries(value)) {
    mask[name] = readCriteria(node ?? {});
  }
  return mask;
}

function readGrouping(value: unknown): Grouping {
  if (value === null || typeof value !== "object") {
    throw new InvalidCriteria("'grouping' is {by, totals, having, order, pagination}");
  }
  const written = value as Record<string, unknown>;
  const grouping: Grouping = {};

  if (written.by !== undefined && written.by !== null) {
    grouping.by = readLevels(written.by);
  }
  if (written.totals !== undefined && written.totals !== null) {
    grouping.totals = readTotals(written.totals);
  }
  if (written.having !== undefined && written.having !== null) {
    grouping.having = readExpression(written.having);
  }
  if (written.order !== undefined && written.order !== null) {
    grouping.order = readOrder(written.order);
  }
  if (written.pagination !== undefined && written.pagination !== null) {
    grouping.pagination = readPagination(written.pagination);
  }
  return grouping;
}

function readLevels(value: unknown): Level[] {
  if (!Array.isArray(value)) throw new InvalidCriteria("'by' is a list of levels");
  return value.map((one) => {
    const level = one as { field?: unknown; grain?: unknown } | null;
    if (level === null || typeof level !== "object" || typeof level.field !== "string") {
      throw new InvalidCriteria(
        `a level is written {field, grain}; got ${JSON.stringify(one)}`,
      );
    }
    if (level.grain == null) return { field: level.field };
    if (typeof level.grain !== "string" || !isGrain(level.grain)) {
      throw new InvalidCriteria(
        `'${String(level.grain)}' is not a grain; use one of ${GRAINS.join(", ")}`,
      );
    }
    return { field: level.field, grain: level.grain };
  });
}

function readTotals(value: unknown): Record<string, Fold> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new InvalidCriteria("'totals' maps a name to a fold");
  }
  const totals: Record<string, Fold> = {};
  for (const [name, fold] of Object.entries(value as Record<string, unknown>)) {
    if (!Array.isArray(fold) || fold.length !== 2 || typeof fold[1] !== "string") {
      throw new InvalidCriteria(
        `a fold is written [function, field], e.g. ["sum", "row_count"]; got ${JSON.stringify(fold)}`,
      );
    }
    const [aggregate, field] = fold as [unknown, string];
    if (
      typeof aggregate !== "string" ||
      !FOLD_FUNCTIONS.includes(aggregate as FoldFunction)
    ) {
      throw new InvalidCriteria(
        `'${String(aggregate)}' is not a fold; use one of ${FOLD_FUNCTIONS.join(", ")}`,
      );
    }
    totals[name] = [aggregate as FoldFunction, field];
  }
  return totals;
}
