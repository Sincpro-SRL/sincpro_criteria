/**
 * One reading that says everything at once.
 *
 * Every part of a criteria is proven alone in its own file. What could break here is one part
 * quietly overruling another — the rows' order reaching the groups, the groups' page eating
 * the rows' page, a filter surviving into a bucket it should not — so this asks for all ten
 * things in one object and checks each one held.
 *
 * It is written the way a caller writes it, and then read back the way a server would.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Criteria } from "@sincpro/criteria";
import {
  conditionsOf,
  criteria,
  describeRows,
  explain,
  fromRows,
  measure,
  pack,
  readCriteria,
  resource,
  unpack,
  where,
} from "@sincpro/criteria";
import { answer, answerGroups } from "@sincpro/criteria/engine";

interface Invoice {
  invoice_id: string;
  journal: string;
  partner: string | null;
  state: string;
  debit: number;
  tags: string[];
  posted_at: string;
}

const rows: Invoice[] = [
  {
    invoice_id: "f1",
    journal: "SAL",
    partner: "p1",
    state: "posted",
    debit: 12000,
    tags: ["urgent"],
    posted_at: "2026-01-10T00:00:00.000Z",
  },
  {
    invoice_id: "f2",
    journal: "SAL",
    partner: "p2",
    state: "posted",
    debit: 8000,
    tags: [],
    posted_at: "2026-01-22T00:00:00.000Z",
  },
  {
    invoice_id: "f3",
    journal: "PUR",
    partner: "p1",
    state: "paid",
    debit: 30000,
    tags: ["urgent"],
    posted_at: "2026-02-04T00:00:00.000Z",
  },
  {
    invoice_id: "f4",
    journal: "PUR",
    partner: null,
    state: "posted",
    debit: 500,
    tags: [],
    posted_at: "2026-02-09T00:00:00.000Z",
  },
  {
    invoice_id: "f5",
    journal: "SAL",
    partner: "p3",
    state: "posted",
    debit: 45000,
    tags: ["urgent"],
    posted_at: "2026-01-28T00:00:00.000Z",
  },
  {
    invoice_id: "f6",
    journal: "BNK",
    partner: "p2",
    state: "draft",
    debit: 60,
    tags: [],
    posted_at: "2026-03-02T00:00:00.000Z",
  },
  {
    invoice_id: "f7",
    journal: "SAL",
    partner: "p1",
    state: "paid",
    debit: 21000,
    tags: ["urgent"],
    posted_at: "2026-02-18T00:00:00.000Z",
  },
];

const meta = describeRows(rows, { identity: "invoice_id" });

/** Everything a criteria can say, in one object. */
const reading = criteria<Invoice>()
  .where(
    ["state", "in", ["posted", "paid"]],
    ["debit", "between", [100, 50000]],
    where.any(["journal", "=", "SAL"], ["tags", "contains", "urgent"]),
    where.negate(["partner", "is null", true]),
  )
  .order("-posted_at", "invoice_id")
  .limit(2)
  .groupBy("journal", ["posted_at", "month"])
  .measures({
    total: measure.sum("debit"),
    biggest: measure.max("debit"),
    average: measure.avg("debit"),
    named: measure.count("partner"),
  })
  .whereMeasures(["total", ">", 10000], ["count", ">=", 1])
  .orderGroups("-total")
  .limitGroups(5)
  .counting("exact")
  .meta(true);

describe("one reading that says everything at once", () => {
  it("filters the rows with AND, OR and NOT over four fields", () => {
    const page = answer<Invoice>(
      rows,
      { ...reading.value, grouping: {}, pagination: {} },
      meta,
    );

    assert.deepEqual(
      page.rows.map((one) => one.invoice_id),
      ["f7", "f3", "f5", "f2", "f1"],
      "f3 is PUR, and the any() keeps it because it is tagged urgent",
    );
    assert.deepEqual(page.dropped, [], "the model answered every condition");
  });

  it("leaves out what each part of the filter rules out", () => {
    const page = answer<Invoice>(
      rows,
      { ...reading.value, grouping: {}, pagination: {} },
      meta,
    );
    const kept = page.rows.map((one) => one.invoice_id);

    assert.ok(!kept.includes("f6"), "state=draft is not in [posted, paid]");
    assert.ok(!kept.includes("f4"), "it has no partner, and the filter negates that");
  });

  it("orders the ROWS by the two keys it was given", () => {
    const page = answer<Invoice>(
      rows,
      { ...reading.value, grouping: {}, pagination: {} },
      meta,
    );
    const dates = page.rows.map((one) => one.posted_at);
    assert.deepEqual([...dates], [...dates].sort().reverse(), "-posted_at");
  });

  it("pages the ROWS, and says how many there are in total", () => {
    const page = answer<Invoice>(rows, { ...reading.value, grouping: {} }, meta);

    assert.equal(page.rows.length, 2, "the page asked for two");
    assert.deepEqual(page.count, { value: 5, exact: true }, "and counts every match");
    assert.ok(page.cursor, "and says where the next one starts");
  });

  it("splits into two levels, the second cutting the date to a month", () => {
    const groups = answerGroups<Invoice>(rows, reading, meta).rows;

    assert.deepEqual(
      groups.map((one) => [one.field, one.value, one.count]),
      [
        ["journal", "SAL", 4],
        ["journal", "PUR", 1],
      ],
    );
    assert.deepEqual(
      groups[0]!.groups?.map((one) => [one.value, one.count]),
      [
        ["2026-01", 3],
        ["2026-02", 1],
      ],
    );
  });

  it("answers the four measures of every group", () => {
    const [sal] = answerGroups<Invoice>(rows, reading, meta).rows;

    assert.equal(sal!.measures?.total, 86000, "12000 + 8000 + 45000 + 21000");
    assert.equal(sal!.measures?.biggest, 45000);
    assert.equal(sal!.measures?.average, 21500);
    assert.equal(sal!.measures?.named, 4, "every one of them has a partner");
  });

  it("filters the GROUPS by what they measured, not by their rows", () => {
    const groups = answerGroups<Invoice>(rows, reading, meta).rows;
    assert.ok(groups.every((one) => Number(one.measures?.total) > 10000));

    // BNK is not here because its only row was filtered out; a group under the threshold
    // would not be here either.
    const under = answerGroups<Invoice>(
      rows,
      reading.whereMeasures(["total", ">", 100000]),
      meta,
    ).rows;
    assert.deepEqual(under, []);
  });

  it("orders the GROUPS by a measure, and pages them", () => {
    const groups = answerGroups<Invoice>(rows, reading, meta).rows;
    const totals = groups.map((one) => Number(one.measures?.total));
    assert.deepEqual(
      totals,
      [...totals].sort((a, b) => b - a),
      "-total",
    );

    const one = answerGroups<Invoice>(rows, reading.limitGroups(1), meta).rows;
    assert.equal(one.length, 1, "the groups' page");
    assert.equal(one[0]!.value, "SAL", "and it is the first of that order");

    const next = answerGroups<Invoice>(
      rows,
      reading.limitGroups(1).offsetGroups(1),
      meta,
    ).rows;
    assert.equal(next[0]!.value, "PUR", "counted, because a group has no row to resume past");
  });

  it("reaches the rows' page inside every group, in the rows' order", () => {
    const groups = answerGroups<Invoice>(rows, reading, meta).rows;
    const [sal] = groups;

    assert.deepEqual(sal!.ids, ["f7", "f5"], "two ids, newest first");
    assert.ok(sal!.cursor, "and where the next page inside the group starts");
  });

  it("gives every group the criteria that opens it, filter included", () => {
    const [sal] = answerGroups<Invoice>(rows, reading, meta).rows;
    const inside = answer<Invoice>(rows, { ...sal!.criteria, pagination: {} }, meta);

    assert.equal(inside.rows.length, sal!.count);
    assert.ok(inside.rows.every((one) => one.journal === "SAL"));
    assert.ok(
      inside.rows.every((one) => one.partner !== null),
      "the outer filter still holds",
    );
  });

  it("opens a grained group on a range, because a label is not a value", () => {
    const [sal] = answerGroups<Invoice>(rows, reading, meta).rows;
    const january = sal!.groups?.[0];

    const inside = answer<Invoice>(rows, { ...january!.criteria, pagination: {} }, meta);
    assert.deepEqual(inside.rows.map((one) => one.invoice_id).sort(), ["f1", "f2", "f5"]);

    const dates = conditionsOf(january!.criteria.where).filter(
      (one) => one.field === "posted_at",
    );
    assert.deepEqual(
      dates.map((one) => one.operator),
      [">=", "<"],
    );
  });
});

describe("the same reading, through a URL and back", () => {
  it("survives packing, unpacking and being answered again", async () => {
    const saved = unpack(pack(reading));
    const books = resource<Invoice>(fromRows(rows, { meta }));

    const groups = await books.groups(saved as Criteria<Invoice>);
    assert.deepEqual(
      groups.rows.map((one) => one.value),
      ["SAL", "PUR"],
    );
  });

  it("is read from the wire with every part in place", () => {
    const written = JSON.parse(JSON.stringify(reading.value));
    const read = readCriteria(written);

    assert.equal(conditionsOf(read.where).length, 5);
    assert.deepEqual(read.order, [
      { field: "posted_at", descending: true },
      { field: "invoice_id" },
    ]);
    assert.deepEqual(read.grouping?.group_by, [
      { field: "journal" },
      { field: "posted_at", grain: "month" },
    ]);
    assert.deepEqual(read.grouping?.measures?.total, { function: "sum", field: "debit" });
    assert.equal(conditionsOf(read.grouping?.where_measures).length, 2);
    assert.deepEqual(read.grouping?.order, [{ field: "total", descending: true }]);
    assert.deepEqual(read.grouping?.pagination, { limit: 5 });
    assert.equal(read.count, "exact");
  });

  it("says what it is, in one line", () => {
    assert.equal(
      explain(criteria<Invoice>().where(["debit", ">", 1000]).groupBy("journal")),
      "where debit > 1000, grouped by journal",
    );
  });
});

describe("the two orders and the two pages do not overrule each other", () => {
  it("keeps the rows' page inside the groups' page", () => {
    const q = criteria<Invoice>()
      .order("debit", "invoice_id")
      .limit(2)
      .groupBy("journal")
      .measures({ total: measure.sum("debit") })
      .orderGroups("-total")
      .limitGroups(1);

    const groups = answerGroups<Invoice>(rows, q, meta).rows;

    assert.equal(groups.length, 1, "the groups' page: one group");
    assert.equal(groups[0]!.ids?.length, 2, "the rows' page: two ids inside it");
    assert.deepEqual(
      groups[0]!.ids,
      ["f2", "f1"],
      "and in the rows' order, ascending by debit",
    );
  });
});
