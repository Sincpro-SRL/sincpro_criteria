import type { AnyRecord, Operator } from "@sincpro/criteria/criteria/grammar";
import { isInstant } from "@sincpro/criteria/engine/temporal";
import type { FieldMeta, FieldType, Meta } from "@sincpro/criteria/meta/meta";

const COMPARABLE: Operator[] = ["=", "!=", ">", ">=", "<", "<=", "between"];
const LISTED: Operator[] = ["in", "not in"];

const OPERATORS_BY_TYPE: Record<string, Operator[]> = {
  text: ["=", "!=", "like", ...LISTED],
  integer: [...COMPARABLE, ...LISTED],
  number: COMPARABLE,
  boolean: ["="],
  date: COMPARABLE,
  datetime: COMPARABLE,
  "text[]": ["contains", "not contains", "=", "!="],
  unknown: [],
};

/** How to read a set of rows. */
export interface DescribeOptions {
  /** What the model is called. */
  aggregate?: string;

  /** Which field identifies a row. Without it, the first field of the first row. */
  identity?: string;

  /** The order rows come back in when a criteria asks for none. */
  defaultOrder?: string;
}

/**
 * The definition a set of rows implies.
 *
 * @example
 * const meta = describeRows(rows, { identity: "dataset_id" });
 * fieldsThatFilter(meta); // every column the rows actually carry
 */
export function describeRows<T = AnyRecord>(
  rows: readonly T[],
  options: DescribeOptions = {},
): Meta {
  const names: string[] = [];
  for (const row of rows) {
    for (const name of Object.keys(row as AnyRecord)) {
      if (!names.includes(name)) names.push(name);
    }
  }

  const identity = options.identity ?? names[0] ?? "id";
  const fields: Record<string, FieldMeta> = {};
  for (const name of names) {
    fields[name] = fieldOf(rows as readonly AnyRecord[], name);
  }

  return {
    aggregate: options.aggregate ?? "Record",
    identity,
    default_order: options.defaultOrder ?? (identity === "" ? "" : `-${identity}`),
    fields,
    translations: { name: { default: options.aggregate ?? "Record" }, labels: {} },
  };
}

function fieldOf(rows: readonly AnyRecord[], name: string): FieldMeta {
  let type: FieldType = "unknown";
  let nullable = false;

  for (const row of rows) {
    const value = row[name];
    if (value === null || value === undefined) {
      nullable = true;
      continue;
    }
    type = widen(type, typeOf(value));
  }

  return {
    type,
    nullable,
    // The same rule the engine applies, for the same reason: a keyset page ordered by a
    // column that holds NULL loses the rows that hold no value, without saying so.
    sortable: !nullable && type !== "text[]" && type !== "unknown",
    // `is null` on every column that some row leaves empty — the same rule the engine's own
    // definition applies. Without it a filter asking "which ones have no producer" is dropped
    // as an unsupported operator, and the answer silently widens.
    ops: [
      ...(OPERATORS_BY_TYPE[type] ?? []),
      ...(nullable ? (["is null"] as Operator[]) : []),
    ],
    kind: "scalar",
  };
}

function typeOf(value: unknown): FieldType {
  if (Array.isArray(value)) return "text[]";
  if (value instanceof Date) return "datetime";
  switch (typeof value) {
    case "boolean":
      return "boolean";
    case "number":
      return Number.isInteger(value) ? "integer" : "number";
    case "string":
      return isInstant(value) ? "datetime" : "text";
    default:
      return "unknown";
  }
}

/**
 * The type that holds both of two readings of the same column.
 *
 * A column of whole numbers that turns out to carry a decimal is a number; anything else that
 * disagrees is read as text, which is the type every value can be written in.
 */
function widen(mine: FieldType, theirs: FieldType): FieldType {
  if (mine === "unknown") return theirs;
  if (mine === theirs) return mine;
  if (
    (mine === "integer" && theirs === "number") ||
    (mine === "number" && theirs === "integer")
  ) {
    return "number";
  }
  return "text";
}
