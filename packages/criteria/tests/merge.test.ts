import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { criteria, merge, narrowedBy, readFilter, resumingFrom } from "@sincpro/criteria";

describe("the law of merging two criteria", () => {
  it("ANDs the filters, because both restrictions hold", () => {
    const merged = merge(
      { where: readFilter(["a", "=", 1]) },
      { where: readFilter(["b", ">", 2]) },
    );
    assert.deepEqual(merged.where, {
      all: [readFilter(["a", "=", 1]), readFilter(["b", ">", 2])],
    });
  });

  it("keeps the filter flat however many times it is merged", () => {
    const once = merge(
      { where: readFilter(["a", "=", 1]) },
      { where: readFilter(["b", "=", 2]) },
    );
    const twice = merge(once, { where: readFilter(["c", "=", 3]) });
    assert.deepEqual(twice.where, {
      all: [readFilter(["a", "=", 1]), readFilter(["b", "=", 2]), readFilter(["c", "=", 3])],
    });
  });

  it("lets the more specific one replace the ordering and the page", () => {
    const merged = merge(
      { order: [{ field: "a" }], pagination: { limit: 20 } },
      { order: [{ field: "b" }], pagination: { limit: 50 } },
    );
    assert.deepEqual(merged.order, [{ field: "b" }]);
    assert.deepEqual(merged.pagination, { limit: 50 });
  });

  it("keeps this one's page when the other said nothing about it", () => {
    const merged = merge({ pagination: { limit: 20 } }, { where: readFilter(["a", "=", 1]) });
    assert.deepEqual(merged.pagination, { limit: 20 });
  });

  it("NEVER carries a cursor over, because the set it named may no longer exist", () => {
    const mine = { pagination: { limit: 20, strategy: { token: "eyJrIjo" } } };
    const merged = merge(mine, { where: readFilter(["a", "=", 1]) });
    assert.deepEqual(merged.pagination, { limit: 20 });
  });

  it("intersects the mask, because a mask can only take away", () => {
    const merged = merge(
      { specification: { id: {}, name: {}, total: {} } },
      { specification: { id: {}, name: {} } },
    );
    assert.deepEqual(Object.keys(merged.specification ?? {}), ["id", "name"]);
  });

  it("leaves the identity alone when nothing survives the intersection", () => {
    const merged = merge({ specification: { name: {} } }, { specification: { total: {} } });
    assert.deepEqual(merged.specification, {});
  });

  it("merges the nodes that survive, at any depth", () => {
    const narrowed = narrowedBy(
      { runs: { pagination: { limit: 20 } } },
      { runs: { where: readFilter(["state", "=", "done"]) } },
    );
    assert.deepEqual(narrowed.runs, {
      where: readFilter(["state", "=", "done"]),
      pagination: { limit: 20 },
    });
  });

  it("takes the other's grouping only when it asked to group", () => {
    const mine = { grouping: { group_by: [{ field: "encoding" }] } };
    assert.deepEqual(merge(mine, {}).grouping, mine.grouping);
    assert.deepEqual(merge(mine, { grouping: { group_by: [{ field: "name" }] } }).grouping, {
      group_by: [{ field: "name" }],
    });
  });

  it("ANDs meta, so that meta:false can be said at all", () => {
    assert.equal(merge({ meta: false }, {}).meta, false);
    assert.equal(merge({}, { meta: false }).meta, false);
    assert.equal(merge({ meta: true }, { meta: true }).meta, true);
    assert.equal(merge({}, {}).meta, undefined);
  });

  it("does not let silence overrule a count that was asked for", () => {
    assert.equal(merge({ count: "exact" }, {}).count, "exact");
    assert.equal(merge({ count: "exact" }, { count: "none" }).count, "none");
  });
});

describe("resuming", () => {
  it("puts the token inside the strategy, where the engine reads it", () => {
    assert.deepEqual(resumingFrom({ pagination: { limit: 80 } }, "eyJrIjo"), {
      pagination: { limit: 80, strategy: { token: "eyJrIjo" } },
    });
  });

  it("goes back to the first page with null", () => {
    const back = resumingFrom({ pagination: { limit: 80, strategy: { token: "x" } } }, null);
    assert.deepEqual(back.pagination?.strategy, { token: null });
  });
});

describe("merging through the builder", () => {
  it("is the same law", () => {
    const saved = criteria().where(["a", "=", 1]).limit(20);
    const typed = criteria().where(["b", ">", 2]);
    assert.deepEqual(saved.merge(typed).value, {
      where: {
        all: [readFilter(["a", "=", 1]), readFilter(["b", ">", 2])],
      },
      pagination: { limit: 20 },
    });
  });
});
