/**
 * A criteria checked against the model that will answer it, before it is sent.
 *
 * The server already does this — it drops what it cannot answer and says so in `dropped`
 * rather than refusing the request, because a shared link outlives the schema it was written
 * against and a dropped filter always *widens* the result. This runs the same rules on this
 * side, one round trip earlier, so a screen can grey out a menu entry instead of finding out
 * afterwards.
 *
 * Two outcomes, and they are not the same:
 *
 * - **dropped** — the condition disappears and the read still runs. This is what the server
 *   does with an unknown field, an operator a type does not take, or a value that will not
 *   read.
 * - **refused** — the server rejects the whole request. Ordering by a column it will not
 *   page by is the one that matters: a page ordered by a nullable column silently loses the
 *   rows that hold no value, so the engine refuses instead of losing them.
 *
 * @module
 */

import type { CriteriaLike } from "@sincpro/criteria/criteria/builder";
import { plain } from "@sincpro/criteria/criteria/builder";
import { isAll, isAny, isCondition } from "@sincpro/criteria/criteria/expression";
import type {
  AnyRecord,
  Condition,
  Criteria,
  Expression,
  Operator,
  Value,
} from "@sincpro/criteria/criteria/grammar";
import { MULTI_VALUED } from "@sincpro/criteria/criteria/grammar";
import { isInstant } from "@sincpro/criteria/engine/temporal";
import type { FieldMeta, Meta } from "@sincpro/criteria/meta/meta";
import { isFilterable, isRelational } from "@sincpro/criteria/meta/meta";
import type { Dropped } from "@sincpro/criteria/page/page";

/** Something the server will reject outright, with the reason it will give. */
export interface Refusal {
  field: string;
  reason: "no_such_field" | "not_sortable" | "unknown_total";
  message: string;
}

/** What a model can answer of a criteria, and what it cannot. */
export interface Validation<T = AnyRecord> {
  /** The criteria as the engine will actually answer it, with values read into their types. */
  criteria: Criteria<T>;

  /**
   * Conditions and specification nodes that were removed, with the engine's own reasons.
   *
   * What falls inside an expanded relation is reported by its path — `runs.gone_field` —
   * because the same field name lives at several depths and "unknown_field: name" would not
   * say which one.
   */
  dropped: Dropped[];

  /** What would make the whole request fail. Empty means it is safe to send. */
  refused: Refusal[];
}

/**
 * Checks a criteria against a model definition.
 *
 * @param written - the criteria, as an object or a builder
 * @param meta - the definition that came back in `model_meta_data`
 *
 * @example
 * const { criteria, dropped, refused } = validate(q, answer.model_meta_data!);
 * if (refused.length === 0) await read(criteria);
 */
export function validate<T = AnyRecord>(written: CriteriaLike<T>, meta: Meta): Validation<T> {
  const criteria = plain(written);
  const dropped: Dropped[] = [];
  const refused: Refusal[] = [];
  const checked: Criteria<T> = { ...criteria };

  if (criteria.where !== undefined) {
    const pruned = prune(criteria.where as Expression, meta, dropped);
    if (pruned === undefined) delete checked.where;
    else checked.where = pruned as Expression<T>;
  }

  for (const sort of criteria.order ?? []) {
    const field = meta.fields[sort.field];
    if (field === undefined) {
      refused.push({
        field: sort.field,
        reason: "no_such_field",
        message: `'${sort.field}': no such field on ${meta.aggregate}`,
      });
    } else if (!field.sortable) {
      refused.push({
        field: sort.field,
        reason: "not_sortable",
        message:
          `cannot order by '${sort.field}': it is nullable, and a page ordered by a nullable ` +
          "column silently drops the rows that hold no value",
      });
    }
  }

  if (criteria.specification !== undefined) {
    const kept: Record<string, Criteria> = {};
    for (const [name, node] of Object.entries(criteria.specification) as [
      string,
      Criteria,
    ][]) {
      const field = meta.fields[name];
      if (field === undefined) {
        dropped.push({ field: name, reason: "unknown_field" });
        continue;
      }
      if (isRelational(field) && field.definition == null) {
        // The definition of the other side is not here, so its node cannot be checked any
        // further. The server decides whether the relation is expandable at all.
        kept[name] = node;
        continue;
      }
      if (field.definition === undefined || field.definition === null) {
        kept[name] = node;
        continue;
      }
      const inner = validate(node, field.definition);
      dropped.push(
        ...inner.dropped.map((one) => ({ ...one, field: `${name}.${one.field}` })),
      );
      refused.push(
        ...inner.refused.map((one) => ({ ...one, field: `${name}.${one.field}` })),
      );
      kept[name] = inner.criteria;
    }
    checked.specification = kept as Criteria<T>["specification"];
  }

  const levels = criteria.grouping?.by;
  if (levels !== undefined) {
    // A level that is dropped has to leave the criteria too, or `criteria` would not be what
    // its own name promises: the reading the engine is going to answer.
    const kept = levels.filter((level) => {
      const field = meta.fields[level.field];
      if (field === undefined) {
        dropped.push({ field: level.field, reason: "unknown_field" });
        return false;
      }
      if (!isFilterable(field) || isRelational(field)) {
        dropped.push({ field: level.field, reason: "unsupported_operator" });
        return false;
      }
      return true;
    });
    checked.grouping = { ...criteria.grouping, by: kept };
  }

  const totals = new Set([...Object.keys(criteria.grouping?.totals ?? {}), "count"]);
  for (const name of namesIn(criteria.grouping?.having)) {
    if (!totals.has(name)) {
      refused.push({
        field: name,
        reason: "unknown_total",
        message:
          `'${name}' is not one of this grouping's totals; 'having' reads ` +
          `${[...totals].join(", ")} — to filter rows use 'where'`,
      });
    }
  }

  return { criteria: checked, dropped, refused };
}

/**
 * The tree with every unusable leaf removed, collapsing whatever is left empty.
 *
 * A connective that loses all of its parts disappears rather than becoming empty — an empty
 * `all` matches everything and an empty `any` matches nothing, and neither was asked for.
 * Removing the node hands the decision to its parent.
 */
function prune(
  expression: Expression,
  meta: Meta,
  dropped: Dropped[],
): Expression | undefined {
  if (isCondition(expression)) {
    const kept = keep(expression, meta);
    if ("reason" in kept) {
      dropped.push({ field: expression.field, reason: kept.reason });
      return undefined;
    }
    return kept.condition;
  }
  if (isAll(expression)) {
    const parts = expression.all
      .map((part) => prune(part, meta, dropped))
      .filter((part): part is Expression => part !== undefined);
    return parts.length > 1 ? { all: parts } : parts[0];
  }
  if (isAny(expression)) {
    const parts = expression.any
      .map((part) => prune(part, meta, dropped))
      .filter((part): part is Expression => part !== undefined);
    return parts.length > 1 ? { any: parts } : parts[0];
  }
  const inner = prune(expression.negate, meta, dropped);
  return inner === undefined ? undefined : { negate: inner };
}

/** One condition, kept and read — or the reason it cannot be. */
function keep(
  condition: Condition,
  meta: Meta,
): { condition: Condition } | { reason: Dropped["reason"] } {
  const field = meta.fields[condition.field];
  if (field === undefined) return { reason: "unknown_field" };
  if (!field.ops.includes(condition.operator)) return { reason: "unsupported_operator" };

  const read = readValue(field, condition.operator, condition.value);
  if (read === undefined) return { reason: "bad_value" };
  return { condition: { ...condition, value: read } };
}

/**
 * The condition's value in the type its column compares against, or `undefined` when it will
 * not read.
 *
 * `is null` is the exception: its value is the question being asked, not the field's type. A
 * multi-valued operator reads every member, and `contains` asks about one member of a list,
 * so its value is a member's type.
 */
function readValue(field: FieldMeta, operator: Operator, value: Value): Value | undefined {
  if (operator === "is null") return readBoolean(value);

  if (operator === "between") {
    if (!Array.isArray(value) || value.length !== 2) return undefined;
    const bounds = value.map((one) => readScalar(field, one));
    return bounds.some((one) => one === undefined) ? undefined : (bounds as Value);
  }

  if (MULTI_VALUED.includes(operator)) {
    const members = Array.isArray(value) ? value : [value];
    const read = members.map((one) => readScalar(field, one));
    return read.some((one) => one === undefined) ? undefined : (read as Value);
  }

  return readScalar(field, value);
}

function readBoolean(value: Value): Value | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return undefined;
  return ["1", "true", "yes", "on", "t"].includes(value.toLowerCase());
}

/**
 * One value read into the field's type. Anything that is not a string is already read and
 * comes back untouched — which is how a `Date` survives.
 */
function readScalar(field: FieldMeta, value: Value): Value | undefined {
  if (typeof value !== "string") return value;
  switch (field.type) {
    case "integer": {
      // Blank first: `Number("")` is 0 and `Number(" ")` is 0, so an empty box in a filter
      // form would silently become "greater than zero" instead of being dropped.
      if (value.trim().length === 0) return undefined;
      const read = Number(value);
      return Number.isInteger(read) ? read : undefined;
    }
    case "number": {
      if (value.trim().length === 0) return undefined;
      const read = Number(value);
      return Number.isFinite(read) ? read : undefined;
    }
    case "boolean":
      return readBoolean(value);
    case "date":
    case "datetime":
      // Not `Date.parse`: it answers "utf-8" with a day in 2001, so a date field would accept
      // any text at all. See `engine/temporal.ts`.
      return isInstant(value) ? value : undefined;
    default:
      return value;
  }
}

/** The names a `having` filter reads, which must be totals of the grouping, or `count`. */
function namesIn(expression: Expression | undefined): string[] {
  if (expression === undefined) return [];
  if (isCondition(expression)) return [expression.field];
  if (isAll(expression)) return expression.all.flatMap(namesIn);
  if (isAny(expression)) return expression.any.flatMap(namesIn);
  return namesIn(expression.negate);
}
