import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { criteria, explain, measure, where } from "@sincpro/criteria";

import type { Dataset } from "./fixtures";
import { datasetMeta } from "./fixtures";

describe("a criteria in words", () => {
  it("reads as the sentence it is", () => {
    const q = criteria<Dataset>()
      .where(["encoding", "=", "utf-8"], ["row_count", ">", 1000])
      .order("-registered_at")
      .limit(100);
    assert.equal(
      explain(q),
      'where encoding = "utf-8" and row_count > 1000, by registered_at ↓, 100 per page',
    );
  });

  it("uses the model's own words when it has them", () => {
    const q = criteria<Dataset>().where(["row_count", ">", 1000]);
    assert.equal(
      explain(q, { meta: datasetMeta, locale: "es" }),
      "Conjuntos, where Filas > 1000",
    );
  });

  it("parenthesises a group so an or does not read as an and", () => {
    const q = criteria<Dataset>().where(
      where.all(
        ["encoding", "=", "utf-8"],
        where.any(["row_count", ">", 10], ["producer_id", "is null", true]),
      ),
    );
    assert.equal(
      explain(q),
      'where encoding = "utf-8" and (row_count > 10 or producer_id is empty)',
    );
  });

  it("says what a grouping counts", () => {
    const q = criteria<Dataset>()
      .groupBy("encoding")
      .groupBy(["registered_at", "month"])
      .measures({ rows: measure.sum("row_count") });
    assert.equal(
      explain(q),
      "grouped by encoding then registered_at by month, measuring rows",
    );
  });

  it("says everything when nothing was asked", () => {
    assert.equal(explain(criteria()), "everything");
  });
});
