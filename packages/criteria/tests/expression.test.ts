import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { conditionsOf, InvalidCriteria, readExpression, where } from "@sincpro/criteria";

describe("reading a tree", () => {
  it("returns every leaf in reading order", () => {
    const tree = where.all(
      where.any(["a", "=", 1], ["b", "=", 2]),
      where.negate(["c", "=", 3]),
    )!;
    assert.deepEqual(
      conditionsOf(tree).map((one) => one.field),
      ["a", "b", "c"],
    );
  });

  it("has no leaves when there is no filter", () => {
    assert.deepEqual(conditionsOf(undefined), []);
  });
});

describe("reading a filter that came from outside", () => {
  it("reads the tree, recursively", () => {
    const written = {
      any: [{ field: "a", operator: ">", value: 1 }, { negate: { field: "b", value: 2 } }],
    };
    assert.deepEqual(readExpression(written), {
      any: [
        { field: "a", operator: ">", value: 1 },
        { negate: { field: "b", operator: "=", value: 2 } },
      ],
    });
  });

  it("reads a triple, because a saved filter may have been written by hand", () => {
    assert.deepEqual(readExpression(["a", ">", 1]), { field: "a", operator: ">", value: 1 });
  });

  it("takes equality as the operator nobody wrote", () => {
    assert.deepEqual(readExpression({ field: "a", value: 1 }), {
      field: "a",
      operator: "=",
      value: 1,
    });
  });

  it("refuses an operator the engine does not declare", () => {
    assert.throws(
      () => readExpression({ field: "a", operator: "=~", value: 1 }),
      InvalidCriteria,
    );
    assert.throws(() => readExpression(["a", "=~", 1]), InvalidCriteria);
  });

  it("refuses a condition with no value, which is not a condition", () => {
    assert.throws(() => readExpression({ field: "a", operator: "=" }), InvalidCriteria);
  });

  it("refuses an object that is neither a condition nor a group", () => {
    assert.throws(() => readExpression({ limit: 10 }), InvalidCriteria);
    assert.throws(() => readExpression("filter"), InvalidCriteria);
  });

  it("refuses a group whose parts are not a list", () => {
    assert.throws(() => readExpression({ all: { field: "a", value: 1 } }), InvalidCriteria);
  });
});
