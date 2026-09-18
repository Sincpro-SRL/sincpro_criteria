import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Criteria, Page, Source } from "@sincpro/criteria";
import {
  criteria,
  eq,
  fromRows,
  InvalidCriteria,
  resource,
  searchOver,
} from "@sincpro/criteria";

import type { Dataset } from "./fixtures";
import { datasetMeta } from "./fixtures";

const rows: Dataset[] = [
  {
    dataset_id: "d1",
    name: "labs.csv",
    encoding: "utf-8",
    row_count: 300,
    registered_at: "2026-01-10T00:00:00.000Z",
    producer_id: "p1",
    tags: ["raw"],
  },
  {
    dataset_id: "d2",
    name: "sales.csv",
    encoding: "utf-8",
    row_count: 1200,
    registered_at: "2026-01-20T00:00:00.000Z",
    producer_id: null,
    tags: ["raw"],
  },
  {
    dataset_id: "d3",
    name: "stock.csv",
    encoding: "latin-1",
    row_count: 50,
    registered_at: "2026-02-03T00:00:00.000Z",
    producer_id: "p1",
    tags: [],
  },
  {
    dataset_id: "d4",
    name: "trips.csv",
    encoding: "utf-8",
    row_count: 9000,
    registered_at: "2026-02-28T00:00:00.000Z",
    producer_id: "p2",
    tags: ["clean"],
  },
  {
    dataset_id: "d5",
    name: "users.csv",
    encoding: "latin-1",
    row_count: 700,
    registered_at: "2026-03-05T00:00:00.000Z",
    producer_id: "p2",
    tags: ["raw"],
  },
];

const datasets = () => resource<Dataset>(fromRows(rows, { meta: datasetMeta }));

/** A source that answers when it is told to, so a race can be written down. */
function controlled() {
  const inner = fromRows<Dataset>(rows, { meta: datasetMeta });
  const waiting: { criteria: Criteria<Dataset>; settle: (page: Page<Dataset>) => void }[] =
    [];
  const source: Source<Dataset> = {
    read: (written) =>
      new Promise<Page<Dataset>>((resolve) => {
        waiting.push({
          criteria: written,
          settle: () => resolve(inner.read(written) as Page<Dataset>),
        });
      }),
  };
  return {
    source,
    asked: () => waiting.map((one) => one.criteria),
    answer: (at: number) => waiting[at]!.settle({} as Page<Dataset>),
  };
}

describe("a reading", () => {
  it("brings the first page and says there is more", async () => {
    const reading = datasets().read(criteria<Dataset>().order("dataset_id").limit(2));
    await reading.load();

    assert.deepEqual(
      reading.rows.map((one) => one.dataset_id),
      ["d1", "d2"],
    );
    assert.deepEqual(reading.count, { value: 5, exact: true });
    assert.equal(reading.status, "ready");
    assert.equal(reading.hasMore, true);
  });

  it("adds page after page without the caller ever holding a cursor", async () => {
    const reading = datasets().read(criteria<Dataset>().order("dataset_id").limit(2));
    await reading.load();
    await reading.more();
    await reading.more();

    assert.deepEqual(
      reading.rows.map((one) => one.dataset_id),
      ["d1", "d2", "d3", "d4", "d5"],
    );
    assert.equal(reading.hasMore, false);
  });

  it("does nothing when asked for more than there is", async () => {
    const reading = datasets().read(criteria<Dataset>().limit(10));
    await reading.load();
    await reading.more();
    assert.equal(reading.rows.length, 5);
  });

  it("starts over when it is refined, keeping no cursor", async () => {
    const base = criteria<Dataset>().order("dataset_id").limit(2);
    const reading = datasets().read(base);
    await reading.load();
    await reading.more();
    assert.equal(reading.rows.length, 4);

    await reading.refine(base.where(eq("encoding", "latin-1")));
    assert.deepEqual(
      reading.rows.map((one) => one.dataset_id),
      ["d3", "d5"],
    );
    assert.equal(reading.criteria.pagination?.strategy, undefined, "the cursor is gone");
  });

  it("asks for the definition once and not on every page", async () => {
    const asked: Criteria<Dataset>[] = [];
    const inner = fromRows<Dataset>(rows, { meta: datasetMeta });
    const reading = resource<Dataset>({
      read: (written) => {
        asked.push(written);
        return inner.read(written);
      },
    }).read(criteria<Dataset>().order("dataset_id").limit(2));

    await reading.load();
    await reading.more();

    assert.equal(asked[0]?.meta, undefined, "the first page takes the default, which is on");
    assert.equal(asked[1]?.meta, false, "the second one already has the definition");
    assert.equal(reading.meta, datasetMeta, "and keeps it");
  });

  it("obeys a caller that asked for the definition in so many words", async () => {
    const asked: Criteria<Dataset>[] = [];
    const inner = fromRows<Dataset>(rows, { meta: datasetMeta });
    const reading = resource<Dataset>({
      read: (written) => {
        asked.push(written);
        return inner.read(written);
      },
    }).read(criteria<Dataset>().order("dataset_id").limit(2).meta(true));

    await reading.load();
    await reading.more();
    assert.equal(asked[1]?.meta, true);
  });

  it("reports what the model could not answer, without failing", async () => {
    const reading = datasets().read(criteria<Dataset>().where(eq("gone" as never, 1)));
    await reading.load();
    assert.deepEqual(reading.dropped, [{ field: "gone", reason: "unknown_field" }]);
    assert.equal(reading.status, "ready");
  });

  it("holds the failure instead of throwing it at whoever called", async () => {
    const reading = resource<Dataset>({
      read: () => Promise.reject(new Error("the network is down")),
    }).read();

    await reading.load();
    assert.equal(reading.status, "failed");
    assert.equal((reading.error as Error).message, "the network is down");
  });

  it("tells whoever is watching, and stops when they leave", async () => {
    const reading = datasets().read(criteria<Dataset>().limit(2));
    let heard = 0;
    const stop = reading.subscribe(() => {
      heard += 1;
    });

    await reading.load();
    assert.ok(heard >= 2, "at least the loading and the answer");

    const before = heard;
    stop();
    await reading.reload();
    assert.equal(heard, before);
  });

  it("keeps the same snapshot until something changes", async () => {
    const reading = datasets().read();
    const first = reading.snapshot();
    assert.equal(reading.snapshot(), first);
    await reading.load();
    assert.notEqual(reading.snapshot(), first);
  });
});

describe("the race a search box loses", () => {
  it("drops an answer that arrives after a newer one was asked for", async () => {
    const stage = controlled();
    const reading = resource<Dataset>(stage.source).read(criteria<Dataset>());

    const slow = reading.load();
    const fast = reading.refine(
      criteria<Dataset>().order("dataset_id").where(eq("encoding", "latin-1")),
    );

    // The second question is answered first, and then the first one comes back late.
    stage.answer(1);
    await fast;
    stage.answer(0);
    await slow;

    assert.deepEqual(
      reading.rows.map((one) => one.dataset_id),
      ["d3", "d5"],
      "what is shown is the answer to the last question asked",
    );
  });
});

describe("a first page resumed from a cursor that is no longer valid", () => {
  it("is read again from the beginning, because nothing had been shown yet", async () => {
    let asked = 0;
    const inner = fromRows<Dataset>(rows, { meta: datasetMeta });
    const reading = resource<Dataset>({
      read: (written) => {
        asked += 1;
        const strategy = written.pagination?.strategy;
        if (strategy !== undefined && "token" in strategy && strategy.token !== null) {
          throw new InvalidCriteria("this cursor belongs to a different ordering");
        }
        return inner.read(written);
      },
    }).read(criteria<Dataset>().order("dataset_id").limit(2).resumingFrom("a-stale-token"));

    await reading.load();

    assert.equal(asked, 2, "the refusal, and then the first page");
    assert.equal(reading.status, "ready");
    assert.deepEqual(
      reading.rows.map((one) => one.dataset_id),
      ["d1", "d2"],
    );
  });

  it("is not retried when it was a next page: that would move what is on screen", async () => {
    const inner = fromRows<Dataset>(rows, { meta: datasetMeta });
    const reading = resource<Dataset>({
      read: (written) => {
        const strategy = written.pagination?.strategy;
        if (strategy !== undefined && "token" in strategy && strategy.token !== null) {
          throw new InvalidCriteria("this cursor belongs to a different ordering");
        }
        return inner.read(written);
      },
    }).read(criteria<Dataset>().order("dataset_id").limit(2));

    await reading.load();
    await reading.more();

    assert.equal(reading.status, "failed");
    assert.deepEqual(
      reading.rows.map((one) => one.dataset_id),
      ["d1", "d2"],
      "what was already read stays where it was",
    );
  });
});

describe("a search box, end to end", () => {
  it("filters by what the model says can be searched", async () => {
    const reading = datasets().read(criteria<Dataset>().limit(10));
    await reading.load();

    await reading.refine(
      criteria<Dataset>().limit(10).where(searchOver(reading.meta!, "csv")),
    );
    assert.equal(reading.rows.length, 5);

    await reading.refine(
      criteria<Dataset>().limit(10).where(searchOver(reading.meta!, "trips")),
    );
    assert.deepEqual(
      reading.rows.map((one) => one.dataset_id),
      ["d4"],
    );
  });
});
