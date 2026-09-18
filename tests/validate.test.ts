import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Meta } from "@sincpro/criteria";
import {
  all,
  any,
  between,
  contains,
  criteria,
  eq,
  gt,
  isNull,
  like,
  validate,
} from "@sincpro/criteria";

import type { Dataset } from "./fixtures";
import { datasetMeta } from "./fixtures";

describe("what the model cannot answer is dropped, never refused", () => {
  it("drops a field the model does not have", () => {
    const { criteria: checked, dropped } = validate(
      criteria<Dataset>().where(eq("encoding", "utf-8"), eq("legacy_flag" as never, true)),
      datasetMeta,
    );
    assert.deepEqual(dropped, [{ field: "legacy_flag", reason: "unknown_field" }]);
    assert.deepEqual(checked.where, eq("encoding", "utf-8"));
  });

  it("drops an operator the type does not take", () => {
    const { dropped } = validate(
      criteria<Dataset>().where(like("row_count", "1000")),
      datasetMeta,
    );
    assert.deepEqual(dropped, [{ field: "row_count", reason: "unsupported_operator" }]);
  });

  it("drops a value that will not read as the field's type", () => {
    const { dropped } = validate(
      criteria<Dataset>().where(gt("row_count", "banana")),
      datasetMeta,
    );
    assert.deepEqual(dropped, [{ field: "row_count", reason: "bad_value" }]);
  });

  it("drops a specification node the model does not have", () => {
    const { dropped } = validate(
      criteria<Dataset>().specification({ name: {}, gone: {} } as never),
      datasetMeta,
    );
    assert.deepEqual(dropped, [{ field: "gone", reason: "unknown_field" }]);
  });

  it("drops a grouping level that points at another aggregate", () => {
    const { dropped } = validate(criteria<Dataset>().by("runs" as never), datasetMeta);
    assert.deepEqual(dropped, [{ field: "runs", reason: "unsupported_operator" }]);
  });
});

describe("the tree collapses around what it lost", () => {
  it("removes a connective that lost every part, rather than leaving it empty", () => {
    const { criteria: checked } = validate(
      criteria<Dataset>().where(any(eq("gone" as never, 1), eq("also_gone" as never, 2))),
      datasetMeta,
    );
    assert.equal(checked.where, undefined);
  });

  it("unwraps a connective left with one part", () => {
    const { criteria: checked } = validate(
      criteria<Dataset>().where(all(eq("encoding", "utf-8"), eq("gone" as never, 1))),
      datasetMeta,
    );
    assert.deepEqual(checked.where, eq("encoding", "utf-8"));
  });
});

describe("values are read into the type the column compares against", () => {
  it("reads the text a URL carries", () => {
    const { criteria: checked } = validate(
      criteria<Dataset>().where(gt("row_count", "1000")),
      datasetMeta,
    );
    assert.deepEqual(checked.where, gt("row_count", 1000));
  });

  it("reads every member of a multi-valued operator", () => {
    const { criteria: checked, dropped } = validate(
      criteria<Dataset>().where(between("row_count", "10", "20")),
      datasetMeta,
    );
    assert.deepEqual(dropped, []);
    assert.deepEqual(checked.where, between("row_count", 10, 20));
  });

  it("refuses two bounds that are not two", () => {
    const { dropped } = validate(
      criteria<Dataset>().where({ field: "row_count", operator: "between", value: [1] }),
      datasetMeta,
    );
    assert.deepEqual(dropped, [{ field: "row_count", reason: "bad_value" }]);
  });

  it("takes the value of is null as the question, not as the field's type", () => {
    const { criteria: checked, dropped } = validate(
      criteria<Dataset>().where(isNull("producer_id")),
      datasetMeta,
    );
    assert.deepEqual(dropped, []);
    assert.deepEqual(checked.where, isNull("producer_id"));
  });

  it("asks about one member of a list column", () => {
    const { dropped } = validate(
      criteria<Dataset>().where(contains("tags", "raw")),
      datasetMeta,
    );
    assert.deepEqual(dropped, []);
  });
});

describe("what the server would refuse outright", () => {
  it("names a field it cannot order by, so a menu can grey it out", () => {
    const { refused } = validate(criteria<Dataset>().order("producer_id"), datasetMeta);
    assert.equal(refused.length, 1);
    assert.equal(refused[0]?.reason, "not_sortable");
  });

  it("names an ordering field the model does not have", () => {
    const { refused } = validate(criteria<Dataset>().order("gone"), datasetMeta);
    assert.equal(refused[0]?.reason, "no_such_field");
  });

  it("names a having that reads something the grouping does not fold", () => {
    const { refused } = validate(
      criteria<Dataset>()
        .by("encoding")
        .totals({ rows: ["sum", "row_count"] })
        .having(gt("pages", 10)),
      datasetMeta,
    );
    assert.equal(refused[0]?.reason, "unknown_total");
  });

  it("says nothing about a having that reads count or a total it folds", () => {
    const { refused } = validate(
      criteria<Dataset>()
        .by("encoding")
        .totals({ rows: ["sum", "row_count"] })
        .having(all(gt("count", 10), gt("rows", 100))),
      datasetMeta,
    );
    assert.deepEqual(refused, []);
  });

  it("is silent when everything can be answered", () => {
    const { dropped, refused } = validate(
      criteria<Dataset>().where(eq("encoding", "utf-8")).order("-registered_at").limit(100),
      datasetMeta,
    );
    assert.deepEqual(dropped, []);
    assert.deepEqual(refused, []);
  });
});

describe("a node inside an expanded relation", () => {
  const runMeta: Meta = {
    aggregate: "Run",
    identity: "run_id",
    default_order: "-run_id",
    fields: {
      run_id: {
        type: "text",
        nullable: false,
        sortable: true,
        ops: ["=", "in"],
        kind: "scalar",
      },
      state: {
        type: "text",
        nullable: false,
        sortable: true,
        ops: ["=", "in"],
        kind: "scalar",
      },
    },
    translations: { name: { default: "Runs" }, labels: {} },
  };

  const withRelation: Meta = {
    ...datasetMeta,
    fields: {
      ...datasetMeta.fields,
      runs: { ...datasetMeta.fields.runs!, definition: runMeta },
    },
  };

  it("reports what the other side cannot answer, by its path", () => {
    const { dropped } = validate(
      criteria().specification({ runs: { where: eq("gone", 1) } }),
      withRelation,
    );
    assert.deepEqual(dropped, [{ field: "runs.gone", reason: "unknown_field" }]);
  });

  it("reports what the other side would refuse, by its path", () => {
    const { refused } = validate(
      criteria().specification({ runs: { order: [{ field: "gone" }] } }),
      withRelation,
    );
    assert.equal(refused[0]?.field, "runs.gone");
  });

  it("keeps the node it could check, cut to what survived", () => {
    const { criteria: checked } = validate(
      criteria().specification({ runs: { where: all(eq("state", "done"), eq("gone", 1)) } }),
      withRelation,
    );
    assert.deepEqual(checked.specification?.runs?.where, eq("state", "done"));
  });
});

describe("the criteria that comes back is the one the engine will answer", () => {
  it("does not keep a grouping level it just dropped", () => {
    const { criteria: checked, dropped } = validate(
      criteria<Dataset>().by("runs" as never),
      datasetMeta,
    );
    assert.deepEqual(dropped, [{ field: "runs", reason: "unsupported_operator" }]);
    assert.deepEqual(checked.grouping?.by, []);
  });

  it("keeps the levels it can answer", () => {
    const { criteria: checked } = validate(
      criteria<Dataset>()
        .by("encoding")
        .by("runs" as never),
      datasetMeta,
    );
    assert.deepEqual(checked.grouping?.by, [{ field: "encoding" }]);
  });
});

describe("a blank box in a filter form", () => {
  it("is not a zero", () => {
    const { criteria: checked, dropped } = validate(
      criteria<Dataset>().where(gt("row_count", "")),
      datasetMeta,
    );
    assert.deepEqual(dropped, [{ field: "row_count", reason: "bad_value" }]);
    assert.equal(checked.where, undefined);
  });

  it("is not a zero for a decimal either", () => {
    const { dropped } = validate(
      criteria<Dataset>().where(gt("row_count", "  ")),
      datasetMeta,
    );
    assert.deepEqual(dropped, [{ field: "row_count", reason: "bad_value" }]);
  });
});
