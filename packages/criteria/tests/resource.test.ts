import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Criteria, Source } from "@sincpro/criteria";
import {
  criteria,
  describeRows,
  fieldsThatSort,
  fromRows,
  measure,
  resource,
  validate,
} from "@sincpro/criteria";
import { cellOf } from "@sincpro/criteria/engine";

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

describe("a source is one function", () => {
  it("is enough to get a page, a reading and everything else", async () => {
    const inner = fromRows<Dataset>(rows, { meta: datasetMeta });
    const mine = resource<Dataset>({ read: (written) => inner.read(written) });

    const page = await mine.page(criteria<Dataset>().order("dataset_id").limit(2));
    assert.deepEqual(
      page.rows.map((one) => one.dataset_id),
      ["d1", "d2"],
    );
  });

  it("says so, instead of quietly reading a table, when it cannot group", async () => {
    const inner = fromRows<Dataset>(rows, { meta: datasetMeta });
    const mine = resource<Dataset>({ read: (written) => inner.read(written) });

    await assert.rejects(
      () => mine.groups(criteria<Dataset>().groupBy("encoding")),
      /does not group/,
    );
  });

  it("groups in memory when it is told to, and only then", async () => {
    const inner = fromRows<Dataset>(rows, { meta: datasetMeta });
    const mine = resource<Dataset>(
      { read: (written) => inner.read(written) },
      { groupLocally: true, localPageSize: 2 },
    );

    const page = await mine.groups(criteria<Dataset>().groupBy("encoding"));
    assert.deepEqual(
      page.rows.map((one) => [one.value, one.count]),
      [
        ["latin-1", 2],
        ["utf-8", 3],
      ],
    );
  });

  it("refuses to gather more rows than it was allowed to", async () => {
    const inner = fromRows<Dataset>(rows, { meta: datasetMeta });
    const mine = resource<Dataset>(
      { read: (written) => inner.read(written) },
      { groupLocally: true, localPageSize: 2, localCeiling: 3 },
    );

    await assert.rejects(
      () => mine.groups(criteria<Dataset>().groupBy("encoding")),
      /localCeiling/,
    );
  });
});

describe("walking every row", () => {
  it("hands them over one at a time, and holds the cursor itself", async () => {
    const walked: string[] = [];
    for await (const dataset of datasets().all(criteria<Dataset>().order("dataset_id"))) {
      walked.push(dataset.dataset_id);
    }
    assert.deepEqual(walked, ["d1", "d2", "d3", "d4", "d5"]);
  });

  it("walks in pages, and stops asking for the definition after the first", async () => {
    const asked: Criteria<Dataset>[] = [];
    const inner = fromRows<Dataset>(rows, { meta: datasetMeta });
    const mine = resource<Dataset>({
      read: (written) => {
        asked.push(written);
        return inner.read(written);
      },
    });

    const walked: string[] = [];
    for await (const dataset of mine.all(criteria<Dataset>().order("dataset_id").limit(2))) {
      walked.push(dataset.dataset_id);
    }

    assert.equal(walked.length, 5);
    assert.equal(asked.length, 3, "two full pages and the one that ends the walk");
    assert.equal(asked[1]?.meta, false);
  });
});

describe("a level of buckets", () => {
  it("loads the level, opens a bucket and drills into it", async () => {
    const tree = datasets().group(criteria<Dataset>().groupBy("encoding"));
    await tree.load();

    assert.deepEqual(
      tree.buckets.map((one) => one.value),
      ["latin-1", "utf-8"],
    );

    // Opening a bucket is a reading over the criteria the bucket carries.
    const inside = tree.open(tree.buckets[1]!);
    await inside.load();
    assert.deepEqual(inside.rows.map((one) => one.dataset_id).sort(), ["d1", "d2", "d4"]);

    const months = tree.drill(tree.buckets[1]!, ["registered_at", "month"]);
    await months.load();
    assert.deepEqual(
      months.buckets.map((one) => [one.value, one.count]),
      [
        ["2026-01", 2],
        ["2026-02", 1],
      ],
    );
  });

  it("filters the groups by what they folded", async () => {
    const tree = datasets().group(
      criteria<Dataset>()
        .groupBy("encoding")
        .measures({ total: measure.sum("row_count") })
        .whereMeasures(["total", ">", 1000]),
    );
    await tree.load();
    assert.deepEqual(
      tree.buckets.map((one) => one.value),
      ["utf-8"],
    );
  });

  it("says what it cannot do instead of failing silently", async () => {
    const inner = fromRows<Dataset>(rows, { meta: datasetMeta });
    const tree = resource<Dataset>({ read: (written) => inner.read(written) }).group(
      criteria<Dataset>().groupBy("encoding"),
    );
    await tree.load();
    assert.equal(tree.status, "failed");
    assert.match(String((tree.error as Error).message), /does not group/);
  });
});

describe("rows with nothing said about them", () => {
  it("still filter, sort and page, on a definition read off the rows", async () => {
    const plain = [
      { id: 3, name: "c", at: "2026-03-01T00:00:00.000Z" },
      { id: 1, name: "a", at: "2026-01-01T00:00:00.000Z" },
      { id: 2, name: "b", at: "2026-02-01T00:00:00.000Z" },
    ];
    const mine = resource(fromRows(plain));

    const page = await mine.page(criteria().order("id").limit(2));
    assert.deepEqual(
      page.rows.map((one) => one.id),
      [1, 2],
    );

    const filtered = await mine.page(criteria().where(["name", "=", "b"]));
    assert.deepEqual(
      filtered.rows.map((one) => one.id),
      [2],
    );
  });

  it("reads the types it can see, and refuses to sort by a column that is sometimes empty", () => {
    const meta = describeRows([
      { id: 1, size: 2, label: "a", at: "2026-01-01T00:00:00.000Z", tags: ["x"] },
      { id: 2, size: 2.5, label: null, at: "2026-02-01T00:00:00.000Z", tags: [] },
    ]);

    assert.equal(meta.identity, "id");
    assert.equal(
      meta.fields.size?.type,
      "number",
      "a column of whole numbers that holds a decimal",
    );
    assert.equal(meta.fields.at?.type, "datetime");
    assert.equal(meta.fields.tags?.type, "text[]");
    assert.equal(meta.fields.label?.nullable, true);
    assert.ok(!fieldsThatSort(meta).includes("label"));
  });

  it("does not take a text column for a date, whatever Date.parse thinks of it", () => {
    const meta = describeRows([{ id: 1, encoding: "utf-8" }]);
    assert.equal(meta.fields.encoding?.type, "text");
  });
});

describe("a pivot through a resource", () => {
  it("crosses the axes over the rows the criteria matched", async () => {
    const pivot = await datasets().pivot(criteria<Dataset>().where(["row_count", ">", 100]), {
      rows: ["encoding"],
      columns: [["registered_at", "month"]],
      measures: { total: measure.sum("row_count") },
    });

    assert.equal(cellOf(pivot, ["utf-8"], ["2026-01"])?.count, 2);
    assert.equal(cellOf(pivot, ["latin-1"], ["2026-02"]), undefined, "d3 was filtered out");
    assert.equal(pivot.total?.count, 4);
  });
});

describe("the source a caller writes", () => {
  it("is five lines over whatever it already had", async () => {
    // What a REST adapter is, with the fetch left out: whatever it got, handed over as a page.
    const wire: Source<Dataset> = {
      read: (written) => {
        const asked = JSON.parse(JSON.stringify(written)) as Criteria<Dataset>;
        return fromRows<Dataset>(rows, { meta: datasetMeta }).read(asked);
      },
    };

    const reading = resource<Dataset>(wire).read(
      criteria<Dataset>().order("dataset_id").limit(2),
    );
    await reading.load();
    await reading.more();
    assert.equal(reading.rows.length, 4);
  });
});

describe("a definition read off the rows", () => {
  it("offers `is null` on a column some row leaves empty", () => {
    const meta = describeRows([
      { id: "a", producer: "p1" },
      { id: "b", producer: null },
    ]);

    assert.ok(meta.fields.producer?.ops.includes("is null"));

    // Without it, asking "which ones have no producer" is dropped as an unsupported
    // operator and the reading silently widens to everything.
    const { dropped } = validate(criteria().where(["producer", "is null", true]), meta);
    assert.deepEqual(dropped, []);
  });
});
