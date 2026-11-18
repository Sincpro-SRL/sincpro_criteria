import type { CriteriaFor } from "@sincpro/criteria/criteria/builder";
import type { WrittenLevel } from "@sincpro/criteria/criteria/builder";
import { criteria as build, plain } from "@sincpro/criteria/criteria/builder";
import type { AnyRecord, Criteria } from "@sincpro/criteria/criteria/grammar";
import type { Meta } from "@sincpro/criteria/meta/meta";
import type { Bucket, Count, Dropped, Page } from "@sincpro/criteria/page/page";
import { Reading } from "@sincpro/criteria/reading/reading";
import { Store } from "@sincpro/criteria/reading/store";
import type { Source } from "@sincpro/criteria/source/source";

/** What a level of buckets is doing. */
export type BucketsStatus = "idle" | "loading" | "ready" | "failed";

/** Everything a level of buckets knows. */
export interface BucketsState<T> {
  criteria: Criteria<T>;
  buckets: Bucket<T>[];
  count: Count | null;
  meta: Meta | null;
  dropped: Dropped[];
  status: BucketsStatus;
  error: unknown;
}

/**
 * How a level of buckets starts: `page`, the groups of this same criteria already read
 * somewhere else — on the server, with `resource.groups(criteria)`. It starts `ready` with them,
 * and its first `load()` keeps them instead of asking again (see `ReadingOptions`).
 */
export interface BucketsOptions<T> {
  page?: Page<Bucket<T>>;
}

/**
 * One level of a grouping over one source, and how to go down from it.
 *
 * A grouping is answered one level at a time: a screen that drills down one click at a time
 * asks for one level, and on the click reads the bucket it was given. **Opening a bucket is a
 * read with the criteria the bucket carries** — nobody rebuilds a filter here.
 *
 * What has to survive a reload is each open bucket's criteria, and a criteria packs into a
 * URL, so the state of an opened tree is `pack(bucket.criteria)` per open branch. There is no
 * tree object holding that: which branches are open is the screen's business, and the screen
 * already knows.
 *
 * @example
 * const tree = datasets.group(criteria<Dataset>().groupBy("encoding"));
 * await tree.load();
 *
 * const rows = tree.open(tree.buckets[0]); // the rows of that bucket
 * await rows.load();
 *
 * const months = tree.drill(tree.buckets[0], { field: "registered_at", grain: "month" });
 * await months.load();
 */
export class Buckets<T = AnyRecord> extends Store<BucketsState<T>> {
  private readonly source: Source<T>;
  private inFlight = 0;
  private aborter: AbortController | undefined;
  /** Born with a page that the first `load()` keeps; any request asked before that drops it. */
  private seeded: boolean;

  constructor(
    source: Source<T>,
    criteria: CriteriaFor<T> = {},
    options: BucketsOptions<T> = {},
  ) {
    const { page } = options;
    super({
      criteria: plain(criteria),
      buckets: page?.rows ?? [],
      count: page?.count ?? null,
      meta: page?.meta ?? null,
      dropped: page?.dropped ?? [],
      status: page === undefined ? "idle" : "ready",
      error: undefined,
    });
    this.source = source;
    this.seeded = page !== undefined;
  }

  get criteria(): Criteria<T> {
    return this.snapshot().criteria;
  }

  get buckets(): Bucket<T>[] {
    return this.snapshot().buckets;
  }

  get count(): Count | null {
    return this.snapshot().count;
  }

  get meta(): Meta | null {
    return this.snapshot().meta;
  }

  get dropped(): Dropped[] {
    return this.snapshot().dropped;
  }

  get status(): BucketsStatus {
    return this.snapshot().status;
  }

  get error(): unknown {
    return this.snapshot().error;
  }

  /** The buckets of this level — kept, the first time, when it was born with them. */
  async load(): Promise<void> {
    if (this.seeded) {
      this.seeded = false;
      return;
    }
    await this.request(this.criteria);
  }

  /** The same levels over another reading. */
  async refine(criteria: CriteriaFor<T>): Promise<void> {
    const next = plain(criteria);
    this.write({ criteria: next });
    await this.request(next);
  }

  /**
   * The rows of one bucket, as a reading of its own.
   *
   * It is not loaded yet: the caller decides when, because a bucket is usually opened by a
   * click.
   */
  open(bucket: Bucket<T>): Reading<T> {
    return new Reading<T>(this.source, bucket.criteria);
  }

  /** The level below one bucket: its own reading, grouped one level further. */
  drill(bucket: Bucket<T>, ...levels: WrittenLevel<T>[]): Buckets<T> {
    return new Buckets<T>(this.source, build<T>(bucket.criteria).groupBy(...levels));
  }

  private async request(criteria: Criteria<T>): Promise<void> {
    this.seeded = false;
    if (this.source.group === undefined) {
      this.write({
        status: "failed",
        error: new Error(
          "this source does not group. Give it a `group`, or build the resource with " +
            "`{ groupLocally: true }` and it will read every matching row and group them here.",
        ),
      });
      return;
    }

    this.aborter?.abort();
    const aborter = new AbortController();
    this.aborter = aborter;

    const ticket = ++this.inFlight;
    this.write({ status: "loading", error: undefined });

    try {
      const page = await this.source.group(criteria, aborter.signal);
      if (ticket !== this.inFlight) return;
      this.write({
        buckets: page.rows,
        count: page.count,
        meta: page.meta ?? this.snapshot().meta,
        dropped: page.dropped,
        status: "ready",
        error: undefined,
      });
    } catch (error) {
      if (ticket !== this.inFlight) return;
      this.write({ status: "failed", error });
    }
  }
}
