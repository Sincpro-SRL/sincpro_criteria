import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { filtered, matches, where } from "@sincpro/criteria";
import { holds } from "@sincpro/criteria/engine";

describe("one comparison, the way SQL answers it", () => {
  it("compares what is there", () => {
    assert.equal(holds(3, ">", 1), true);
    assert.equal(holds(3, "<", 1), false);
    assert.equal(holds("labs.csv", "like", "LABS"), true);
    assert.equal(holds(5, "between", [1, 10]), true);
    assert.equal(holds(11, "between", [1, 10]), false);
  });

  it("answers nothing about a value that is not there", () => {
    // NULL compares to nothing: neither true nor false, so the row is left out.
    for (const operator of ["=", "!=", ">", "<", "in", "like", "contains"] as const) {
      assert.equal(holds(null, operator, 1), false, `null ${operator}`);
      assert.equal(holds(undefined, operator, 1), false, `undefined ${operator}`);
    }
  });

  it("asks whether a value is there at all", () => {
    assert.equal(holds(null, "is null", true), true);
    assert.equal(holds(undefined, "is null", true), true);
    assert.equal(holds("x", "is null", true), false);
    assert.equal(holds("x", "is null", false), true);
  });

  it("takes the empty-list question in both spellings", () => {
    assert.equal(holds([], "=", []), true);
    assert.equal(holds(null, "=", []), true);
    assert.equal(holds(["a"], "=", []), false);
    assert.equal(holds(["a"], "!=", []), true);
    assert.equal(holds([], "!=", []), false);
  });

  it("compares two lists by their members, not by being the same list", () => {
    assert.equal(holds(["a", "b"], "=", ["a", "b"]), true);
    assert.equal(holds(["a"], "=", ["b"]), false);
  });

  it("compares a date against the text a JSON carried", () => {
    const at = new Date("2026-03-14T00:00:00.000Z");
    assert.equal(holds(at, ">", "2026-01-01T00:00:00.000Z"), true);
    assert.equal(holds(at, "=", "2026-03-14T00:00:00.000Z"), true);
    assert.equal(holds("2026-03-14T00:00:00.000Z", "<", new Date("2026-04-01")), true);
  });

  it("asks about one member of a list column, and of a text", () => {
    assert.equal(holds(["raw", "clean"], "contains", "raw"), true);
    assert.equal(holds(["raw"], "not contains", "clean"), true);
    assert.equal(holds("labs.csv", "contains", "csv"), true);
  });

  it("takes a single value where a list was expected", () => {
    assert.equal(holds("a", "in", "a"), true);
    assert.equal(holds("a", "not in", ["b", "c"]), true);
  });
});

describe("a record against a whole filter", () => {
  const record = { name: "labs.csv", rows: 1200, producer: null, tags: ["raw"] };

  it("answers a tree the way the tree reads", () => {
    assert.equal(
      matches(record, where.all(["name", "like", "labs"], ["rows", ">", 1000])),
      true,
    );
    assert.equal(
      matches(record, where.all(["name", "like", "labs"], ["rows", ">", 5000])),
      false,
    );
    assert.equal(
      matches(record, where.any(["rows", ">", 5000], ["producer", "is null", true])),
      true,
    );
    assert.equal(matches(record, where.negate(["name", "=", "labs.csv"])), false);
  });

  it("is answered by everything when there is no filter", () => {
    assert.equal(matches(record, undefined), true);
  });

  it("answers every operator the same way the condition does", () => {
    assert.equal(matches(record, ["name", "!=", "other.csv"]), true);
    assert.equal(matches(record, ["name", "in", ["labs.csv", "other.csv"]]), true);
    assert.equal(matches(record, ["name", "not in", ["other.csv"]]), true);
    assert.equal(matches(record, ["rows", "between", [1000, 2000]]), true);
    assert.equal(matches(record, ["tags", "contains", "raw"]), true);
    assert.equal(matches(record, ["tags", "not contains", "clean"]), true);
  });
});

describe("narrowing a list already in hand", () => {
  const rows = [
    { id: "a", size: 1 },
    { id: "b", size: 5 },
    { id: "c", size: 9 },
  ];

  it("keeps what answers the filter, in the order it was given", () => {
    assert.deepEqual(
      filtered(rows, ["size", ">", 3]).map((one) => one.id),
      ["b", "c"],
    );
  });

  it("keeps everything when there is no filter", () => {
    assert.equal(filtered(rows, undefined).length, 3);
  });
});
