/**
 * Where rows come from.
 *
 * **This is the whole seam between this package and the outside world**, and it is one
 * function. A source takes a criteria and answers a page; whether it fetched it, computed it
 * or had it in an array already is nobody else's business.
 *
 * ```ts
 * const datasets = resource<Dataset>({
 *   read: async (criteria) => pageFrom(await myFetch(`/datasets?criteria=${pack(criteria)}`)),
 * });
 * ```
 *
 * `group` and `pivot` are optional. A source that does not answer them says so by not having
 * them, and a resource can be told to work them out in memory instead — see
 * {@link resource}. Nothing here decides that on its own: falling back to "fetch everything
 * and group it here" without being asked is how a screen quietly downloads a table.
 *
 * @module
 */

import type { AnyRecord, Criteria } from "@sincpro/criteria/criteria/grammar";
import type { Axes } from "@sincpro/criteria/engine/pivot";
import type { Bucket, Page, Pivot } from "@sincpro/criteria/page/page";

/** A value, or a promise of one. A source in memory answers without waiting. */
export type Awaitable<T> = T | Promise<T>;

/** Where rows come from. One required method, two optional ones. */
export interface Source<T = AnyRecord> {
  /** The page this criteria asks for. */
  read(criteria: Criteria<T>, signal?: AbortSignal): Awaitable<Page<T>>;

  /**
   * The buckets this criteria's grouping asks for.
   *
   * A page of buckets, because that is what the engine answers: the same envelope, with the
   * buckets under a field name of their own.
   */
  group?(criteria: Criteria<T>, signal?: AbortSignal): Awaitable<Page<Bucket<T>>>;

  /** Groups crossed by groups. The axes are not part of a criteria. */
  pivot?(criteria: Criteria<T>, axes: Axes<T>, signal?: AbortSignal): Awaitable<Pivot>;
}
