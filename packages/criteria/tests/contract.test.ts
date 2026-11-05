/**
 * The contract a bounded context publishes, read into the definition the engine uses.
 *
 * `contract-parity.json`, right beside this file, is written by the Python framework's suite
 * (`tests/ddd/metamodel/test_contract.py`, `make criteria-contract`): each contract as a
 * discovery document carries it — JSON Schema with `x-sincpro` — and the description Python
 * holds of the same entity. **This proves `metaFromContract` reads what Python writes into
 * what Python means**, field by field.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import type { Contract, Formula } from "@sincpro/criteria";
import { matches, metaFromContract, valueOf, versionOf } from "@sincpro/criteria";

interface Case {
  name: string;
  contract: Contract;
  expected: Record<string, unknown>;
}

interface FormulaCase {
  name: string;
  formula: Formula;
  record: Record<string, unknown>;
  expected: number | string | null;
}

const fixtures = JSON.parse(
  readFileSync(new URL("./contract-parity.json", import.meta.url), "utf8"),
) as { cases: Case[]; formulas: FormulaCase[] };

describe("a published contract, read into the engine's definition", () => {
  for (const one of fixtures.cases) {
    it(`reads ${one.name} as Python describes it`, () => {
      assert.deepEqual(metaFromContract(one.contract), one.expected);
    });
  }

  it("keeps whose record a key names, and keeps the key a scalar", () => {
    // As sincpro_framework publishes `project_id: EntityID[Project]` (its own context) and
    // `tenant_id: EntityID[Tenant] | None` (a `Reference` to another context).
    const issue = metaFromContract({
      type: "object",
      properties: {
        project_id: { type: "string", "x-sincpro": { type: "text", relation: "Project" } },
        tenant_id: {
          anyOf: [{ type: "string" }, { type: "null" }],
          "x-sincpro": { type: "text", relation: "auth.Tenant" },
        },
      },
    } as Contract);

    assert.equal(issue.fields.project_id!.relation, "Project");
    assert.equal(issue.fields.project_id!.kind, "scalar");
    assert.equal(issue.fields.tenant_id!.relation, "auth.Tenant");
    assert.equal(issue.fields.tenant_id!.kind, "scalar");
    assert.equal(issue.fields.tenant_id!.nullable, true);
  });

  it("answers the version the contract carries, which a page's version is compared with", () => {
    const order = fixtures.cases.find((one) => one.name === "Order")!;
    assert.equal(versionOf(order.contract), order.contract["x-sincpro"]?.version);
    assert.match(versionOf(order.contract) ?? "", /^[0-9a-f]{64}$/);
  });

  it("checks offline what a value holds, as the server does on construction", () => {
    const order = metaFromContract(
      fixtures.cases.find((one) => one.name === "Order")!.contract,
    );
    const qty = order.fields.lines!.definition!.fields.qty!.holds!;

    assert.equal(matches({ value: 3 }, qty), true);
    assert.equal(matches({ value: 0 }, qty), false);
  });

  it("says what a change of a field reaches, so a form asks the server only then", () => {
    const order = metaFromContract(
      fixtures.cases.find((one) => one.name === "Order")!.contract,
    );

    assert.deepEqual(order.fields.lines!.affects, ["total"]);
    assert.deepEqual(order.fields.stage!.judged_by, ["delivery_when_confirmed"]);
    assert.equal(order.fields.note!.affects, undefined);
  });
});

describe("a relation, described by the contract of what it points at", () => {
  it("reads its definition from the document's other schemas, one level deep", () => {
    const order = fixtures.cases.find((one) => one.name === "Order")!.contract;
    const read = metaFromContract(order, order.$defs ?? {});

    assert.equal(read.fields.buyer!.definition?.aggregate, "Buyer");
    assert.deepEqual(Object.keys(read.fields.buyer!.definition!.fields), [
      "id",
      "created_at",
      "updated_at",
      "version",
      "name",
    ]);
  });

  it("is left undescribed when the document does not hold it", () => {
    const order = fixtures.cases.find((one) => one.name === "Order")!.contract;
    assert.equal(metaFromContract(order).fields.buyer!.definition, undefined);
  });
});

describe("a computation written down, answered as the server answers it", () => {
  for (const one of fixtures.formulas) {
    it(one.name, () => {
      assert.deepEqual(valueOf(one.formula, one.record), one.expected);
    });
  }

  it("answers nothing when a field it reads is empty", () => {
    assert.equal(valueOf({ op: "*", args: [{ $: "field", name: "qty" }, 2] }, {}), null);
  });
});
