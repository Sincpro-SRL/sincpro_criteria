/**
 * The type-level contract. `@ts-expect-error` fails the build when the error it names stops
 * happening, so these are checked by `make typecheck` rather than at runtime.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { criteria, dynamic, measure, merge, readFilter, where } from "@sincpro/criteria";

import type { Dataset } from "./fixtures";

describe("typing is opt-in", () => {
  it("asks nothing of a caller that has no type yet", () => {
    const q = criteria().where(["whatever", "=", 1], ["anything_else", ">", 2]);
    assert.ok(q.value.where);
  });

  it("checks the field names when there is a record to check them against", () => {
    const q = criteria<Dataset>().where(["encoding", "=", "utf-8"], ["row_count", ">", 1000]);
    assert.ok(q.value.where);
  });

  it("refuses a field the record does not have", () => {
    const q = criteria<Dataset>().where(
      // @ts-expect-error 'encodig' is not a field of Dataset
      ["encodig", "=", "utf-8"],
    );
    assert.ok(q.value.where);
  });

  it("refuses an ordering, a level and a mask over fields the record does not have", () => {
    // @ts-expect-error 'gone' is not a field of Dataset
    criteria<Dataset>().groupBy("gone");
    // @ts-expect-error 'gone' is not a field of Dataset
    criteria<Dataset>().specification({ gone: {} });
    // @ts-expect-error 'gone' is not a field of Dataset
    criteria<Dataset>().measures({ rows: measure.sum("gone") });
    assert.ok(true);
  });

  it("keeps one filter readable when its conditions name different fields", () => {
    // The trap this guards: inferring the record from the first field name and rejecting
    // every other one against it.
    const filter = where.all(["a", "=", 1], ["b", "like", "x"], ["c", ">", 2]);
    assert.ok(filter);
  });

  it("merges two plain criteria that name different fields", () => {
    const merged = merge(
      { where: readFilter(["a", "=", 1]) },
      { where: readFilter(["b", ">", 2]) },
    );
    assert.ok(merged.where);
  });

  it("refuses an ordering by a field the record does not have", () => {
    // @ts-expect-error 'gone' is not a field of Dataset
    criteria<Dataset>().order("gone");
    // @ts-expect-error a descending ordering names a field too
    criteria<Dataset>().order("-gone");
    assert.ok(true);
  });

  it("refuses a having over a number this grouping does not fold", () => {
    criteria<Dataset>()
      .groupBy("encoding")
      .measures({ rows: measure.sum("row_count") })
      // @ts-expect-error 'pages' is not one of this grouping's measures
      .whereMeasures(["pages", ">", 10]);
    assert.ok(true);
  });

  it("offers the measures it declared, and count", () => {
    const q = criteria<Dataset>()
      .groupBy("encoding")
      .measures({ rows: measure.sum("row_count") })
      .whereMeasures(["rows", ">", 1000], ["count", ">", 10])
      .orderGroups("-rows");
    assert.ok(q.value.grouping?.where_measures);
  });

  it("keeps the record's type through a merge done on the builder", () => {
    const merged = criteria<Dataset>()
      .where(["encoding", "=", "utf-8"])
      .merge(criteria<Dataset>().limit(10));
    const back: typeof merged.value.order = merged.value.order;
    assert.equal(back, undefined);
  });
});

describe("a value that is read when the filter runs is typed too", () => {
  it("accepts the names the engine declares", () => {
    const q = criteria<Dataset>().where(
      ["registered_at", "<", dynamic.today()],
      ["registered_at", ">=", dynamic.today({ minus: { days: 30 }, startOf: "month" })],
      ["registered_at", "between", dynamic.period("this_month")],
      [
        "registered_at",
        "between",
        dynamic.period({ unit: "week", last: 2, includeCurrent: true }),
      ],
    );
    assert.ok(q.value.where);
  });

  it("refuses a period that is not one the engine has", () => {
    assert.throws(() => {
      // @ts-expect-error 'this_mont' is not a PeriodName
      dynamic.period("this_mont");
    }, "and at run time it is refused as well");
  });

  it("refuses a unit that is not one a span counts in", () => {
    // @ts-expect-error 'day' is not a Unit: a span counts in days
    dynamic.today({ minus: { day: 3 } });
    assert.ok(true);
  });

  it("refuses a snap to a unit that is not a granularity", () => {
    // @ts-expect-error 'fortnight' is not a Grain
    dynamic.today({ startOf: "fortnight" });
    assert.ok(true);
  });

  it("refuses a window with both a last and a next", () => {
    // @ts-expect-error a window counts back or forward, not both
    dynamic.period({ unit: "day", last: 3, next: 3 });
    assert.ok(true);
  });

  it("checks the field a column is compared with, when there is a record to check it against", () => {
    dynamic.field<Dataset>("row_count");
    // @ts-expect-error 'gone' is not a field of Dataset
    dynamic.field<Dataset>("gone");
    assert.ok(true);
  });
});
