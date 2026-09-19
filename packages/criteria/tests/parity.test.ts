/**
 * The same cases, answered by this engine.
 *
 * `criteria-parity.json`, right beside this file, is written by the Python framework's own
 * suite (`tests/ddd/test_criteria_parity.py`, `make criteria-parity`) and says, for every
 * operator and every shape of tree, which rows a filter keeps. **This proves the TypeScript
 * evaluator answers the same** — including where SQL is odd: a `NULL` compares to nothing, an
 * empty list is a question of its own, a list is compared by its members.
 *
 * The file is copied over from the framework repo rather than generated here on purpose: data
 * produced by the code under test only proves the code agrees with itself.
 *
 * When the engine grows an operator, the case is added there and this fails until the engine
 * here answers it — which is the point.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import type { Expression } from "@sincpro/criteria";
import { conditionsOf, OPERATORS, readExpression } from "@sincpro/criteria";
import { filtered } from "@sincpro/criteria/engine";

interface Case {
  name: string;
  where: unknown;
  expected: string[];
}

interface Fixtures {
  rows: Record<string, unknown>[];
  cases: Case[];
}

const fixtures = JSON.parse(
  readFileSync(new URL("./criteria-parity.json", import.meta.url), "utf8"),
) as Fixtures;

describe("what the engine answers, against what the Python suite says it must", () => {
  for (const one of fixtures.cases) {
    it(one.name, () => {
      const where = one.where === null ? undefined : readExpression(one.where);
      assert.deepEqual(
        filtered(fixtures.rows, where).map((row) => row.id),
        one.expected,
      );
    });
  }

  it("covers every operator this package declares", () => {
    const asked = new Set(
      fixtures.cases
        .filter((one) => one.where !== null)
        .flatMap((one) => conditionsOf(readExpression(one.where) as Expression))
        .map((one) => one.operator),
    );

    assert.deepEqual([...asked].sort(), [...OPERATORS].sort());
  });
});
