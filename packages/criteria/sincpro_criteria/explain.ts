import type { CriteriaLike } from "@sincpro/criteria/criteria/builder";
import { plain } from "@sincpro/criteria/criteria/builder";
import { isDynamic } from "@sincpro/criteria/criteria/dynamic";
import { isAll, isAny, isCondition } from "@sincpro/criteria/criteria/expression";
import type { Filter } from "@sincpro/criteria/criteria/filter";
import { readFilter } from "@sincpro/criteria/criteria/filter";
import type {
  AnyRecord,
  Dynamic,
  Expression,
  Span,
  Value,
} from "@sincpro/criteria/criteria/grammar";
import { UNITS } from "@sincpro/criteria/criteria/grammar";
import { formatOrder } from "@sincpro/criteria/criteria/order";
import type { Meta } from "@sincpro/criteria/meta/meta";
import { labelOf, nameOf } from "@sincpro/criteria/meta/meta";

/** How to word the sentence. */
export interface ExplainOptions {
  /** The definition that came back with the answer; without it, field names are used. */
  meta?: Meta;

  /** Which language to take the model's words in. */
  locale?: string;
}

/**
 * The criteria, in words.
 *
 * @example
 * explain(q, { meta });
 * // "Datasets where Encoding = \"utf-8\" and Rows > 1000, by Registered ↓, 100 per page"
 *
 * @example
 * explain(criteria().groupBy("encoding").measures({ rows: measure.sum("row_count") }));
 * // "grouped by encoding, measuring rows"
 */
export function explain<T = AnyRecord>(
  written: CriteriaLike<T>,
  options: ExplainOptions = {},
): string {
  const criteria = plain(written);
  const { meta, locale } = options;
  const parts: string[] = [];

  if (meta !== undefined) parts.push(nameOf(meta, locale));

  if (criteria.where !== undefined) {
    parts.push(`where ${sentenceOf(criteria.where as Expression, options)}`);
  }

  if (criteria.order?.length) {
    const ordering = criteria.order
      .map((sort) => `${label(sort.field, options)} ${sort.descending ? "↓" : "↑"}`)
      .join(", ");
    parts.push(`by ${ordering}`);
  }

  const { limit, strategy } = criteria.pagination ?? {};
  if (limit !== undefined) parts.push(`${limit} per page`);
  if (strategy !== undefined && "rows" in strategy && strategy.rows > 0) {
    parts.push(`after ${strategy.rows} rows`);
  }
  if (strategy !== undefined && "token" in strategy && strategy.token !== null) {
    parts.push("continued");
  }

  const grouping = criteria.grouping;
  if (grouping?.group_by?.length) {
    const levels = grouping.group_by
      .map((level) =>
        level.grain
          ? `${label(level.field, options)} by ${level.grain}`
          : label(level.field, options),
      )
      .join(" then ");
    parts.push(`grouped by ${levels}`);
    const measures = Object.keys(grouping.measures ?? {});
    if (measures.length > 0) parts.push(`measuring ${measures.join(", ")}`);
    if (grouping.where_measures !== undefined) {
      parts.push(`keeping groups where ${sentenceOf(grouping.where_measures, {})}`);
    }
    if (grouping.order?.length) parts.push(`groups by ${formatOrder(grouping.order)}`);
  }

  const brought = Object.keys(criteria.specification ?? {});
  if (brought.length > 0) {
    parts.push(`bringing ${brought.map((name) => label(name, options)).join(", ")}`);
  }

  if (criteria.count === "exact") parts.push("counted exactly");
  if (criteria.count === "none") parts.push("not counted");

  return parts.length > 0 ? parts.join(", ") : "everything";
}

/**
 * One filter, or one condition of it, in words.
 *
 * This is what draws the chips of a saved reading: walk the leaves and render each one.
 *
 * @example
 * conditionsOf(saved.where).map((one) => explainFilter(one, { meta, locale: "es" }));
 * // ['Codificación = "utf-8"', "Filas > 1000"]
 */
export function explainFilter<T = AnyRecord>(
  filter: Filter<T>,
  options: ExplainOptions = {},
): string {
  return sentenceOf(readFilter(filter) as Expression, options);
}

/** One expression, in words. Parenthesised only where a group would otherwise be ambiguous. */
function sentenceOf(expression: Expression, options: ExplainOptions): string {
  if (isCondition(expression)) {
    const field = label(expression.field, options);
    if (expression.operator === "is null") {
      return expression.value === false ? `${field} is not empty` : `${field} is empty`;
    }
    return `${field} ${expression.operator} ${literal(expression.value, options)}`;
  }
  if (isAll(expression)) {
    return expression.all.map((part) => grouped(part, options)).join(" and ");
  }
  if (isAny(expression)) {
    return expression.any.map((part) => grouped(part, options)).join(" or ");
  }
  return `not ${grouped(expression.negate, options)}`;
}

function grouped(expression: Expression, options: ExplainOptions): string {
  const written = sentenceOf(expression, options);
  return isCondition(expression) ? written : `(${written})`;
}

function label(field: string, options: ExplainOptions): string {
  return options.meta === undefined ? field : labelOf(options.meta, field, options.locale);
}

/** An amount of one unit, said in the singular when it is one. */
function counted(amount: number, unit: string): string {
  return `${amount} ${Math.abs(amount) === 1 ? unit.slice(0, -1) : unit}`;
}

/** A move in words: «30 days ago», «in 2 weeks», or the signed amounts when they point both ways. */
function moveWords(plus: Span | undefined, base: string, fromNow: boolean): string {
  const amounts = UNITS.flatMap((unit) => {
    const amount = plus?.[unit];
    return amount === undefined || amount === 0 ? [] : [[unit, amount] as const];
  });
  if (amounts.length === 0) return base;
  const said = amounts.map(([unit, amount]) => counted(Math.abs(amount), unit)).join(", ");
  if (amounts.every(([, amount]) => amount < 0)) {
    return fromNow ? `${said} ago` : `${said} before ${base}`;
  }
  if (amounts.every(([, amount]) => amount > 0)) {
    return fromNow ? `in ${said}` : `${said} after ${base}`;
  }
  return `${base} ${amounts.map(([unit, amount]) => `${amount > 0 ? "+" : "-"}${counted(Math.abs(amount), unit)}`).join(" ")}`;
}

/** A dynamic value in words, the way a person would say it. */
function dynamicWords(value: Dynamic, options: ExplainOptions): string {
  switch (value.$) {
    case "today":
    case "now": {
      const said = moveWords(value.plus, value.$, true);
      return value.start_of === undefined ? said : `${said} (start of ${value.start_of})`;
    }
    case "context":
    case "param": {
      const base =
        value.$ === "context" ? `the context's ${value.key}` : `the parameter ${value.name}`;
      const said = moveWords(value.plus, base, false);
      return value.start_of === undefined ? said : `${said} (start of ${value.start_of})`;
    }
    case "period": {
      if ("name" in value) return value.name.replace(/_/g, " ");
      const whole = value.include_current ? " (the current one included)" : "";
      return value.last === undefined
        ? `the next ${counted(value.next as number, `${value.unit}s`)}${whole}`
        : `the last ${counted(value.last, `${value.unit}s`)}${whole}`;
    }
    case "field":
      return label(value.name, options);
  }
}

function literal(value: Value, options: ExplainOptions): string {
  if (value === null) return "nothing";
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value))
    return `[${value.map((one) => literal(one, options)).join(", ")}]`;
  if (isDynamic(value)) return dynamicWords(value, options);
  return typeof value === "string" ? `"${value}"` : String(value);
}
