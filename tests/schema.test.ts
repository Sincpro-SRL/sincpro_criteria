/**
 * The published JSON Schema and the types are two ways of saying the same thing, and a schema
 * that drifts is worse than none: an IDE would complete an operator the engine refuses.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { FOLD_FUNCTIONS, GRAINS, OPERATORS, readCriteria } from "@sincpro/criteria";

const schema = JSON.parse(
  readFileSync(new URL("../criteria.schema.json", import.meta.url), "utf8"),
);

describe("the published schema", () => {
  it("declares the same operators the code does", () => {
    assert.deepEqual(schema.$defs.operator.enum, [...OPERATORS]);
  });

  it("declares the same grains, plus the null that means none", () => {
    assert.deepEqual(schema.$defs.level.properties.grain.enum, [...GRAINS, null]);
  });

  it("declares the same folds", () => {
    assert.deepEqual(schema.$defs.fold.prefixItems[0].enum, [...FOLD_FUNCTIONS]);
  });

  it("declares the same count modes", () => {
    assert.deepEqual(schema.properties.count.enum, ["none", "capped", "exact"]);
  });

  it("names every part of a criteria and nothing else", () => {
    assert.deepEqual(Object.keys(schema.properties), [
      "where",
      "order",
      "pagination",
      "specification",
      "grouping",
      "count",
      "meta",
    ]);
  });

  it("carries an example the reader actually accepts", () => {
    for (const example of schema.examples) {
      assert.deepEqual(readCriteria(example), example);
    }
  });
});
