import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  all,
  any,
  combined,
  conditionsOf,
  eq,
  gt,
  InvalidCriteria,
  isNull,
  like,
  negate,
  readExpression,
} from "@sincpro/criteria";

describe("writing conditions", () => {
  it("writes the triple the engine declares", () => {
    assert.deepEqual(eq("encoding", "utf-8"), {
      field: "encoding",
      operator: "=",
      value: "utf-8",
    });
  });

  it("asks the question with the value, for is null", () => {
    assert.deepEqual(isNull("producer_id"), {
      field: "producer_id",
      operator: "is null",
      value: true,
    });
    assert.equal(isNull("producer_id", false).value, false);
  });
});

describe("combining", () => {
  it("needs no wrapper for one part", () => {
    assert.deepEqual(all(eq("a", 1)), eq("a", 1));
    assert.deepEqual(any(eq("a", 1)), eq("a", 1));
  });

  it("is nothing when nothing survives, because an empty AND matches everything", () => {
    assert.equal(all(), undefined);
    assert.equal(all(undefined, undefined), undefined);
    assert.equal(any(), undefined);
    assert.equal(negate(undefined), undefined);
  });

  it("drops the empty parts and keeps the rest", () => {
    assert.deepEqual(all(eq("a", 1), undefined, eq("b", 2)), {
      all: [eq("a", 1), eq("b", 2)],
    });
  });

  it("splices an incoming all instead of nesting it", () => {
    assert.deepEqual(combined({ all: [eq("a", 1), eq("b", 2)] }, eq("c", 3)), {
      all: [eq("a", 1), eq("b", 2), eq("c", 3)],
    });
  });

  it("does not splice an any, which would change what it means", () => {
    const either = any(eq("a", 1), eq("b", 2))!;
    assert.deepEqual(combined(either, eq("c", 3)), { all: [either, eq("c", 3)] });
  });
});

describe("reading a tree", () => {
  it("returns every leaf in reading order", () => {
    const tree = all(any(eq("a", 1), eq("b", 2)), negate(eq("c", 3)))!;
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
      any: [gt("a", 1), { negate: eq("b", 2) }],
    });
  });

  it("takes equality as the operator nobody wrote", () => {
    assert.deepEqual(readExpression({ field: "a", value: 1 }), eq("a", 1));
  });

  it("refuses an operator the engine does not declare", () => {
    assert.throws(
      () => readExpression({ field: "a", operator: "=~", value: 1 }),
      InvalidCriteria,
    );
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

describe("a filter that a screen builds", () => {
  it("reads like the sentence it came from", () => {
    const filter = all(
      like("name", "labs"),
      any(eq("encoding", "utf-8"), isNull("producer_id")),
    );
    assert.deepEqual(filter, {
      all: [
        { field: "name", operator: "like", value: "labs" },
        {
          any: [
            { field: "encoding", operator: "=", value: "utf-8" },
            { field: "producer_id", operator: "is null", value: true },
          ],
        },
      ],
    });
  });
});
