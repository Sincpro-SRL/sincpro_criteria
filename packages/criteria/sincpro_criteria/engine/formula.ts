import type { AnyRecord } from "@sincpro/criteria/criteria/grammar";

/**
 * What a computed field returns, written down by the server when its computation is simple
 * enough (`x-sincpro.computes`): `+`, `-`, `*` over the record's own fields and literal numbers,
 * and a sum over the records a field holds.
 *
 *     {"$": "field", "name": "qty"}                    a field of the record
 *     12, "12.50"                                      a literal; a text is an exact decimal
 *     {"op": "+" | "-" | "*", "args": [a, b, …]}       left to right; "-" with one negates
 *     {"op": "sum", "of": "lines", "each": formula, "from": 0 | "0"}
 */
export type Formula =
  | { $: "field"; name: string }
  | number
  | string
  | { op: "+" | "-" | "*"; args: Formula[] }
  | { op: "sum"; of: string; each: Formula; from: number | string };

/** An exact decimal: its digits and how many of them are decimals — Python's `Decimal`. */
type Exact = { digits: bigint; scale: number };

function exactOf(text: string): Exact {
  const negative = text.startsWith("-");
  const unsigned = negative || text.startsWith("+") ? text.slice(1) : text;
  const [whole = "0", decimals = ""] = unsigned.split(".");
  const digits = BigInt(`${whole}${decimals}` || "0");
  return { digits: negative ? -digits : digits, scale: decimals.length };
}

function textOf(exact: Exact): string {
  const negative = exact.digits < 0n;
  const written = (negative ? -exact.digits : exact.digits)
    .toString()
    .padStart(exact.scale + 1, "0");
  const whole = written.slice(0, written.length - exact.scale);
  const decimals = written.slice(written.length - exact.scale);
  return `${negative ? "-" : ""}${whole}${exact.scale > 0 ? `.${decimals}` : ""}`;
}

type Value = number | Exact | null;

function exact(value: number | Exact): Exact {
  return typeof value === "number" ? exactOf(String(value)) : value;
}

/** `a op b`: whole numbers stay whole; a decimal makes it exact, its places as Python's. */
function applied(op: "+" | "-" | "*", a: Value, b: Value): Value {
  if (a === null || b === null) return null;
  if (typeof a === "number" && typeof b === "number") {
    return op === "+" ? a + b : op === "-" ? a - b : a * b;
  }
  const left = exact(a);
  const right = exact(b);
  if (op === "*") {
    return { digits: left.digits * right.digits, scale: left.scale + right.scale };
  }
  const scale = Math.max(left.scale, right.scale);
  const aligned = (one: Exact) => one.digits * 10n ** BigInt(scale - one.scale);
  return {
    digits: op === "+" ? aligned(left) + aligned(right) : aligned(left) - aligned(right),
    scale,
  };
}

function read(value: unknown): Value {
  if (typeof value === "string") return exactOf(value);
  if (typeof value === "number") return value;
  return null;
}

function evaluated(formula: Formula, record: AnyRecord): Value {
  if (typeof formula === "number" || typeof formula === "string") return read(formula);
  if ("$" in formula) return read(record[formula.name]);
  if (formula.op === "sum") {
    const held = record[formula.of];
    const records = Array.isArray(held)
      ? held
      : held === null || held === undefined
        ? []
        : [held];
    return records.reduce<Value>(
      (total, one) => applied("+", total, evaluated(formula.each, one as AnyRecord)),
      read(formula.from),
    );
  }
  const [first, ...rest] = formula.args.map((part) => evaluated(part, record));
  if (formula.op === "-" && rest.length === 0) {
    if (first === null || first === undefined) return null;
    return typeof first === "number" ? -first : { digits: -first.digits, scale: first.scale };
  }
  return rest.reduce<Value>(
    (answered, one) => applied(formula.op, answered, one),
    first ?? null,
  );
}

/**
 * What `formula` answers over `record` — what the server's computation returns, exactly: a
 * decimal as its text with the places Python's `Decimal` gives it (`2 * "12.50"` is `"25.00"`),
 * whole numbers as numbers. `null` when a field it reads is empty.
 *
 * @example
 * valueOf(meta.fields.amount.computes!, { qty: 2, price: "12.50" }); // "25.00"
 */
export function valueOf(formula: Formula, record: AnyRecord): number | string | null {
  const answered = evaluated(formula, record);
  if (answered === null) return null;
  return typeof answered === "number" ? answered : textOf(answered);
}
