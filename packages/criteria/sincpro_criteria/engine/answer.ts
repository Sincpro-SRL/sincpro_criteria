import type { CriteriaFor } from "@sincpro/criteria/criteria/builder";
import { plain } from "@sincpro/criteria/criteria/builder";
import type { AnyRecord } from "@sincpro/criteria/criteria/grammar";
import { InvalidCriteria } from "@sincpro/criteria/criteria/grammar";
import { filtered } from "@sincpro/criteria/engine/evaluate";
import { bucketsOf } from "@sincpro/criteria/engine/group";
import { paginate } from "@sincpro/criteria/engine/paginate";
import { orderingFor, sortRows } from "@sincpro/criteria/engine/sort";
import type { Meta } from "@sincpro/criteria/meta/meta";
import type { Bucket, Page } from "@sincpro/criteria/page/page";
import { validate } from "@sincpro/criteria/validate";

/**
 * The page a criteria asks for, out of the rows given.
 *
 * What the model cannot answer is dropped and reported, exactly as a server would; what it
 * would refuse is thrown, also as a server would, because a page ordered by a column that
 * cannot be paged is not a page with a warning — it is a page missing rows.
 *
 * @throws {InvalidCriteria} when the criteria asks for something the model refuses.
 *
 * @example
 * answer(rows, criteria().where(eq("encoding", "utf-8")).limit(20), meta);
 */
export function answer<T = AnyRecord>(
  rows: readonly T[],
  written: CriteriaFor<T>,
  meta: Meta,
): Page<T> {
  const { criteria, dropped, refused } = validate<T>(plain(written), meta);
  if (refused.length > 0) throw new InvalidCriteria(refused[0]!.message);

  const matching = filtered(rows, criteria.where);
  const sorts = orderingFor(criteria, meta);
  const page = paginate(sortRows(matching, sorts), criteria, sorts);

  return {
    rows: page.rows,
    cursor: page.cursor,
    // In memory there is nothing to cap: the rows are all here, so the count is exact
    // whatever the criteria was willing to settle for.
    count: criteria.count === "none" ? null : { value: matching.length, exact: true },
    meta: criteria.meta === false ? null : meta,
    dropped,
  };
}

/**
 * The buckets a criteria's grouping asks for, out of the rows given.
 *
 * A grouped answer is a page of buckets — the engine gives them a field name of their own and
 * the same envelope around them — so this is the same shape as {@link answer}, with `rows`
 * holding the buckets of the first level.
 *
 * @throws {InvalidCriteria} when the criteria asks for something the model refuses.
 */
export function answerGroups<T = AnyRecord>(
  rows: readonly T[],
  written: CriteriaFor<T>,
  meta: Meta,
): Page<Bucket<T>> {
  const { criteria, dropped, refused } = validate<T>(plain(written), meta);
  if (refused.length > 0) throw new InvalidCriteria(refused[0]!.message);

  const matching = filtered(rows, criteria.where);
  return {
    rows: bucketsOf(matching, criteria, meta),
    cursor: null,
    count: criteria.count === "none" ? null : { value: matching.length, exact: true },
    meta: criteria.meta === false ? null : meta,
    dropped,
  };
}
