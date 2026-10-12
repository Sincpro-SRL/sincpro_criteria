/**
 * What a dynamic value reads to, answered by this engine.
 *
 * `criteria-resolution.json`, right beside this file, is written by the Python framework's own
 * suite (`tests/ddd/criteria/test_criteria_contract.py`, `make criteria-contract`) with the
 * expectations written BY HAND: «thirty days ago» is a date a person can check. **This proves the
 * TypeScript resolver reads every value the way the engine does** — the month end clamped, the
 * week starting where the context says, a day across a clock change still a day.
 *
 * The file is copied over rather than generated here on purpose: data produced by the code under
 * test only proves the code agrees with itself.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import type { Expression } from "@sincpro/criteria";
import { readExpression, RESOLVERS } from "@sincpro/criteria";
import { readInstant, resolve } from "@sincpro/criteria/engine";

interface Case {
  name: string;
  now: string;
  timezone: string;
  week_starts_on: number;
  context: Record<string, unknown>;
  params: Record<string, unknown>;
  where: unknown;
  resolved: unknown;
}

interface Contract {
  resolvers: unknown[];
  cases: Case[];
}

const contract = JSON.parse(
  readFileSync(new URL("./criteria-resolution.json", import.meta.url), "utf8"),
) as Contract;

/** Two trees are the same when each leaf is: an instant is the same instant however it is written. */
function same(actual: unknown, expected: unknown, path = "$"): void {
  if (
    typeof actual === "string" &&
    typeof expected === "string" &&
    expected.includes("T") &&
    readInstant(expected) !== undefined
  ) {
    assert.equal(readInstant(actual)?.getTime(), readInstant(expected)?.getTime(), path);
    return;
  }
  if (Array.isArray(expected)) {
    assert.ok(Array.isArray(actual), `${path} is a list`);
    assert.equal(actual.length, expected.length, `${path} length`);
    expected.forEach((one, index) => same(actual[index], one, `${path}[${index}]`));
    return;
  }
  if (expected !== null && typeof expected === "object") {
    assert.ok(actual !== null && typeof actual === "object", `${path} is an object`);
    assert.deepEqual(
      Object.keys(actual as object).sort(),
      Object.keys(expected).sort(),
      `${path} keys`,
    );
    for (const [key, one] of Object.entries(expected)) {
      same((actual as Record<string, unknown>)[key], one, `${path}.${key}`);
    }
    return;
  }
  assert.equal(actual, expected, path);
}

describe("what a dynamic value reads to, against what the Python suite says it must", () => {
  for (const one of contract.cases) {
    it(one.name, () => {
      const run = resolve(readExpression(one.where), {
        now: new Date(one.now),
        timeZone: one.timezone,
        weekStartsOn: one.week_starts_on,
        context: one.context,
        params: one.params,
      });

      same(run, one.resolved);
    });
  }

  it("covers every kind of dynamic value this package declares", () => {
    const asked = JSON.stringify(contract.cases.map((one) => one.where));
    for (const kind of ["today", "now", "period", "context", "param", "field"]) {
      assert.ok(asked.includes(`"$":"${kind}"`), kind);
    }
  });

  it("publishes the same resolvers the server does", () => {
    assert.deepEqual(RESOLVERS, contract.resolvers);
  });
});

describe("what cannot be read is refused, not dropped", () => {
  const now = new Date("2026-10-12T15:30:00Z");

  it("a key the context does not hold", () => {
    assert.throws(
      () =>
        resolve(
          { field: "owner_id", operator: "=", value: { $: "context", key: "user_id" } },
          { now },
        ),
      /the context has no 'user_id'/,
    );
  });

  it("a period asked with equals", () => {
    const condition: Expression = {
      field: "due",
      operator: "=",
      value: { $: "period", name: "this_month" },
    };
    assert.throws(() => resolve(condition, { now }), /takes the operator 'between'/);
  });

  it("a date has no hours", () => {
    assert.throws(
      () =>
        resolve(
          { field: "due", operator: "<", value: { $: "today", plus: { hours: 2 } } },
          { now },
        ),
      /a date has no hours or minutes/,
    );
  });

  it("a tree with nothing dynamic comes back as it came", () => {
    const tree: Expression = { all: [{ field: "a", operator: "=", value: 1 }] };
    assert.equal(resolve(tree, { now }), tree);
    assert.equal(resolve(undefined, { now }), undefined);
  });
});
