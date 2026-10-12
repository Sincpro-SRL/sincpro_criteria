/**
 * The analysis the engine lends to rows in hand: the part of a date, the groups with no rows and
 * the folds a closed list adds. The Python suite holds the same cases over a memory store and SQL
 * (`tests/data_layer/orm/test_model_driven_analytics.py`); these are the same rows through this
 * engine, so the three answer one number.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Level, Meta } from "@sincpro/criteria";
import {
  criteria,
  InvalidCriteria,
  isPart,
  measure,
  pack,
  PARTS,
  readCriteria,
  unpack,
} from "@sincpro/criteria";
import { answerGroups, partOf } from "@sincpro/criteria/engine";

interface Bill {
  id: string;
  owner: string;
  state: string;
  total: number;
  settled: boolean;
  posted_at: string;
}

const bills: Bill[] = [
  ["ana", "open", 100, false, "2026-01-05T09:00:00Z"],
  ["ana", "paid", 50, true, "2026-01-20T09:00:00Z"],
  ["beto", "open", 10, false, "2026-03-14T15:00:00Z"],
  ["beto", "paid", 200, true, "2027-03-02T15:00:00Z"],
  ["caro", "open", 70, false, "2026-08-31T23:00:00Z"],
].map(([owner, state, total, settled, posted_at], index) => ({
  id: `b${index}`,
  owner: owner as string,
  state: state as string,
  total: total as number,
  settled: settled as boolean,
  posted_at: posted_at as string,
}));

const column = (type: string, extra: object = {}) => ({
  type,
  nullable: false,
  sortable: true,
  ops: ["=", "!="],
  kind: "scalar",
  ...extra,
});

const meta = {
  aggregate: "Bill",
  identity: "id",
  default_order: "-id",
  fields: {
    id: column("text"),
    owner: column("text"),
    state: column("text", { choices: ["open", "paid", "overdue"] }),
    total: column("number"),
    settled: column("boolean"),
    posted_at: column("datetime", { ops: ["=", "!=", "<", "<=", ">", ">=", "between"] }),
  },
} as unknown as Meta;

function counts(levels: Level<Bill>[], where?: unknown): Record<string, number> {
  const q = criteria<Bill>();
  const grouped = q.groupBy(...levels);
  const page = answerGroups(
    bills,
    where === undefined ? grouped : { ...grouped.value, where: where as never },
    meta,
  );
  return Object.fromEntries(page.rows.map((one) => [String(one.value), one.count]));
}

describe("the part of a date", () => {
  it("is a number the date holds, in UTC, with Monday as 1", () => {
    const at = "2026-03-14T15:09:26Z";
    assert.deepEqual(
      PARTS.map((part) => partOf(at, part)),
      [2026, 1, 3, 11, 6, 14, 15],
    );
    assert.equal(partOf("not a date", "month"), null);
  });

  it("groups every March together whatever the year", () => {
    assert.deepEqual(counts([{ field: "posted_at", part: "month" }]), {
      "1": 2,
      "3": 2,
      "8": 1,
    });
    assert.deepEqual(counts([{ field: "posted_at", part: "year" }]), {
      "2026": 4,
      "2027": 1,
    });
    assert.deepEqual(counts([{ field: "posted_at", part: "quarter" }]), { "1": 4, "3": 1 });
    assert.deepEqual(counts([{ field: "posted_at", part: "day_of_week" }]), {
      "1": 2,
      "2": 2,
      "6": 1,
    });
  });

  it("orders the numbers as numbers, so 10 follows 9", () => {
    const page = answerGroups(
      bills,
      criteria<Bill>().groupBy({ field: "posted_at", part: "day_of_month" }),
      meta,
    );
    const values = page.rows.map((one) => one.value as number);
    assert.deepEqual(
      values,
      [...values].sort((a, b) => a - b),
    );
  });

  it("cannot be opened, and says so", () => {
    const page = answerGroups(
      bills,
      criteria<Bill>().groupBy({ field: "posted_at", part: "month" }),
      meta,
    );
    assert.ok(page.rows.every((one) => one.openable === false));
    assert.ok(page.rows.every((one) => one.criteria.where === undefined));
  });

  it("is refused with a page of ids per group, because there are no rows to page", () => {
    assert.throws(
      () =>
        answerGroups(
          bills,
          criteria<Bill>().groupBy({ field: "posted_at", part: "month" }).limit(2),
          meta,
        ),
      /has no rows to page/,
    );
  });
});

describe("the groups with no rows", () => {
  it("lists every choice of an enum and both values of a boolean", () => {
    assert.deepEqual(counts([{ field: "state", fill: true }]), {
      open: 3,
      overdue: 0,
      paid: 2,
    });
    assert.deepEqual(
      counts([{ field: "settled", fill: true }], {
        field: "state",
        operator: "=",
        value: "open",
      }),
      { false: 3, true: 0 },
    );
  });

  it("lists every number a part can be", () => {
    const page = answerGroups(
      bills,
      criteria<Bill>().groupBy({ field: "posted_at", part: "month", fill: true }),
      meta,
    );
    assert.deepEqual(
      page.rows.map((one) => one.count),
      [2, 0, 2, 0, 0, 0, 0, 1, 0, 0, 0, 0],
    );
  });

  it("lists the grains between the bounds the filter gives", () => {
    const where = {
      all: [
        { field: "posted_at", operator: ">=", value: "2026-01-01T00:00:00Z" },
        { field: "posted_at", operator: "<", value: "2026-05-01T00:00:00Z" },
      ],
    };

    assert.deepEqual(counts([{ field: "posted_at", grain: "month", fill: true }], where), {
      "2026-01": 2,
      "2026-02": 0,
      "2026-03": 1,
      "2026-04": 0,
    });
  });

  it("folds an empty group to nothing and a count to zero", () => {
    const page = answerGroups(
      bills,
      criteria<Bill>()
        .groupBy({ field: "state", fill: true })
        .measures({ owing: measure.sum("total"), owners: measure.countDistinct("owner") }),
      meta,
    );
    assert.deepEqual(page.rows.find((one) => one.value === "overdue")?.measures, {
      owing: null,
      owners: 0,
    });
  });

  it("refuses what has no values to list, no bounds, and a filter over the groups", () => {
    assert.throws(() => counts([{ field: "owner", fill: true }]), /cannot be filled/);
    assert.throws(
      () => counts([{ field: "posted_at", grain: "month", fill: true }]),
      /needs the filter to bound it at both ends/,
    );
    assert.throws(
      () =>
        answerGroups(
          bills,
          criteria<Bill>()
            .groupBy({ field: "state", fill: true })
            .whereMeasures(["count", ">", 0]),
          meta,
        ),
      /is filled/,
    );
  });
});

describe("the folds a closed list adds", () => {
  it("answers the median, and all or any of a boolean", () => {
    const page = answerGroups(
      bills,
      criteria<Bill>()
        .groupBy("owner")
        .measures({
          mid: measure.median("total"),
          every: measure.boolAnd("settled"),
          some: measure.boolOr("settled"),
        }),
      meta,
    );
    const byOwner = Object.fromEntries(page.rows.map((one) => [one.value, one.measures]));

    assert.deepEqual(byOwner.ana, { mid: 75, every: false, some: true });
    assert.deepEqual(byOwner.caro, { mid: 70, every: false, some: false });
  });

  it("takes no argument for a median", () => {
    assert.throws(
      () =>
        readCriteria({
          grouping: {
            measures: { mid: { function: "median", field: "total", argument: 0.5 } },
          },
        }),
      InvalidCriteria,
    );
  });
});

describe("reading a level that came from outside", () => {
  it("keeps a part and a fill through a URL", () => {
    const q = criteria<Bill>().groupBy({ field: "posted_at", part: "month", fill: true });

    assert.deepEqual(unpack(pack(q)), q.value);
    assert.deepEqual(readCriteria(JSON.parse(JSON.stringify(q.value))), q.value);
  });

  it("refuses a part that does not exist and a grain together with a part", () => {
    assert.equal(isPart("month"), true);
    assert.equal(isPart("fortnight"), false);
    assert.throws(
      () => readCriteria({ grouping: { group_by: [{ field: "a", part: "fortnight" }] } }),
      /is not a part of a date/,
    );
    assert.throws(
      () =>
        readCriteria({
          grouping: { group_by: [{ field: "a", part: "month", grain: "month" }] },
        }),
      /a grain .* or a part/,
    );
  });
});
