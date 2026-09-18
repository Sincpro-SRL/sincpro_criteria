/**
 * Two criteria, one.
 *
 * The same law as `Criteria.merged_with` in the engine, and it has to be the same one or two
 * readings disagree quietly: here a screen's criteria is merged onto what the user saved,
 * and on the other side it is merged again with what a permission imposes.
 *
 * | Part            | Law                          | Why                                              |
 * | --------------- | ---------------------------- | ------------------------------------------------ |
 * | `where`         | AND                          | both restrictions hold                           |
 * | `specification` | intersection                 | a mask can only take away — that is what makes it safe as a permission |
 * | `order`         | the more specific replaces   | two orderings have no combination                |
 * | `pagination`    | the more specific replaces   | "twenty per page" and "fifty per page" have none either |
 * | `grouping`      | the more specific replaces   | when it asked to group at all                    |
 * | `count`, `meta` | see below                    |                                                  |
 * | cursor          | never carried over           | it belongs to one ordering over one filter, and a merge that changed either pages through a set that no longer exists |
 *
 * @module
 */

import { combined } from "@sincpro/criteria/criteria/expression";
import type {
  AnyRecord,
  Criteria,
  Pagination,
  Specification,
} from "@sincpro/criteria/criteria/grammar";

/**
 * Both sides are `NoInfer` because they have to agree: inferred from the first argument, `T`
 * would be the record invented out of that one's field names, and the second criteria would
 * be checked against it. `T` comes from the builder or from an explicit type argument.
 */

/**
 * Whether a pagination says anything, as opposed to being the hole where one would go.
 *
 * It decides two things that look unrelated: which page survives a merge, and whether a
 * grouping answers a page of ids per bucket — the engine reads "a page was asked for" the
 * same way in both places.
 */
export function pageAsked(pagination: Pagination | undefined): boolean {
  if (pagination === undefined) return false;
  return pagination.limit !== undefined || pagination.strategy !== undefined;
}

/**
 * This mask seen through another. **Intersection, never union.**
 *
 * Every node that survives is merged with its counterpart, so the law holds at any depth.
 *
 * @example
 * narrowedBy({id: {}, name: {}, total: {}}, {id: {}, name: {}}); // {id: {}, name: {}}
 * narrowedBy({name: {}}, {total: {}});                           // {} — the identity alone
 */
export function narrowedBy<T = AnyRecord>(
  mine: NoInfer<Specification<T>>,
  theirs: NoInfer<Specification<T>> | undefined,
): Specification<T> {
  if (theirs === undefined) return mine;
  const narrowed: Record<string, Criteria> = {};
  for (const [name, node] of Object.entries(mine) as [string, Criteria][]) {
    const other = (theirs as Record<string, Criteria | undefined>)[name];
    if (other === undefined) continue;
    narrowed[name] = merge(node, other);
  }
  return narrowed as Specification<T>;
}

/**
 * This criteria plus a more specific one.
 *
 * The rule has to be total — one answer for every part — or there are combinations nobody
 * defined and each caller resolves them differently.
 *
 * Both arguments have to agree on the record type, and neither can be used to guess it — see
 * the note above `asked`. So `merge(a, b)` merges untyped, which is what two plain objects
 * want; `merge<Dataset>(a, b)` and `builder.merge(other)` keep the field names checked.
 *
 * @example
 * merge({where: a, pagination: {limit: 20}}, {where: b});
 * // {where: {all: [a, b]}, pagination: {limit: 20}}
 */
export function merge<T = AnyRecord>(
  mine: NoInfer<Criteria<T>>,
  theirs: NoInfer<Criteria<T>>,
): Criteria<T> {
  const merged: Criteria<T> = {};

  const where = combined(mine.where, theirs.where);
  if (where !== undefined) merged.where = where;

  const order = theirs.order ?? mine.order;
  if (order !== undefined) merged.order = order;

  const pagination = pagedBy(mine.pagination, theirs.pagination);
  if (pagination !== undefined) merged.pagination = pagination;

  const specification =
    mine.specification === undefined
      ? theirs.specification
      : narrowedBy(mine.specification, theirs.specification);
  if (specification !== undefined) merged.specification = specification;

  const grouping = theirs.grouping?.by?.length ? theirs.grouping : mine.grouping;
  if (grouping !== undefined) merged.grouping = grouping;

  // What nobody said is not a choice. The engine, where every field has a default and there
  // is no "unsaid", always replaces `count`; here `undefined` exists, so a criteria that says
  // nothing about counting does not overrule one that did.
  const count = theirs.count ?? mine.count;
  if (count !== undefined) merged.count = count;

  // AND, not OR: with the definition travelling by default, an OR would mean nobody could
  // ever turn it off — the more specific criteria would always be overruled by the other's
  // default.
  if (mine.meta === false || theirs.meta === false) merged.meta = false;
  else if (mine.meta !== undefined || theirs.meta !== undefined) merged.meta = true;

  return merged;
}

/**
 * The page of a merge. The more specific one wins; when it said nothing, this one's page
 * stays **without its cursor**, because the filter or the ordering may have changed.
 */
function pagedBy(
  mine: Pagination | undefined,
  theirs: Pagination | undefined,
): Pagination | undefined {
  if (pageAsked(theirs)) return theirs;
  if (mine === undefined) return undefined;
  const { limit } = mine;
  return limit === undefined ? {} : { limit };
}

/**
 * The same reading, continued from where a page ended.
 *
 * It exists for the same reason as on the Python side: writing the cursor "on top of" the
 * criteria is not enough, because the cursor lives inside the strategy — anyone writing it
 * somewhere else builds a page that never advances, and a loop walking pages that never ends.
 *
 * @example
 * resumingFrom({pagination: {limit: 80}}, page.cursor);
 * // {pagination: {limit: 80, strategy: {token: "eyJ…"}}}
 */
export function resumingFrom<T = AnyRecord>(
  criteria: Criteria<T>,
  token: string | null,
): Criteria<T> {
  return {
    ...criteria,
    pagination: { ...(criteria.pagination ?? {}), strategy: { token } },
  };
}
