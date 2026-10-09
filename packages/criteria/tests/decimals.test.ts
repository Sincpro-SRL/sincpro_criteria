import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Meta } from "@sincpro/criteria";
import { criteria, filtered, matches } from "@sincpro/criteria";
import { answer, compareDecimals, holds, readDecimal } from "@sincpro/criteria/engine";

/**
 * An invoice the way the engine sends it: `amount` is a `Decimal`, so it travels as text and
 * the model marks it `exact`; `code` is text that only looks like a number.
 */
const invoiceMeta: Meta = {
  aggregate: "Invoice",
  identity: "id",
  default_order: "-id",
  translations: { name: { default: "Invoice" }, labels: {} },
  fields: {
    id: {
      type: "text",
      nullable: false,
      sortable: true,
      ops: ["=", "!=", "in", "not in"],
      kind: "scalar",
      readonly: true,
    },
    code: {
      type: "text",
      nullable: false,
      sortable: true,
      ops: ["=", "!=", "in", "not in", "like", "starts with"],
      kind: "scalar",
    },
    state: {
      type: "text",
      nullable: false,
      sortable: true,
      choices: ["draft", "confirmed"],
      ops: ["=", "!=", "in", "not in"],
      kind: "scalar",
      default: "draft",
    },
    amount: {
      type: "number",
      nullable: false,
      sortable: true,
      exact: true,
      ops: ["=", "!=", ">", ">=", "<", "<=", "between", "in", "not in"],
      kind: "scalar",
      default: "0",
      readonly_when: { field: "state", operator: "!=", value: "draft" },
    },
    discount_reason: {
      type: "text",
      nullable: false,
      sortable: true,
      ops: ["=", "!=", "like"],
      kind: "scalar",
      required_when: {
        all: [
          { field: "state", operator: "=", value: "draft" },
          { field: "amount", operator: ">", value: "1000" },
        ],
      },
    },
  },
};

const rows = [
  { id: "a", code: "007", state: "draft", amount: "9.50", discount_reason: "" },
  { id: "b", code: "7", state: "confirmed", amount: "10.00", discount_reason: "" },
  { id: "c", code: "10", state: "draft", amount: "1200.0", discount_reason: "" },
  { id: "d", code: "1.2.3", state: "draft", amount: "-3", discount_reason: "" },
];

describe("a decimal read exactly, never through Number", () => {
  it("drops the zeros that change nothing and refuses what is not a number", () => {
    assert.deepEqual(readDecimal("010.500"), { negative: false, whole: "10", fraction: "5" });
    assert.deepEqual(readDecimal("-0.00"), { negative: false, whole: "0", fraction: "" });
    assert.deepEqual(readDecimal(12.25), { negative: false, whole: "12", fraction: "25" });
    assert.equal(readDecimal("1.2.3"), undefined);
    assert.equal(readDecimal("1e-7"), undefined);
    assert.equal(readDecimal(1e-7), undefined);
    assert.equal(readDecimal(null), undefined);
  });

  it("compares as a NUMERIC column does", () => {
    assert.equal(compareDecimals("10.00", "9.5"), 1);
    assert.equal(compareDecimals("10.0", "10.00"), 0);
    assert.equal(compareDecimals("-3", "-10"), 1);
    assert.equal(compareDecimals("-0.01", "0"), -1);
    assert.equal(compareDecimals("0.1", "0.09"), 1);
    assert.equal(compareDecimals("12345678901234567890.01", "12345678901234567890.001"), 1);
    assert.equal(compareDecimals("abc", "1"), undefined);
  });
});

describe("one comparison on a decimal field", () => {
  it("compares as text when nobody said the field is exact — the reason the flag exists", () => {
    assert.equal(holds("10.00", ">", "9.50"), false);
    assert.equal(holds("10.0", "=", "10.00"), false);
  });

  it("compares as numbers on an exact field", () => {
    assert.equal(holds("10.00", ">", "9.50", true), true);
    assert.equal(holds("10.0", "=", "10.00", true), true);
    assert.equal(holds("10.0", "!=", "10.00", true), false);
    assert.equal(holds("10", "in", ["9.5", "10.000"], true), true);
    assert.equal(holds("10", "between", ["9.99", "10.01"], true), true);
    assert.equal(holds(null, ">", "1", true), false);
  });
});

describe("a filter with the model in hand", () => {
  it("reads the decimal field as numbers and leaves a text field as text", () => {
    const over = filtered(
      rows,
      { field: "amount", operator: ">", value: "9.75" },
      invoiceMeta,
    );
    const seven = filtered(rows, { field: "code", operator: "=", value: "7" }, invoiceMeta);

    assert.deepEqual(
      over.map((row) => row.id),
      ["b", "c"],
    );
    assert.deepEqual(
      seven.map((row) => row.id),
      ["b"],
    );
  });

  it("answers the same without the model only where text and number agree", () => {
    assert.equal(matches(rows[1]!, { field: "amount", operator: ">", value: "9.75" }), false);
    assert.equal(
      matches(rows[1]!, { field: "amount", operator: ">", value: "9.75" }, invoiceMeta),
      true,
    );
  });
});

describe("a page of decimals", () => {
  it("is ordered and filtered as numbers", () => {
    const page = answer(rows, criteria().order("amount").limit(10), invoiceMeta);

    assert.deepEqual(
      page.rows.map((row) => row.amount),
      ["-3", "9.50", "10.00", "1200.0"],
    );
  });

  it("walks the cursor across a decimal key without losing or repeating a row", () => {
    const first = answer(rows, criteria().order("amount").limit(2), invoiceMeta);
    assert.ok(first.cursor);
    const next = answer(
      rows,
      criteria().order("amount").limit(2).cursor(first.cursor),
      invoiceMeta,
    );

    assert.deepEqual(
      [...first.rows, ...next.rows].map((row) => row.id),
      ["d", "a", "b", "c"],
    );
  });
});

describe("the form hints a client evaluates", () => {
  it("greys the amount once the invoice leaves the draft", () => {
    const condition = invoiceMeta.fields.amount!.readonly_when!;

    assert.equal(matches(rows[0]!, condition, invoiceMeta), false);
    assert.equal(matches(rows[1]!, condition, invoiceMeta), true);
  });

  it("asks for a reason only on a large draft, comparing the amount as a number", () => {
    const condition = invoiceMeta.fields.discount_reason!.required_when!;

    assert.deepEqual(
      rows.filter((row) => matches(row, condition, invoiceMeta)).map((row) => row.id),
      ["c"],
    );
    // As text, "9.50" > "1000" too — the draft of nine bolivianos would be asked for a reason.
    assert.deepEqual(
      rows.filter((row) => matches(row, condition)).map((row) => row.id),
      ["a", "c"],
    );
  });

  it("starts a new record from the published defaults", () => {
    const fresh = Object.fromEntries(
      Object.entries(invoiceMeta.fields)
        .filter(([, field]) => field.default !== undefined)
        .map(([name, field]) => [name, field.default]),
    );

    assert.deepEqual(fresh, { state: "draft", amount: "0" });
  });
});
