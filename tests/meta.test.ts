import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  fieldsThatFilter,
  fieldsThatGroup,
  fieldsThatSort,
  isFilterable,
  isRelational,
  labelOf,
  nameOf,
  operatorsFor,
  searchOver,
} from "@sincpro/criteria";

import { datasetMeta } from "./fixtures";

describe("what the definition says can be asked", () => {
  it("offers a field's operators without carrying a table", () => {
    assert.deepEqual(operatorsFor(datasetMeta, "encoding"), [
      "=",
      "!=",
      "in",
      "not in",
      "like",
    ]);
    assert.deepEqual(operatorsFor(datasetMeta, "gone"), []);
  });

  it("does not offer a relation as the target of a filter", () => {
    assert.equal(isFilterable(datasetMeta.fields.runs!), false);
    assert.equal(isRelational(datasetMeta.fields.runs!), true);
    assert.ok(!fieldsThatFilter(datasetMeta).includes("runs"));
  });

  it("does not offer a nullable column to order by, because a page would lose rows", () => {
    assert.ok(!fieldsThatSort(datasetMeta).includes("producer_id"));
    assert.ok(fieldsThatSort(datasetMeta).includes("registered_at"));
  });

  it("offers for grouping what can be asked about and is not a relation", () => {
    const grouped = fieldsThatGroup(datasetMeta);
    assert.ok(grouped.includes("encoding"));
    assert.ok(!grouped.includes("runs"));
  });
});

describe("the words a screen shows", () => {
  it("takes them from the model, in the language it is showing", () => {
    assert.equal(labelOf(datasetMeta, "row_count", "es"), "Filas");
    assert.equal(labelOf(datasetMeta, "row_count", "fr"), "Rows");
    assert.equal(nameOf(datasetMeta, "es"), "Conjuntos");
  });

  it("falls back to the field's own name rather than showing nothing", () => {
    assert.equal(labelOf(datasetMeta, "tags"), "tags");
  });
});

describe("a search box", () => {
  it("asks every text field the model says takes like", () => {
    const search = searchOver(datasetMeta, "labs");
    assert.deepEqual(search, {
      any: [
        { field: "dataset_id", operator: "like", value: "labs" },
        { field: "name", operator: "like", value: "labs" },
        { field: "encoding", operator: "like", value: "labs" },
        { field: "producer_id", operator: "like", value: "labs" },
      ],
    });
  });

  it("is no filter at all when nothing was typed", () => {
    assert.equal(searchOver(datasetMeta, "   "), undefined);
  });
});
