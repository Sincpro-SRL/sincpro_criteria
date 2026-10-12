/**
 * The published JSON Schema and the types are two ways of saying the same thing, and a schema
 * that drifts is worse than none: an IDE would complete an operator the engine refuses.
 *
 * The schema is GENERATED from the engine's own models (`make criteria-contract` in the
 * framework), so it can say nothing the engine does not; what these tests hold it to is that this
 * package's constants say the same.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  DYNAMIC_KINDS,
  GRAINS,
  MEASURE_FUNCTIONS,
  OPERATORS,
  PARTS,
  PERIODS,
  readCriteria,
  UNITS,
} from "@sincpro/criteria";

const schema = JSON.parse(
  readFileSync(new URL("../criteria.schema.json", import.meta.url), "utf8"),
);

describe("the published schema", () => {
  it("declares the same operators the code does", () => {
    assert.deepEqual(schema.$defs.Operator.enum, [...OPERATORS]);
  });

  it("declares the same grains, plus the null that means none", () => {
    assert.deepEqual(schema.$defs.Grain.enum, [...GRAINS]);
    const level = schema.$defs.Level.properties.grain.anyOf;
    assert.deepEqual(level, [{ $ref: "#/$defs/Grain" }, { type: "null" }]);
  });

  it("declares the same parts of a date, and a level that may be filled", () => {
    assert.deepEqual(schema.$defs.Part.enum, [...PARTS]);
    assert.deepEqual(Object.keys(schema.$defs.Level.properties), [
      "field",
      "grain",
      "part",
      "fill",
    ]);
  });

  it("declares the same folds", () => {
    assert.deepEqual(schema.$defs.Measure.properties.function.enum, [...MEASURE_FUNCTIONS]);
  });

  it("declares the same count modes", () => {
    assert.deepEqual(schema.$defs.CountMode.enum, ["none", "capped", "exact"]);
  });

  it("names every part of a criteria and nothing else", () => {
    assert.equal(schema.$ref, "#/$defs/Criteria");
    assert.deepEqual(Object.keys(schema.$defs.Criteria.properties), [
      "where",
      "order",
      "pagination",
      "specification",
      "grouping",
      "count",
      "meta",
    ]);
  });

  it("declares the same dynamic values the code does, each under its own name", () => {
    const named = ["Today", "Now", "FromContext", "Param", "Period", "FromField"].map(
      (def) => schema.$defs[def].properties.$.const,
    );
    assert.deepEqual([...named].sort(), [...DYNAMIC_KINDS].sort());
  });

  it("declares the same units of a span, the same periods and the same snaps", () => {
    assert.deepEqual(Object.keys(schema.$defs.Span.properties), [...UNITS]);
    assert.deepEqual(schema.$defs.Periods.enum, [...PERIODS]);
    assert.equal(schema.$defs.Today.properties.start_of.anyOf[0].$ref, "#/$defs/Grain");
  });

  it("carries examples the reader actually accepts", () => {
    assert.ok(schema.examples.length >= 2);
    for (const example of schema.examples) {
      assert.deepEqual(readCriteria(example), example);
    }
  });
});
