import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { criteria, measure, readFilter, selection } from "@sincpro/criteria";

import type { Dataset } from "./fixtures";

describe("the builder", () => {
  it("is the plain object and nothing else", () => {
    const q = criteria<Dataset>().selection(["encoding", "=", "utf-8"]).limit(100);
    assert.deepEqual(q.value, {
      selection: { field: "encoding", operator: "=", value: "utf-8" },
      pagination: { limit: 100 },
    });
    assert.equal(JSON.stringify(q), JSON.stringify(q.value));
  });

  it("never touches the one it came from", () => {
    const base = criteria<Dataset>().limit(50);
    const refined = base.selection(["name", "like", "labs"]);
    assert.equal(base.value.selection, undefined);
    assert.deepEqual(refined.value.pagination, { limit: 50 });
  });

  it("accumulates the filter with AND, flat", () => {
    const q = criteria<Dataset>()
      .selection(["encoding", "=", "utf-8"])
      .selection(["row_count", ">", 1000]);
    assert.deepEqual(q.value.selection, {
      all: [readFilter(["encoding", "=", "utf-8"]), readFilter(["row_count", ">", 1000])],
    });
  });

  it("ignores the parts that are not there", () => {
    const q = criteria<Dataset>().selection(undefined);
    assert.equal(q.value.selection, undefined);
  });

  it("writes selection, the field the framework reads", () => {
    const q = criteria<Dataset>().selection(
      ["encoding", "=", "utf-8"],
      selection.any(["tags", "contains", "raw"], ["producer_id", "is null", true]),
      selection.negate(["name", "like", "draft"]),
    );

    assert.deepEqual(q.value.selection, {
      all: [
        { field: "encoding", operator: "=", value: "utf-8" },
        {
          any: [
            { field: "tags", operator: "contains", value: "raw" },
            { field: "producer_id", operator: "is null", value: true },
          ],
        },
        { negate: { field: "name", operator: "like", value: "draft" } },
      ],
    });
    assert.equal("where" in q.value, false);
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

  it("says how much counting costs", () => {
    const q = criteria<Dataset>().counting("exact");
    assert.equal(q.value.count, "exact");
  });
});
