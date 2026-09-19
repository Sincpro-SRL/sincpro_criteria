import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Filter } from "@sincpro/criteria";
import { readFilter, where } from "@sincpro/criteria";

const utf8 = { field: "encoding", operator: "=", value: "utf-8" };
const big = { field: "row_count", operator: ">", value: 1000 };

describe("a condition written as a triple", () => {
  it("is the same condition the engine reads", () => {
    assert.deepEqual(readFilter(["encoding", "=", "utf-8"]), utf8);
  });

  it("asks the question with the value, for is null", () => {
    assert.deepEqual(readFilter(["producer_id", "is null", true]), {
      field: "producer_id",
      operator: "is null",
      value: true,
    });
  });

  it("carries a list where the operator takes one", () => {
    assert.deepEqual(readFilter(["row_count", "between", [10, 20]]), {
      field: "row_count",
      operator: "between",
      value: [10, 20],
    });
  });

  it("is refused when it names an operator the engine does not declare", () => {
    assert.throws(() => readFilter(["encoding", "=~" as never, 1]), /not an operator/);
  });

  it("leaves the object form exactly as it was written", () => {
    assert.deepEqual(readFilter(utf8 as Filter), utf8);
  });

  it("reads the triples inside a group, at any depth", () => {
    assert.deepEqual(
      readFilter({ any: [["encoding", "=", "utf-8"], { negate: big as Filter }] }),
      {
        any: [utf8, { negate: big }],
      },
    );
  });
});

describe("combining", () => {
  it("needs no wrapper for one part", () => {
    assert.deepEqual(where.all(["encoding", "=", "utf-8"]), utf8);
    assert.deepEqual(where.any(["encoding", "=", "utf-8"]), utf8);
  });

  it("is nothing when nothing survives, because an empty AND matches everything", () => {
    assert.equal(where.all(), undefined);
    assert.equal(where.all(undefined, undefined), undefined);
    assert.equal(where.any(), undefined);
    assert.equal(where.negate(undefined), undefined);
  });

  it("drops the empty parts and keeps the rest", () => {
    assert.deepEqual(
      where.all(["encoding", "=", "utf-8"], undefined, ["row_count", ">", 1000]),
      {
        all: [utf8, big],
      },
    );
  });

  it("negates what it was given", () => {
    assert.deepEqual(where.negate(["encoding", "=", "utf-8"]), { negate: utf8 });
  });

  it("splices an incoming all instead of nesting it", () => {
    assert.deepEqual(
      where.combined({ all: [utf8, big] } as Filter, ["name", "like", "labs"]),
      {
        all: [utf8, big, { field: "name", operator: "like", value: "labs" }],
      },
    );
  });

  it("does not splice an any, which would change what it means", () => {
    const either = where.any(["encoding", "=", "utf-8"], ["encoding", "=", "latin-1"])!;
    assert.deepEqual(where.combined(either as Filter, ["row_count", ">", 1000]), {
      all: [either, big],
    });
  });
});

describe("a filter a screen builds", () => {
  it("reads left to right, and comes out as the tree the engine takes", () => {
    const written = where.all(
      ["name", "like", "labs"],
      where.any(["encoding", "=", "utf-8"], ["producer_id", "is null", true]),
      where.negate(["name", "like", "draft"]),
    );

    assert.deepEqual(written, {
      all: [
        { field: "name", operator: "like", value: "labs" },
        {
          any: [utf8, { field: "producer_id", operator: "is null", value: true }],
        },
        { negate: { field: "name", operator: "like", value: "draft" } },
      ],
    });
  });

  it("disappears when every chip is switched off, instead of turning into its opposite", () => {
    const chips: (Filter | undefined)[] = [undefined, undefined];
    assert.equal(where.any(...chips), undefined);
  });
});
