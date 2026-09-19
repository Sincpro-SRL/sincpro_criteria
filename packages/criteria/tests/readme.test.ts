/**
 * The examples the README shows, compiled and run.
 *
 * Documentation that is not executed rots quietly: a rename leaves the prose behind and the
 * first thing a newcomer copies is the thing that no longer works. Everything here appears in
 * the README, and `make test` and `make typecheck` both run it.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Criteria, Filter } from "@sincpro/criteria";
import {
  conditionsOf,
  criteria,
  explain,
  explainFilter,
  fieldsThatSort,
  forSaving,
  fromRows,
  measure,
  merge,
  pack,
  pageFrom,
  resource,
  searchOver,
  unpack,
  validate,
  where,
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
    name: "draft.csv",
    encoding: "latin-1",
    row_count: 50,
    registered_at: "2026-02-03T00:00:00.000Z",
    producer_id: "p2",
    tags: [],
  },
];

/** The five lines a REST adapter is, with the fetch left out. */
const datasets = resource<Dataset>(async (q) => pageFrom<Dataset>(await served(pack(q))));

/** What a server answers: the records under their own name, and the envelope around them. */
async function served(packed: string) {
  const page = await fromRows<Dataset>(rows, { meta: datasetMeta }).read(
    unpack(packed) as Criteria<Dataset>,
  );
  return {
    datasets: page.rows,
    cursor: page.cursor,
    count: page.count,
    model_meta_data: page.meta,
    dropped: page.dropped,
  };
}

describe("README · a filtered page", () => {
  it("is one line per query", async () => {
    const page = await datasets.page(
      criteria<Dataset>().where(["encoding", "=", "utf-8"]).order("-registered_at").limit(20),
    );
    assert.deepEqual(
      page.rows.map((one) => one.dataset_id),
      ["d2", "d1"],
    );
  });
});

describe("README · a filter that reads left to right", () => {
  it("is triples, and three functions for the structure", () => {
    const q = criteria<Dataset>().where(
      ["encoding", "=", "utf-8"],
      ["row_count", ">", 1000],
      where.any(["tags", "contains", "raw"], ["producer_id", "is null", true]),
      where.negate(["name", "like", "draft"]),
    );
    assert.equal(conditionsOf(q.value.where).length, 5);
  });

  it("is a value a function can return", () => {
    const mine = (): Filter<Dataset> =>
      where.any(["tags", "contains", "raw"], ["producer_id", "is null", true])!;
    assert.ok(criteria<Dataset>().where(mine()).value.where);
  });
});

describe("README · infinite scroll", () => {
  it("never shows a cursor", async () => {
    const reading = datasets.read(criteria<Dataset>().order("dataset_id").limit(2));
    await reading.load();
    await reading.more();
    assert.equal(reading.rows.length, 3);
    assert.equal(reading.hasMore, false);
  });
});

describe("README · a search box", () => {
  it("asks what the model says can be searched", async () => {
    const reading = datasets.read(criteria<Dataset>().limit(10));
    await reading.load();
    await reading.refine(
      criteria<Dataset>().limit(10).where(searchOver(reading.meta!, "labs")),
    );
    assert.deepEqual(
      reading.rows.map((one) => one.dataset_id),
      ["d1"],
    );
  });
});

describe("README · grouping", () => {
  it("opens a bucket with the criteria the bucket carries", async () => {
    const local = resource(fromRows(rows, { meta: datasetMeta }));
    const tree = local.group(
      criteria<Dataset>()
        .groupBy("encoding")
        .measures({ rows: measure.sum("row_count") })
        .whereMeasures(["count", ">", 1]),
    );
    await tree.load();
    assert.deepEqual(
      tree.buckets.map((one) => one.value),
      ["utf-8"],
    );

    const inside = tree.open(tree.buckets[0]!);
    await inside.load();
    assert.equal(inside.rows.length, 2);
  });
});

describe("README · a saved reading", () => {
  it("is saved, read back, built upon and drawn", async () => {
    const q = criteria<Dataset>()
      .where(["encoding", "=", "utf-8"])
      .order("-registered_at")
      .limit(20);

    const written = pack(forSaving(q.value));
    const saved = unpack(written);

    // run it
    const page = await datasets.page(saved);
    assert.equal(page.rows.length, 2);

    // go on building over it
    const narrowed = criteria<Dataset>(saved).where(["row_count", ">", 1000]);
    assert.equal(conditionsOf(narrowed.value.where).length, 2);

    // cross it with what the screen always adds
    assert.ok(merge(saved, { count: "exact" }).count === "exact");

    // draw its chips
    assert.deepEqual(
      conditionsOf(saved.where).map((one) => explainFilter(one, { meta: datasetMeta })),
      ['Encoding = "utf-8"'],
    );

    // and say what it is, in one line
    assert.equal(
      explain(saved, { meta: datasetMeta }),
      'Datasets, where Encoding = "utf-8", by Registered ↓, 20 per page',
    );
  });

  it("is saved without its cursor, which does not outlive the reading", () => {
    const walked = criteria<Dataset>().limit(20).cursor("eyJrIjo");
    assert.deepEqual(forSaving(walked.value).pagination, { limit: 20 });
  });
});

describe("README · rows already in hand", () => {
  it("answers the same criteria with no server at all", async () => {
    const local = resource(fromRows(rows));
    const page = await local.page(
      criteria().where(["encoding", "=", "utf-8"]).order("dataset_id"),
    );
    assert.equal(page.rows.length, 2);
  });
});

describe("README · what the model says can be asked", () => {
  it("is what a menu is built from, and what is checked before sending", () => {
    assert.ok(!fieldsThatSort(datasetMeta).includes("producer_id"));

    const { dropped, refused } = validate(
      criteria<Dataset>().where(["gone" as never, "=", 1]),
      datasetMeta,
    );
    assert.deepEqual(dropped, [{ field: "gone", reason: "unknown_field" }]);
    assert.deepEqual(refused, []);
  });
});
