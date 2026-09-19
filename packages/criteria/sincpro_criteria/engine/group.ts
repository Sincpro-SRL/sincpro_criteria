import type {
  AnyRecord,
  Criteria,
  Expression,
  Grouping,
  Level,
  Value,
} from "@sincpro/criteria/criteria/grammar";
import { merge, pageAsked } from "@sincpro/criteria/criteria/merge";
import { compareValues, missing } from "@sincpro/criteria/engine/compare";
import { mintCursor } from "@sincpro/criteria/engine/cursor";
import { matches } from "@sincpro/criteria/engine/evaluate";
import type { Range } from "@sincpro/criteria/engine/grain";
import { cutTo, rangeOf } from "@sincpro/criteria/engine/grain";
import { measured } from "@sincpro/criteria/engine/measure";
import { orderingFor, sortRows } from "@sincpro/criteria/engine/sort";
import type { Meta } from "@sincpro/criteria/meta/meta";
import type { Bucket } from "@sincpro/criteria/page/page";

/**
 * The buckets a criteria's grouping asks for, over rows already filtered.
 *
 * One pass per level, and the levels below a bucket see only that bucket's rows — the same
 * shape the engine answers with one statement per level.
 *
 * @example
 * bucketsOf(rows, criteria().groupBy("encoding").measures({ rows: measure.sum("row_count") }).value, meta);
 */
export function bucketsOf<T = AnyRecord>(
  rows: readonly T[],
  criteria: Criteria<T>,
  meta: Meta,
): Bucket<T>[] {
  const grouping = criteria.grouping;
  if (grouping?.group_by === undefined || grouping.group_by.length === 0) return [];
  return tree(rows, grouping, criteria, grouping.group_by, meta);
}

function tree<T>(
  rows: readonly T[],
  grouping: Grouping<T>,
  criteria: Criteria<T>,
  levels: readonly Level<T>[],
  meta: Meta,
): Bucket<T>[] {
  const [level, ...rest] = levels;
  if (level === undefined) return [];

  const held = new Map<string, { value: unknown; range: Range | undefined; rows: T[] }>();
  for (const row of rows) {
    const raw = (row as AnyRecord)[level.field];
    const value = level.grain ? cutTo(raw, level.grain) : raw;
    const key = keyOf(value);
    const bucket = held.get(key);
    if (bucket === undefined) {
      // The range is read off the RAW value, while it is still an instant. The label the
      // bucket carries — "2026-01" — is not one, so a range read back from it would be
      // nothing at all, and the bucket would open on an equality that matches no row.
      held.set(key, {
        value,
        range: level.grain ? rangeOf(raw, level.grain) : undefined,
        rows: [row],
      });
    } else {
      bucket.rows.push(row);
    }
  }

  const buckets: Bucket<T>[] = [];
  for (const { value, range, rows: mine } of held.values()) {
    const numbers = measured(mine, grouping.measures);

    if (grouping.where_measures !== undefined) {
      // `having` reads the numbers the group folded, plus `count` — never the rows' own
      // fields, which is what `where` is for.
      const answered = { count: mine.length, ...numbers };
      if (!matches(answered, grouping.where_measures as Expression)) continue;
    }

    // The reading that opens this bucket. The grouping is cleared: opening a bucket lists its
    // rows, and a criteria that still asked to group would count them again instead.
    const opens: Criteria<T> = {
      ...merge<T>(criteria, { where: conditionFor(level, value, range) }),
      grouping: {},
    };
    const { ids, cursor } = pageOfIds(mine, criteria, meta);

    buckets.push({
      field: level.field,
      value,
      count: mine.length,
      measures: numbers,
      criteria: opens,
      ids,
      cursor,
      groups: tree(mine, grouping, opens, rest, meta),
    });
  }

  return paged(ordered(buckets, grouping as Grouping), grouping as Grouping);
}

/**
 * The filter that names one bucket.
 *
 * A grained level is a RANGE and not an equality: the bucket is labelled `"2026-01"` while
 * the rows hold instants, so `registered_at = "2026-01"` would match nothing at all.
 */
function conditionFor<T>(
  level: Level<T>,
  value: unknown,
  range: Range | undefined,
): Expression<T> {
  const field = level.field;
  if (range === undefined) return { field, operator: "=", value: value as Value };
  return {
    all: [
      { field, operator: ">=", value: range.from },
      { field, operator: "<", value: range.to },
    ],
  };
}

/**
 * The identities of a bucket's first page, and where the next one starts inside it.
 *
 * Only when the criteria asked for a page. Ids and not records, the way the engine answers:
 * light enough for thousands of buckets, and enough to select, compare and open later.
 */
function pageOfIds<T>(
  rows: readonly T[],
  criteria: Criteria<T>,
  meta: Meta,
): { ids: unknown[]; cursor: string | null } {
  if (!pageAsked(criteria.pagination)) return { ids: [], cursor: null };
  const sorts = orderingFor(criteria, meta);
  const inOrder = sortRows(rows, sorts);
  const limit = criteria.pagination?.limit ?? inOrder.length;
  const kept = inOrder.slice(0, limit);
  const last = kept[kept.length - 1];
  return {
    ids: kept.map((row) => (row as AnyRecord)[meta.identity]),
    cursor: inOrder.length > limit && last !== undefined ? mintCursor(last, sorts) : null,
  };
}

/** The buckets of one level, in the order the grouping asked for. */
function ordered<T>(buckets: Bucket<T>[], grouping: Grouping): Bucket<T>[] {
  const sorted = [...buckets];
  if (grouping.order === undefined || grouping.order.length === 0) {
    sorted.sort((mine, theirs) => byValue(mine.value, theirs.value));
    return sorted;
  }
  for (const sort of [...grouping.order].reverse()) {
    sorted.sort((mine, theirs) => {
      const side = compareByName(mine, theirs, sort.field);
      return sort.descending ? -side : side;
    });
  }
  return sorted;
}

/**
 * Two buckets by what they are ordered by: their count, one of their folds, or their own
 * value — which is compared as text, because a level splits by whatever the column holds.
 */
function compareByName<T>(mine: Bucket<T>, theirs: Bucket<T>, name: string): number {
  if (name === "count") return compareValues(mine.count, theirs.count);
  if (mine.measures !== undefined && name in mine.measures) {
    return compareValues(mine.measures[name], theirs.measures?.[name]);
  }
  return byValue(mine.value, theirs.value);
}

/** Bucket values as text, with the empty ones last. */
function byValue(mine: unknown, theirs: unknown): number {
  if (missing(mine) && missing(theirs)) return 0;
  if (missing(mine)) return 1;
  if (missing(theirs)) return -1;
  return compareValues(asText(mine), asText(theirs));
}

function asText(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

/** How many buckets of this level come back. Without a page, every one of them. */
function paged<T>(buckets: Bucket<T>[], grouping: Grouping): Bucket<T>[] {
  const pagination = grouping.pagination;
  if (pagination === undefined) return buckets;
  const strategy = pagination.strategy;
  const from = strategy !== undefined && "rows" in strategy ? strategy.rows : 0;
  const limit = pagination.limit ?? buckets.length;
  return buckets.slice(from, from + limit);
}

/**
 * The key two rows share when they belong to the same bucket.
 *
 * A `Map` keyed by the value itself would give two buckets for two `Date` objects naming the
 * same instant, and one bucket for the number `1` and the text `"1"`.
 */
function keyOf(value: unknown): string {
  if (missing(value)) return "null:";
  if (value instanceof Date) return `datetime:${value.toISOString()}`;
  if (typeof value === "object") return `json:${JSON.stringify(value)}`;
  return `${typeof value}:${String(value)}`;
}
