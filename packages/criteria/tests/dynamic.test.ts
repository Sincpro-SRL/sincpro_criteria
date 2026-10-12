/**
 * A value that is read when the filter runs: what a caller writes, what travels, and what a
 * client does with it while it waits for the server.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Filter, Meta } from "@sincpro/criteria";
import {
  criteria,
  dynamic,
  explainFilter,
  filtered,
  InvalidCriteria,
  isDynamic,
  matches,
  pack,
  readCriteria,
  readExpression,
  unpack,
  validate,
} from "@sincpro/criteria";

import type { Dataset } from "./fixtures";
import { datasetMeta } from "./fixtures";

const now = new Date("2026-10-12T15:30:00Z");

interface Invoice {
  id: string;
  due: string;
  total: number;
  credit_limit: number | null;
  owner_id: string;
}

describe("writing a dynamic value", () => {
  it("is the object the server reads, with nothing computed here", () => {
    assert.deepEqual(dynamic.today(), { $: "today" });
    assert.deepEqual(dynamic.now(), { $: "now" });
    assert.deepEqual(dynamic.context("user_id"), { $: "context", key: "user_id" });
    assert.deepEqual(dynamic.param("steps.order.total"), {
      $: "param",
      name: "steps.order.total",
    });
    assert.deepEqual(dynamic.field<Invoice>("credit_limit"), {
      $: "field",
      name: "credit_limit",
    });
  });

  it("writes minus and startOf as the one spelling that travels", () => {
    assert.deepEqual(dynamic.today({ minus: { days: 30 } }), {
      $: "today",
      plus: { days: -30 },
    });
    assert.deepEqual(dynamic.today({ startOf: "month" }), { $: "today", start_of: "month" });
    assert.deepEqual(
      dynamic.context("report_date", { minus: { months: 3 }, startOf: "month" }),
      { $: "context", key: "report_date", plus: { months: -3 }, start_of: "month" },
    );
  });

  it("adds what moves forward and takes away what moves back, per unit", () => {
    assert.deepEqual(dynamic.today({ plus: { days: 10 }, minus: { days: 3, weeks: 1 } }), {
      $: "today",
      plus: { days: 7, weeks: -1 },
    });
    assert.deepEqual(dynamic.today({ plus: { days: 3 }, minus: { days: 3 } }), {
      $: "today",
    });
  });

  it("writes a period as a name or as a window of whole units", () => {
    assert.deepEqual(dynamic.period("this_month"), { $: "period", name: "this_month" });
    assert.deepEqual(dynamic.period({ unit: "day", last: 30 }), {
      $: "period",
      unit: "day",
      last: 30,
    });
    assert.deepEqual(dynamic.period({ unit: "week", next: 2, includeCurrent: true }), {
      $: "period",
      unit: "week",
      next: 2,
      include_current: true,
    });
  });

  it("refuses at run time what the types refuse at build time", () => {
    assert.throws(() => dynamic.period("this_mont" as "this_month"), InvalidCriteria);
    assert.throws(() => dynamic.period({ unit: "day", last: 0 }), /at least one unit/);
  });

  it("is told apart from a literal by the reserved key alone", () => {
    assert.equal(isDynamic({ $: "today" }), true);
    assert.equal(isDynamic({ today: 1 }), false);
    assert.equal(isDynamic({ $: "nothing" }), false);
    assert.equal(isDynamic("today"), false);
    assert.equal(isDynamic(null), false);
  });

  it("fits where a filter fits, in a builder, a triple and a group", () => {
    const q = criteria<Invoice>().where(
      ["due", "<", dynamic.today()],
      ["owner_id", "=", dynamic.context("user_id")],
      ["total", ">", dynamic.field<Invoice>("credit_limit")],
    );

    assert.deepEqual(q.value.where, {
      all: [
        { field: "due", operator: "<", value: { $: "today" } },
        { field: "owner_id", operator: "=", value: { $: "context", key: "user_id" } },
        { field: "total", operator: ">", value: { $: "field", name: "credit_limit" } },
      ],
    });
  });
});

describe("reading one that came from outside", () => {
  it("keeps it through a URL and back", () => {
    const q = criteria<Invoice>().where(["due", "<", dynamic.today({ minus: { days: 30 } })]);

    assert.deepEqual(unpack(pack(q)), q.value);
    assert.deepEqual(readCriteria(JSON.parse(JSON.stringify(q.value))), q.value);
  });

  it("refuses a name the engine does not resolve, naming the ones it does", () => {
    assert.throws(
      () => readExpression({ field: "due", operator: "<", value: { $: "todya" } }),
      /'todya' is not a value the engine resolves; use one of today, now, period/,
    );
  });

  it("refuses a value that lacks what it needs", () => {
    assert.throws(
      () => readExpression({ field: "a", operator: "=", value: { $: "context" } }),
      /carries a 'key'/,
    );
    assert.throws(
      () =>
        readExpression({
          field: "a",
          operator: "between",
          value: { $: "period", name: "this_month", unit: "day", last: 3 },
        }),
      /takes nothing else/,
    );
    assert.throws(
      () =>
        readExpression({
          field: "a",
          operator: "between",
          value: { $: "period", unit: "day" },
        }),
      /a name, or a unit with `last` or `next`/,
    );
    assert.throws(
      () =>
        readExpression({
          field: "a",
          operator: "<",
          value: { $: "today", plus: { day: -1 } },
        }),
      /'day' is not a unit of a span/,
    );
  });

  it("lets an object without the key through as the literal it is", () => {
    const read = readExpression({ field: "meta", operator: "=", value: { today: 1 } });
    assert.deepEqual(read, { field: "meta", operator: "=", value: { today: 1 } });
  });

  it("reads one inside a list, where a template keeps the text a person typed", () => {
    const read = readExpression({
      field: "code",
      operator: "in",
      value: [{ $: "param", name: "text" }, "0"],
    });
    assert.deepEqual(read, {
      field: "code",
      operator: "in",
      value: [{ $: "param", name: "text" }, "0"],
    });
  });
});

describe("narrowing rows in hand by one", () => {
  const rows: Invoice[] = [
    { id: "a", due: "2026-10-01", total: 50, credit_limit: 100, owner_id: "u-7" },
    { id: "b", due: "2026-10-12", total: 500, credit_limit: 100, owner_id: "u-7" },
    { id: "c", due: "2026-10-30", total: 100, credit_limit: null, owner_id: "u-9" },
  ];

  it("reads today once for the whole list, with the instant it is given", () => {
    const overdue = filtered(rows, ["due", "<", dynamic.today()], undefined, { now });

    assert.deepEqual(
      overdue.map((one) => one.id),
      ["a"],
    );
  });

  it("answers a different day when asked on a different day", () => {
    const later = new Date("2026-10-31T00:00:00Z");

    assert.deepEqual(
      filtered(rows, ["due", "<", dynamic.today()], undefined, { now: later }).map(
        (one) => one.id,
      ),
      ["a", "b", "c"],
    );
  });

  it("matches one record against a value of the context it is handed", () => {
    const mine: Filter<Invoice> = ["owner_id", "=", dynamic.context("user_id")];
    const [first, , third] = rows as [Invoice, Invoice, Invoice];
    const resolution = { now, context: { user_id: "u-7" } };

    assert.equal(matches(first, mine, undefined, resolution), true);
    assert.equal(matches(third, mine, undefined, resolution), false);
  });

  it("compares a column with another column of the same row", () => {
    const over = ["total", ">", dynamic.field<Invoice>("credit_limit")] as const;

    assert.deepEqual(
      filtered(rows, [...over], undefined, { now }).map((one) => one.id),
      ["b"],
      "a limit that holds nothing is not true and not false, as in SQL",
    );
  });

  it("keeps the range of a period as two bounds, the end left out", () => {
    const thisMonth = ["due", "between", dynamic.period("this_month")] as const;

    assert.deepEqual(
      filtered(rows, [...thisMonth], undefined, { now }).map((one) => one.id),
      ["a", "b", "c"],
    );
    assert.deepEqual(
      filtered(
        rows,
        ["due", "between", dynamic.period({ unit: "day", last: 20 })],
        undefined,
        {
          now,
        },
      ).map((one) => one.id),
      ["a"],
    );
  });

  it("leaves a filter with nothing dynamic exactly as it was", () => {
    assert.deepEqual(
      filtered(rows, ["total", ">", 60]).map((one) => one.id),
      ["b", "c"],
    );
  });
});

describe("checking one against the model", () => {
  const meta: Meta = {
    ...datasetMeta,
    fields: {
      ...datasetMeta.fields,
      row_limit: { ...datasetMeta.fields.row_count!, nullable: true },
    },
  };

  it("lets a value the server reads go through unread", () => {
    const { criteria: kept, dropped } = validate(
      criteria<Dataset>().where([
        "registered_at",
        ">=",
        dynamic.today({ minus: { days: 30 } }),
      ]),
      meta,
    );

    assert.deepEqual(dropped, []);
    assert.ok(kept.where);
  });

  it("keeps a column against another of the same type", () => {
    const { dropped } = validate(
      criteria().where(["row_count", ">", dynamic.field("row_limit")]),
      meta,
    );

    assert.deepEqual(dropped, []);
  });

  it("drops one that names a field the model lacks, saying which", () => {
    const { criteria: kept, dropped } = validate(
      criteria().where(["row_count", ">", dynamic.field("nowhere")]),
      meta,
    );

    assert.deepEqual(dropped, [{ field: "nowhere", reason: "unknown_field" }]);
    assert.equal(kept.where, undefined);
  });

  it("drops a column against another of another type, or with an operator that does not compare", () => {
    const text = validate(criteria().where(["row_count", ">", dynamic.field("name")]), meta);
    const within = validate(
      criteria().where(["row_count", "in", dynamic.field("row_limit")]),
      meta,
    );

    assert.deepEqual(text.dropped, [{ field: "row_count", reason: "bad_value" }]);
    assert.deepEqual(within.dropped, [{ field: "row_count", reason: "bad_value" }]);
  });

  it("refuses a period asked with anything but between", () => {
    const { refused } = validate(
      criteria().where(["registered_at", "=", dynamic.period("this_month")]),
      meta,
    );

    assert.equal(refused.length, 1);
    assert.equal(refused[0]?.reason, "bad_dynamic_value");
    assert.match(refused[0]?.message ?? "", /takes the operator 'between'/);
  });
});

describe("saying one in words", () => {
  it("says a day and a move the way a person does", () => {
    assert.equal(explainFilter(["due", "<", dynamic.today()]), "due < today");
    assert.equal(
      explainFilter(["due", ">=", dynamic.today({ minus: { days: 30 } })]),
      "due >= 30 days ago",
    );
    assert.equal(
      explainFilter(["due", "<=", dynamic.today({ plus: { weeks: 2 } })]),
      "due <= in 2 weeks",
    );
    assert.equal(
      explainFilter(["due", ">=", dynamic.today({ startOf: "month" })]),
      "due >= today (start of month)",
    );
  });

  it("says where a value comes from", () => {
    assert.equal(
      explainFilter(["owner_id", "=", dynamic.context("user_id")]),
      "owner_id = the context's user_id",
    );
    assert.equal(
      explainFilter(["due", ">=", dynamic.context("report_date", { minus: { months: 3 } })]),
      "due >= 3 months before the context's report_date",
    );
  });

  it("says a span of the calendar and a window", () => {
    assert.equal(
      explainFilter(["due", "between", dynamic.period("last_month")]),
      "due between last month",
    );
    assert.equal(
      explainFilter(["due", "between", dynamic.period({ unit: "day", last: 30 })]),
      "due between the last 30 days",
    );
    assert.equal(
      explainFilter([
        "due",
        "between",
        dynamic.period({ unit: "week", next: 1, includeCurrent: true }),
      ]),
      "due between the next 1 week (the current one included)",
    );
  });

  it("names the other field with the model's own word for it", () => {
    assert.equal(
      explainFilter(["row_count", ">", dynamic.field("registered_at")], {
        meta: datasetMeta,
      }),
      "Rows > Registered",
    );
  });
});
