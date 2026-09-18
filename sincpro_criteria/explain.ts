/**
 * A criteria as one line a person can read.
 *
 * Not decoration. A read that can be printed is a read that can be logged, diffed in a test,
 * shown in a "what am I looking at" bar and pasted into an issue. It is also what makes a
 * criteria legible to an agent that did not build it.
 *
 * With a model definition it uses the model's own words; without one it uses field names.
 *
 * @module
 */

import type { CriteriaLike } from "@sincpro/criteria/criteria/builder";
import { plain } from "@sincpro/criteria/criteria/builder";
import { isAll, isAny, isCondition } from "@sincpro/criteria/criteria/expression";
import type { AnyRecord, Expression, Value } from "@sincpro/criteria/criteria/grammar";
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
 * explain(criteria().by("encoding").totals({ rows: ["sum", "row_count"] }));
 * // "grouped by encoding, folding rows"
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
  if (grouping?.by?.length) {
    const levels = grouping.by
      .map((level) =>
        level.grain
          ? `${label(level.field, options)} by ${level.grain}`
          : label(level.field, options),
      )
      .join(" then ");
    parts.push(`grouped by ${levels}`);
    const totals = Object.keys(grouping.totals ?? {});
    if (totals.length > 0) parts.push(`folding ${totals.join(", ")}`);
    if (grouping.having !== undefined) {
      parts.push(`keeping groups where ${sentenceOf(grouping.having, {})}`);
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

/** One expression, in words. Parenthesised only where a group would otherwise be ambiguous. */
function sentenceOf(expression: Expression, options: ExplainOptions): string {
  if (isCondition(expression)) {
    const field = label(expression.field, options);
    if (expression.operator === "is null") {
      return expression.value === false ? `${field} is not empty` : `${field} is empty`;
    }
    return `${field} ${expression.operator} ${literal(expression.value)}`;
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

function literal(value: Value): string {
  if (value === null) return "nothing";
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return `[${value.map(literal).join(", ")}]`;
  return typeof value === "string" ? `"${value}"` : String(value);
}
