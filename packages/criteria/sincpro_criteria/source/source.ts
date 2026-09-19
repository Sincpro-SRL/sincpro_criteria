import type { AnyRecord, Criteria } from "@sincpro/criteria/criteria/grammar";
import type { Axes } from "@sincpro/criteria/engine/pivot";
import type { Bucket, Page, Pivot } from "@sincpro/criteria/page/page";

/** A value, or a promise of one. A source in memory answers without waiting. */
export type Awaitable<T> = T | Promise<T>;

/**
 * A channel that says "this criteria's answer may be stale now" — never rows.
 *
 * `read()` stays the one source of truth: nothing arriving over this channel can ever disagree
 * with a pull about what a row looks like, because nothing here ever carries a row. This is
 * deliberate — see `docs/DESIGN.md` at the repo root ("Real time: invalidate, don't stream
 * diffs") for why a `Reading`'s cursor makes a row-level diff stream the wrong shape for this.
 */
export interface LiveChannel {
  /** Calls `fn` on every invalidation. Returns the function that stops listening. */
  onInvalidate(fn: () => void): () => void;

  /** Releases whatever this channel was holding open (a socket, a subscription, …). */
  close(): void;
}

/**
 * Where rows come from. One required method, the rest optional.
 *
 * **This is the whole seam between this package and the outside world.** A source takes a
 * criteria and answers a page; whether it fetched it, computed it or had it in an array
 * already is nobody else's business.
 *
 * `group` and `pivot` are optional — a source that does not answer them says so by not having
 * them, and {@link resource} can be told to work them out in memory instead. Nothing here
 * decides that on its own: falling back to "fetch everything and group it here" without being
 * asked is how a screen quietly downloads a table.
 *
 * @example
 * const datasets = resource<Dataset>({
 *   read: async (criteria) => pageFrom(await myFetch(`/datasets?criteria=${pack(criteria)}`)),
 * });
 */
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

  /**
   * A channel that invalidates this criteria's reading — a `WebSocket`, an `EventSource`, a
   * consumer's own event bus, anything that eventually calls `onInvalidate`'s callback. Names
   * no transport on purpose: {@link Reading.follow} is the one thing that calls this, and it
   * does not care what is on the other end.
   */
  live?(criteria: Criteria<T>): Awaitable<LiveChannel>;
}
