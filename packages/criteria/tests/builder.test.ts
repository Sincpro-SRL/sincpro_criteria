import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { criteria, measure, readFilter } from "@sincpro/criteria";

import type { Dataset } from "./fixtures";

describe("the builder", () => {
  it("is the plain object and nothing else", () => {
    const q = criteria<Dataset>().where(["encoding", "=", "utf-8"]).limit(100);
    assert.deepEqual(q.value, {
      where: { field: "encoding", operator: "=", value: "utf-8" },
      pagination: { limit: 100 },
    });
    assert.equal(JSON.stringify(q), JSON.stringify(q.value));
  });

  it("never touches the one it came from", () => {
    const base = criteria<Dataset>().limit(50);
    const refined = base.where(["name", "like", "labs"]);
    assert.equal(base.value.where, undefined);
    assert.deepEqual(refined.value.pagination, { limit: 50 });
  });

  it("accumulates the filter with AND, flat", () => {
    const q = criteria<Dataset>()
      .where(["encoding", "=", "utf-8"])
      .where(["row_count", ">", 1000]);
    assert.deepEqual(q.value.where, {
      all: [readFilter(["encoding", "=", "utf-8"]), readFilter(["row_count", ">", 1000])],
    });
  });

  it("ignores the parts that are not there", () => {
    const q = criteria<Dataset>().where(undefined);
    assert.equal(q.value.where, undefined);
  });
});

describe("the ordering", () => {
  it("takes one name per field, ascending or descending", () => {
    assert.deepEqual(criteria<Dataset>().order("-registered_at", "name").value.order, [
      { field: "registered_at", descending: true },
      { field: "name" },
    ]);
  });

  it("replaces, because two orderings have no combination", () => {
    const q = criteria<Dataset>().order("name").order("-row_count");
    assert.deepEqual(q.value.order, [{ field: "row_count", descending: true }]);
  });

  it("drops the ordering when nothing is named", () => {
    assert.equal(criteria<Dataset>().order("name").order().value.order, undefined);
  });
});

describe("the page", () => {
  it("keeps the size when it resumes", () => {
    const q = criteria<Dataset>().limit(80).cursor("eyJrIjo");
    assert.deepEqual(q.value.pagination, { limit: 80, strategy: { token: "eyJrIjo" } });
  });

  it("counts rows when a grid jumps to a page", () => {
    assert.deepEqual(criteria<Dataset>().limit(25).offset(150).value.pagination, {
      limit: 25,
      strategy: { rows: 150 },
    });
  });
});

describe("the grouping", () => {
  it("accumulates its levels, in order", () => {
    const q = criteria<Dataset>().groupBy("encoding").groupBy(["registered_at", "month"]);
    // written positionally, and it travels as the object the engine reads
    assert.deepEqual(q.value.grouping?.group_by, [
      { field: "encoding" },
      { field: "registered_at", grain: "month" },
    ]);
  });

  it("adds the folds without losing the levels", () => {
    const q = criteria<Dataset>()
      .groupBy("encoding")
      .measures({ rows: measure.sum("row_count") })
      .measures({ biggest: measure.max("row_count") });
    assert.deepEqual(q.value.grouping, {
      group_by: [{ field: "encoding" }],
      measures: { rows: measure.sum("row_count"), biggest: measure.max("row_count") },
    });
  });

  it("orders and pages the buckets without touching the rest", () => {
    const q = criteria<Dataset>().groupBy("encoding").orderGroups("-count").limitGroups(10);
    assert.deepEqual(q.value.grouping?.group_by, [{ field: "encoding" }]);
    assert.deepEqual(q.value.grouping?.pagination, { limit: 10 });
  });
});

describe("the rest of what a criteria says", () => {
  it("carries the mask, replacing it", () => {
    const q = criteria<Dataset>()
      .specification({ name: {} })
      .specification({ name: {}, row_count: {} });
    assert.deepEqual(q.value.specification, { name: {}, row_count: {} });
  });

  it("says how much counting costs, and whether the definition travels", () => {
    const q = criteria<Dataset>().counting("exact").meta(false);
    assert.equal(q.value.count, "exact");
    assert.equal(q.value.meta, false);
  });
});
