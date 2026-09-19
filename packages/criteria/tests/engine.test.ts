import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { criteria, InvalidCriteria, measure } from "@sincpro/criteria";
import {
  answer,
  answerGroups,
  cellOf,
  cutTo,
  mintCursor,
  orderingFor,
  pivotOf,
  readCursor,
  sortRows,
} from "@sincpro/criteria/engine";

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
    tags: ["raw", "clean"],
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

const ids = (page: { rows: Dataset[] }) => page.rows.map((one) => one.dataset_id);

describe("ordering", () => {
  it("appends the identity as a tiebreaker, or a keyset page repeats or skips rows", () => {
    assert.deepEqual(orderingFor(criteria<Dataset>().order("encoding").value, datasetMeta), [
      { field: "encoding" },
      { field: "dataset_id", descending: undefined },
    ]);
  });

  it("does not append it twice", () => {
    assert.deepEqual(
      orderingFor(criteria<Dataset>().order("-dataset_id").value, datasetMeta),
      [{ field: "dataset_id", descending: true }],
    );
  });

  it("falls back to the model's default order", () => {
    assert.deepEqual(orderingFor({}, datasetMeta), [
      { field: "dataset_id", descending: true },
    ]);
  });

  it("sorts by an earlier key first, and keeps the order of equals", () => {
    const sorted = sortRows(rows, [
      { field: "encoding" },
      { field: "row_count", descending: true },
    ]);
    assert.deepEqual(
      sorted.map((one) => one.dataset_id),
      ["d5", "d3", "d4", "d2", "d1"],
    );
  });
});

describe("a page out of rows in hand", () => {
  it("filters, sorts, pages and counts", () => {
    const page = answer(
      rows,
      criteria<Dataset>().where(["encoding", "=", "utf-8"]).order("row_count").limit(2),
      datasetMeta,
    );
    assert.deepEqual(ids(page), ["d1", "d2"]);
    assert.deepEqual(page.count, { value: 3, exact: true });
    assert.ok(page.cursor);
  });

  it("resumes exactly where the previous page ended", () => {
    const first = criteria<Dataset>().order("row_count").limit(2);
    const one = answer(rows, first, datasetMeta);
    const two = answer(rows, first.cursor(one.cursor), datasetMeta);
    const three = answer(rows, first.cursor(two.cursor), datasetMeta);
    assert.deepEqual(ids(one), ["d3", "d1"]);
    assert.deepEqual(ids(two), ["d5", "d2"]);
    assert.deepEqual(ids(three), ["d4"]);
    assert.equal(three.cursor, null, "the last page names no next one");
  });

  it("walks every row exactly once, however the page falls", () => {
    for (const limit of [1, 2, 3, 5, 9]) {
      const base = criteria<Dataset>().order("-registered_at").limit(limit);
      const walked: string[] = [];
      let cursor: string | null = null;
      for (let guard = 0; guard < 20; guard += 1) {
        const page: ReturnType<typeof answer<Dataset>> = answer(
          rows,
          cursor === null ? base : base.cursor(cursor),
          datasetMeta,
        );
        walked.push(...ids(page));
        cursor = page.cursor;
        if (cursor === null) break;
      }
      assert.deepEqual(walked.sort(), ["d1", "d2", "d3", "d4", "d5"], `limit ${limit}`);
    }
  });

  it("counts rows instead, when a grid jumps to a page", () => {
    const page = answer(
      rows,
      criteria<Dataset>().order("dataset_id").limit(2).offset(2),
      datasetMeta,
    );
    assert.deepEqual(ids(page), ["d3", "d4"]);
    assert.equal(
      page.cursor,
      null,
      "counting rows needs no token: the caller knows its count",
    );
  });

  it("says nothing about the count when nobody asked for one", () => {
    assert.equal(answer(rows, criteria<Dataset>().counting("none"), datasetMeta).count, null);
  });

  it("carries the definition unless it was turned off", () => {
    assert.equal(answer(rows, criteria<Dataset>(), datasetMeta).meta, datasetMeta);
    assert.equal(answer(rows, criteria<Dataset>().meta(false), datasetMeta).meta, null);
  });

  it("drops what the model cannot answer and still runs", () => {
    const page = answer(
      rows,
      criteria<Dataset>().where(["gone" as never, "=", 1]),
      datasetMeta,
    );
    assert.deepEqual(page.dropped, [{ field: "gone", reason: "unknown_field" }]);
    assert.equal(page.rows.length, 5);
  });

  it("refuses a page ordered by a column it would lose rows on", () => {
    assert.throws(
      () => answer(rows, criteria<Dataset>().order("producer_id"), datasetMeta),
      InvalidCriteria,
    );
  });
});

describe("the cursor", () => {
  it("is refused under an ordering it was not minted for", () => {
    const token = mintCursor(rows[0]!, [{ field: "row_count" }]);
    assert.deepEqual(readCursor(token, "row_count").keys, [300]);
    assert.throws(() => readCursor(token, "-row_count"), InvalidCriteria);
  });

  it("brings a date back as a date, not as text that compares as text", () => {
    const at = new Date("2026-03-14T15:09:26.000Z");
    const token = mintCursor({ made_at: at }, [{ field: "made_at" }]);
    const [key] = readCursor(token, "made_at").keys;
    assert.ok(key instanceof Date);
    assert.equal((key as Date).toISOString(), at.toISOString());
  });

  it("is refused when it is not a token at all", () => {
    assert.throws(() => readCursor("not-a-token", "id"), InvalidCriteria);
  });
});

describe("grouping", () => {
  it("counts and folds every bucket, and carries the criteria that opens it", () => {
    const page = answerGroups(
      rows,
      criteria<Dataset>()
        .groupBy("encoding")
        .measures({ total: measure.sum("row_count") }),
      datasetMeta,
    );
    assert.deepEqual(
      page.rows.map((one) => [one.value, one.count, one.measures?.total]),
      [
        ["latin-1", 2, 750],
        ["utf-8", 3, 10500],
      ],
    );

    // Opening a bucket is a plain read with the criteria it came with.
    const opened = answer(rows, page.rows[0]!.criteria, datasetMeta);
    assert.deepEqual(ids(opened), ["d5", "d3"]);
  });

  it("splits a date by the grain, and opens the bucket with a range", () => {
    const page = answerGroups(
      rows,
      criteria<Dataset>().groupBy(["registered_at", "month"]),
      datasetMeta,
    );
    assert.deepEqual(
      page.rows.map((one) => [one.value, one.count]),
      [
        ["2026-01", 2],
        ["2026-02", 2],
        ["2026-03", 1],
      ],
    );

    // A label is not a value: `registered_at = "2026-01"` would match nothing.
    const opened = answer(rows, page.rows[0]!.criteria, datasetMeta);
    assert.deepEqual(ids(opened).sort(), ["d1", "d2"]);
  });

  it("answers the level below only for the rows of its bucket", () => {
    const page = answerGroups(
      rows,
      criteria<Dataset>()
        .groupBy("encoding")
        .groupBy("producer_id" as never),
      datasetMeta,
    );
    const utf8 = page.rows.find((one) => one.value === "utf-8")!;
    assert.deepEqual(
      utf8.groups?.map((one) => [one.value, one.count]),
      [
        ["p1", 1],
        ["p2", 1],
        [null, 1],
      ],
      "the empty ones come last",
    );
  });

  it("filters the groups the rows made, not the rows that made them", () => {
    const page = answerGroups(
      rows,
      criteria<Dataset>()
        .groupBy("encoding")
        .measures({ total: measure.sum("row_count") })
        .whereMeasures(["total", ">", 1000]),
      datasetMeta,
    );
    assert.deepEqual(
      page.rows.map((one) => one.value),
      ["utf-8"],
    );
  });

  it("orders the buckets by a fold, and pages them", () => {
    const page = answerGroups(
      rows,
      criteria<Dataset>()
        .groupBy("encoding")
        .measures({ total: measure.sum("row_count") })
        .orderGroups("-total")
        .limitGroups(1),
      datasetMeta,
    );
    assert.deepEqual(
      page.rows.map((one) => one.value),
      ["utf-8"],
    );
  });

  it("answers a page of ids per bucket when the criteria asked for a page", () => {
    const page = answerGroups(
      rows,
      criteria<Dataset>().groupBy("encoding").order("row_count").limit(1),
      datasetMeta,
    );
    const utf8 = page.rows.find((one) => one.value === "utf-8")!;
    assert.deepEqual(utf8.ids, ["d1"]);
    assert.ok(utf8.cursor, "and where the next page inside the bucket starts");
  });

  it("answers no ids when no page was asked for", () => {
    const page = answerGroups(rows, criteria<Dataset>().groupBy("encoding"), datasetMeta);
    assert.deepEqual(page.rows[0]!.ids, []);
    assert.equal(page.rows[0]!.cursor, null);
  });
});

describe("the grain", () => {
  it("cuts a date down to the label the engine writes", () => {
    const at = "2026-03-14T15:09:26.000Z";
    assert.equal(cutTo(at, "year"), "2026");
    assert.equal(cutTo(at, "month"), "2026-03");
    assert.equal(cutTo(at, "day"), "2026-03-14");
    assert.equal(cutTo(at, "week"), "2026-W11");
  });

  it("leaves alone what is not a date", () => {
    assert.equal(cutTo("utf-8", "month"), "utf-8");
    assert.equal(cutTo(null, "month"), null);
  });
});

describe("a pivot", () => {
  it("crosses two axes and folds the cells", () => {
    const pivot = pivotOf(rows, {
      rows: ["encoding"],
      columns: [["registered_at", "month"]],
      measures: { total: measure.sum("row_count") },
    });

    assert.deepEqual(pivot.rows, [["utf-8"], ["latin-1"]]);
    assert.deepEqual(pivot.columns, [["2026-01"], ["2026-02"], ["2026-03"]]);
    assert.equal(cellOf(pivot, ["utf-8"], ["2026-01"])?.count, 2);
    assert.equal(cellOf(pivot, ["utf-8"], ["2026-01"])?.measures?.total, 1500);
    assert.equal(
      cellOf(pivot, ["latin-1"], ["2026-01"]),
      undefined,
      "a pivot is mostly holes",
    );
  });

  it("folds its margins from the rows, never from the cells", () => {
    const pivot = pivotOf(rows, {
      rows: ["encoding"],
      columns: [],
      measures: { average: measure.avg("row_count") },
    });
    assert.equal(pivot.total?.count, 5);
    assert.equal(
      pivot.total?.measures?.average,
      2250,
      "an average of averages is not an average",
    );
  });
});
