/**
 * What is worked out from what came back.
 *
 * Every number here is checked against one computed by hand in the assertion, because the
 * whole point of this module is that a screen does not have to write that arithmetic — and
 * arithmetic nobody checks is arithmetic nobody trusts.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { criteria, describeRows, measure } from "@sincpro/criteria";
import {
  asSeries,
  asStackedSeries,
  asTable,
  changeFromPrevious,
  cumulative,
  derive,
  fillGaps,
  numberOf,
  percentOfTotal,
  rank,
} from "@sincpro/criteria/analysis";
import { answerGroups, pivotOf } from "@sincpro/criteria/engine";

interface Sale {
  sale_id: string;
  region: string;
  rep: string;
  amount: number;
  at: string;
}

const rows: Sale[] = [
  { sale_id: "s1", region: "north", rep: "ana", amount: 100, at: "2026-01-05T00:00:00.000Z" },
  {
    sale_id: "s2",
    region: "north",
    rep: "beto",
    amount: 300,
    at: "2026-01-20T00:00:00.000Z",
  },
  { sale_id: "s3", region: "south", rep: "ana", amount: 200, at: "2026-03-02T00:00:00.000Z" },
  { sale_id: "s4", region: "south", rep: "cyn", amount: 400, at: "2026-03-18T00:00:00.000Z" },
  { sale_id: "s5", region: "east", rep: "ana", amount: 500, at: "2026-04-07T00:00:00.000Z" },
];

const meta = describeRows(rows, { identity: "sale_id" });

const byRegion = answerGroups<Sale>(
  rows,
  criteria<Sale>()
    .groupBy("region")
    .measures({ total: measure.sum("amount"), reps: measure.countDistinct("rep") })
    .orderGroups("-total"),
  meta,
).rows;

const byMonth = answerGroups<Sale>(
  rows,
  criteria<Sale>()
    .groupBy(["at", "month"])
    .measures({ total: measure.sum("amount") }),
  meta,
).rows;

describe("the two measures a plain function does not answer", () => {
  it("counts the different values, not the rows", () => {
    const north = byRegion.find((one) => one.value === "north")!;
    assert.equal(north.count, 2, "two sales");
    assert.equal(north.measures?.reps, 2, "two reps");

    const south = byRegion.find((one) => one.value === "south")!;
    assert.equal(south.measures?.reps, 2, "ana and cyn");
  });

  it("cuts a percentile where a database would, interpolating", () => {
    const answered = answerGroups<Sale>(
      rows,
      criteria<Sale>()
        .groupBy("rep")
        .measures({
          middle: measure.median("amount"),
          p90: measure.percentile("amount", 0.9),
        }),
      meta,
    ).rows;

    const ana = answered.find((one) => one.value === "ana")!;
    assert.equal(ana.measures?.middle, 200, "the median of 100, 200, 500");
    assert.equal(ana.measures?.p90, 440, "between 200 and 500, nine tenths along");
  });

  it("refuses a percentile with no fraction, and an argument where none belongs", () => {
    assert.throws(
      () => criteria<Sale>().measures({ x: { function: "percentile", field: "amount" } }),
      /between 0 and 1/,
    );
    assert.throws(
      () =>
        criteria<Sale>().measures({ x: { function: "sum", field: "amount", argument: 0.5 } }),
      /takes no argument/,
    );
  });
});

describe("numbers worked out from the ones that came back", () => {
  it("shares the level out, and the shares add up to one", () => {
    const shown = derive(byRegion, { share: percentOfTotal("total") });

    const shares = shown.map((one) => Number(one.measures?.share));
    assert.equal(shares.reduce((total, one) => total + one, 0).toFixed(6), "1.000000");
    assert.equal(Number(shown[0]!.measures?.share).toFixed(4), (600 / 1500).toFixed(4));
  });

  it("adds up as it goes, in the order the groups came back", () => {
    const shown = derive(byMonth, { running: cumulative("total") });

    assert.deepEqual(
      shown.map((one) => [one.value, one.measures?.running]),
      [
        ["2026-01", 400],
        ["2026-03", 1000],
        ["2026-04", 1500],
      ],
    );
  });

  it("says how each period compares with the one before it", () => {
    const shown = derive(byMonth, { change: changeFromPrevious("total") });

    assert.equal(
      shown[0]!.measures?.change,
      null,
      "the first one has nothing to compare with",
    );
    assert.equal(shown[1]!.measures?.change, 0.5, "600 after 400");
  });

  it("ranks them, and takes a formula of its own", () => {
    const shown = derive(byRegion, {
      place: rank(),
      perSale: (bucket) => numberOf(bucket, "total") / bucket.count,
    });

    assert.deepEqual(
      shown.map((one) => one.measures?.place),
      [1, 2, 3],
    );
    assert.equal(shown[0]!.measures?.perSale, 300, "600 over two sales");
  });

  it("leaves the groups it was given untouched", () => {
    derive(byRegion, { share: percentOfTotal("total") });
    assert.equal(byRegion[0]!.measures?.share, undefined);
  });

  it("derives the levels below the same way", () => {
    const nested = answerGroups<Sale>(
      rows,
      criteria<Sale>()
        .groupBy("region", "rep")
        .measures({ total: measure.sum("amount") }),
      meta,
    ).rows;

    const shown = derive(nested, { share: percentOfTotal("total") });
    const inner = shown.find((one) => one.value === "south")!.groups!;
    assert.deepEqual(
      inner.map((one) => Number(one.measures?.share).toFixed(4)),
      [(200 / 600).toFixed(4), (400 / 600).toFixed(4)],
    );
  });
});

describe("groups as the shape a chart takes", () => {
  it("is categories and one series per measure", () => {
    assert.deepEqual(asSeries(byRegion, { measures: ["total"] }), {
      categories: ["south", "east", "north"],
      series: [{ name: "total", values: [600, 500, 400] }],
    });
  });

  it("takes every measure when it is not told which", () => {
    const series = asSeries(byRegion);
    assert.deepEqual(
      series.series.map((one) => one.name),
      ["total", "reps"],
    );
  });

  it("is one series per inner group when there is a level below", () => {
    const nested = answerGroups<Sale>(
      rows,
      criteria<Sale>()
        .groupBy("region", "rep")
        .measures({ total: measure.sum("amount") }),
      meta,
    ).rows;

    const stacked = asStackedSeries(nested, { measure: "total" });

    assert.deepEqual(stacked.categories, ["east", "north", "south"]);
    const ana = stacked.series.find((one) => one.name === "ana")!;
    assert.deepEqual(
      ana.values,
      [500, 100, 200],
      "zero where a rep sold nothing in a region",
    );
    const beto = stacked.series.find((one) => one.name === "beto")!;
    assert.deepEqual(beto.values, [0, 300, 0]);
  });

  it("puts back the months that answered nothing", () => {
    const filled = fillGaps(byMonth, {
      grain: "month",
      from: "2026-01-01T00:00:00.000Z",
      to: "2026-05-01T00:00:00.000Z",
    });

    assert.deepEqual(
      filled.map((one) => [one.value, one.count, one.measures?.total]),
      [
        ["2026-01", 2, 400],
        ["2026-02", 0, 0],
        ["2026-03", 2, 600],
        ["2026-04", 1, 500],
        ["2026-05", 0, 0],
      ],
      "February answered nothing, and a chart that skips it lies",
    );
  });

  it("fills the gaps of a chart that then adds up correctly", () => {
    const filled = fillGaps(byMonth, {
      grain: "month",
      from: "2026-01-01T00:00:00.000Z",
      to: "2026-04-01T00:00:00.000Z",
    });
    const shown = derive(filled, { running: cumulative("total") });

    assert.deepEqual(
      shown.map((one) => one.measures?.running),
      [400, 400, 1000, 1500],
      "an empty month holds the line rather than breaking it",
    );
  });
});

describe("a pivot as a grid", () => {
  const pivot = pivotOf<Sale>(rows, {
    rows: ["region"],
    columns: [["at", "month"]],
    measures: { total: measure.sum("amount") },
  });

  it("has no holes: every crossing is a cell", () => {
    const grid = asTable(pivot);

    assert.equal(grid.rows.length, 3);
    for (const row of grid.rows) {
      assert.equal(row.cells.length, grid.columns.length);
    }

    const north = grid.rows.find((one) => one.label === "north")!;
    const march = grid.columns.findIndex((one) => one.label === "2026-03");
    assert.equal(north.cells[march]!.count, 0, "north sold nothing in March");
  });

  it("carries the margins the engine folded, and the grand total", () => {
    const grid = asTable(pivot);

    const north = grid.rows.find((one) => one.label === "north")!;
    assert.equal(north.margin?.count, 2);
    assert.equal(north.margin?.measures?.total, 400);

    assert.equal(grid.total?.count, 5);
    assert.equal(
      grid.total?.measures?.total,
      1500,
      "folded over the rows, not added up here",
    );
  });
});
