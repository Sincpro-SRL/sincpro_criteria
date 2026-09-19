import type { CriteriaFor } from "@sincpro/criteria/criteria/builder";
import { plain } from "@sincpro/criteria/criteria/builder";
import type { AnyRecord, Criteria } from "@sincpro/criteria/criteria/grammar";
import { InvalidCriteria } from "@sincpro/criteria/criteria/grammar";
import { resumingFrom } from "@sincpro/criteria/criteria/merge";
import type { Meta } from "@sincpro/criteria/meta/meta";
import type { Count, Dropped, Page } from "@sincpro/criteria/page/page";
import { Store } from "@sincpro/criteria/reading/store";
import type { LiveChannel, Source } from "@sincpro/criteria/source/source";

/** What a reading is doing. */
export type ReadingStatus = "idle" | "loading" | "loadingMore" | "ready" | "failed";

/** Everything a reading knows, as one object that is replaced rather than mutated. */
export interface ReadingState<T> {
  criteria: Criteria<T>;
  rows: T[];
  cursor: string | null;
  count: Count | null;
  meta: Meta | null;
  dropped: Dropped[];
  status: ReadingStatus;
  error: unknown;

  /** Whether there is another page. */
  more: boolean;
}

/**
 * A reading: one criteria, the rows it brought back, and where it goes on.
 *
 * Built through a resource — `datasets.read(criteria)` — and driven by four methods.
 *
 * **The cursor never appears in the code that uses this.** A list asks for `more()`, a search
 * box calls `refine()`, and the rules that are easy to get wrong live here once:
 *
 * - the definition is asked for on the first page and not on the rest, because it is the same
 *   kilobyte and a half on every page of the same list;
 * - an answer that arrives after a newer one was asked for is dropped, which is the race
 *   every search box loses;
 * - the request in flight is aborted when another one starts;
 * - refining drops the cursor, because it belongs to one ordering over one filter;
 * - a first page resumed from a cursor the server refuses is read again from the beginning,
 *   since a criteria that came back from a URL outlives the ordering it was written under.
 *
 * @example
 * const reading = datasets.read(criteria<Dataset>().order("-registered_at").limit(100));
 * await reading.load();
 * await reading.more(); // infinite scroll
 * await reading.refine(base.where(searchOver(reading.meta!, typed))); // search box
 */
export class Reading<T = AnyRecord> extends Store<ReadingState<T>> {
  private readonly source: Source<T>;
  private inFlight = 0;
  private aborter: AbortController | undefined;

  constructor(source: Source<T>, criteria: CriteriaFor<T> = {}) {
    super({
      criteria: plain(criteria),
      rows: [],
      cursor: null,
      count: null,
      meta: null,
      dropped: [],
      status: "idle",
      error: undefined,
      more: false,
    });
    this.source = source;
  }

  /** The criteria this reading is over. */
  get criteria(): Criteria<T> {
    return this.snapshot().criteria;
  }

  /** The rows brought back so far: one page, or every page `more()` has added. */
  get rows(): T[] {
    return this.snapshot().rows;
  }

  /** How many match in total, as far as the source was willing to count. */
  get count(): Count | null {
    return this.snapshot().count;
  }

  /** What may be filtered, ordered and grouped — kept from the first page. */
  get meta(): Meta | null {
    return this.snapshot().meta;
  }

  /** Conditions the model could not answer. They widened the result; nothing failed. */
  get dropped(): Dropped[] {
    return this.snapshot().dropped;
  }

  get status(): ReadingStatus {
    return this.snapshot().status;
  }

  get error(): unknown {
    return this.snapshot().error;
  }

  /** Whether there is another page to ask for. */
  get hasMore(): boolean {
    return this.snapshot().more;
  }

  /** The first page. Calling it again is a reload. */
  async load(): Promise<void> {
    await this.request(this.criteria, { append: false, retryFromStart: true });
  }

  /** The same reading, read again from the first page. */
  async reload(): Promise<void> {
    await this.request(this.criteria, { append: false, retryFromStart: false });
  }

  /**
   * The next page, appended to what is already here. Nothing happens when there is no next
   * one, or while another page is already on its way.
   */
  async more(): Promise<void> {
    const { cursor, status } = this.snapshot();
    if (cursor === null || status === "loading" || status === "loadingMore") return;
    await this.request(resumingFrom(this.criteria, cursor), {
      append: true,
      retryFromStart: false,
    });
  }

  /**
   * Another reading, from the first page.
   *
   * The cursor is dropped rather than carried: it names a row under one ordering over one
   * filter, and this is another one.
   */
  async refine(criteria: CriteriaFor<T>): Promise<void> {
    const next = plain(criteria);
    this.write({ criteria: next, cursor: null });
    await this.request(next, { append: false, retryFromStart: false });
  }

  /** Back to nothing read, keeping the criteria. */
  reset(): void {
    this.aborter?.abort();
    this.write({
      rows: [],
      cursor: null,
      count: null,
      dropped: [],
      status: "idle",
      error: undefined,
      more: false,
    });
  }

  /**
   * Keeps this reading current: opens the source's live channel for this criteria, and
   * reloads whenever it invalidates. Several invalidations close together collapse into one
   * reload — ten changes in a row should mean one refetch, not ten.
   *
   * The channel is opened for the criteria as it is right now; calling `refine()` after
   * `follow()` starts a new reading with its own criteria, so follow it again if the new one
   * should stay live too.
   *
   * @throws if the source has no `live` — there is nothing to invalidate this reading.
   * @returns a function that stops following and closes the channel.
   */
  follow(debounceMs = 200): () => void {
    if (this.source.live === undefined) throw new Error(cannotFollow);

    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let channel: LiveChannel | undefined;
    let unsubscribe: (() => void) | undefined;

    void Promise.resolve(this.source.live(this.criteria)).then((opened) => {
      if (stopped) {
        opened.close();
        return;
      }
      channel = opened;
      unsubscribe = opened.onInvalidate(() => {
        if (timer !== undefined) clearTimeout(timer);
        timer = setTimeout(() => void this.reload(), debounceMs);
      });
    });

    return () => {
      stopped = true;
      if (timer !== undefined) clearTimeout(timer);
      unsubscribe?.();
      channel?.close();
    };
  }

  private async request(
    criteria: Criteria<T>,
    options: { append: boolean; retryFromStart: boolean },
  ): Promise<void> {
    this.aborter?.abort();
    const aborter = new AbortController();
    this.aborter = aborter;

    const ticket = ++this.inFlight;
    this.write({ status: options.append ? "loadingMore" : "loading", error: undefined });

    try {
      const page = await this.source.read(this.asked(criteria), aborter.signal);
      if (ticket !== this.inFlight) return; // a newer read was asked for; this one is stale
      this.keep(page, options.append);
    } catch (error) {
      if (ticket !== this.inFlight) return;

      // A cursor that came back from a URL can name an ordering that no longer exists. The
      // first page is the one thing that is always there, and nothing has been shown yet.
      if (options.retryFromStart && error instanceof InvalidCriteria && hasCursor(criteria)) {
        await this.request(withoutCursor(criteria), { append: false, retryFromStart: false });
        return;
      }
      this.write({ status: "failed", error });
    }
  }

  /**
   * The criteria as it goes out: with the definition asked for only when it is not already
   * held, unless the caller asked for it in so many words.
   */
  private asked(criteria: Criteria<T>): Criteria<T> {
    if (criteria.meta !== undefined) return criteria;
    return this.snapshot().meta === null ? criteria : { ...criteria, meta: false };
  }

  private keep(page: Page<T>, append: boolean): void {
    this.write({
      rows: append ? [...this.snapshot().rows, ...page.rows] : page.rows,
      cursor: page.cursor,
      count: page.count ?? (append ? this.snapshot().count : null),
      meta: page.meta ?? this.snapshot().meta,
      dropped: page.dropped,
      status: "ready",
      error: undefined,
      more: page.cursor !== null,
    });
  }
}

function hasCursor<T>(criteria: Criteria<T>): boolean {
  const strategy = criteria.pagination?.strategy;
  return strategy !== undefined && "token" in strategy && strategy.token !== null;
}

function withoutCursor<T>(criteria: Criteria<T>): Criteria<T> {
  const { limit } = criteria.pagination ?? {};
  return { ...criteria, pagination: limit === undefined ? {} : { limit } };
}

const cannotFollow =
  "this source does not answer `live` — there is no channel to follow. Give it one, or don't " +
  "call follow().";
