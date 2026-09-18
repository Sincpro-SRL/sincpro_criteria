/**
 * What a caller is told about a model, and everything only the model can answer.
 *
 * It travels as `model_meta_data` in every answer unless the criteria said `meta: false`, so
 * a client builds its filter form, its column menu and its next request from the previous
 * answer. **A client never carries a schema of its own, and can never ask for a field it was
 * not shown.**
 *
 * This is the shape of Odoo's `fields_get`, and the helpers here answer *what may be asked*.
 * How it looks — column widths, alignment, which chip — belongs to whoever draws it.
 *
 * @module
 */

import { any, like } from "@sincpro/criteria/criteria/expression";
import type { AnyRecord, Expression, Operator } from "@sincpro/criteria/criteria/grammar";

/** The logical type of a field: the full vocabulary the engine publishes. */
export const FIELD_TYPES = [
  "text",
  "integer",
  "number",
  "boolean",
  "date",
  "datetime",
  "text[]",
  "translated",
  "embedded",
  "many2one",
  "one2many",
  "many2many",
  "unknown",
] as const;

export type FieldType = (typeof FIELD_TYPES)[number];

/**
 * The coarse answer to "what is this name", before the finer `type`: a value in the row, a
 * value object inside the row, or another aggregate that has to be brought.
 */
export type FieldKind = "scalar" | "embedded" | "relation";

/** The three types that point at another aggregate with a life of its own. */
const RELATIONAL_TYPES: ReadonlySet<FieldType> = new Set<FieldType>([
  "many2one",
  "one2many",
  "many2many",
]);

/** Every word a screen shows for a model and its fields, always `{default, ...languages}`. */
export interface Translated {
  name: Record<string, string>;
  labels: Record<string, Record<string, string>>;
  help?: Record<string, Record<string, string>>;
}

/**
 * What the model says about one of its fields.
 *
 * An empty `ops` is the single signal that this field is not filtered directly — it happens
 * for `embedded` and for the three relational types: a value object or a relation has no
 * comparison of its own, it has a SHAPE (`definition`) or a scalar key (`identified_by`)
 * that does.
 */
export interface FieldMeta {
  type: FieldType;
  nullable: boolean;

  /** The values an enum field may hold — what a select is built from. */
  choices?: unknown[];

  /**
   * False for every nullable column: a keyset comparison omits rows holding NULL, so
   * ordering by one loses rows from the pagination in silence.
   */
  sortable: boolean;

  /** Included although derivable from `type`, so a consumer never has to carry the table. */
  ops: Operator[];

  /** Several of them: a `one2many`, a `many2many`, or a list of embedded values. */
  many?: boolean;

  /** For a relational field, the aggregate on the other side, by name. */
  relation?: string | null;

  /**
   * For a relational field, the column that identifies the relation — this aggregate's own
   * column for a `many2one`, the related aggregate's for a `one2many`. A client filters by
   * it and never by the relational field itself.
   */
  identified_by?: string | null;

  /**
   * The shape of the other side: always for an embedded value, and for a relational field
   * once it was expanded, cut by the same mask.
   */
  definition?: Meta | null;

  /** The coarse answer to "what is this name", computed on the server. */
  kind: FieldKind;
}

/** What a caller is told about an aggregate: one map of fields, each saying which it is. */
export interface Meta {
  aggregate: string;
  identity: string;
  default_order: string;
  fields: Record<string, FieldMeta>;
  translations: Translated;
}

/**
 * Whether this field can be used in a `where`, an `order` or a `grouping.by` directly.
 *
 * `ops.length === 0` is the single signal: both an `embedded` and any of the three relational
 * types publish it, so there is no need to look at `kind` separately — a relational field is
 * filtered by its `identified_by`, which appears as its OWN scalar field on the model.
 */
export function isFilterable(field: FieldMeta): boolean {
  return field.ops.length > 0;
}

/**
 * Whether this field points at another aggregate. Never offered as the direct target of a
 * filter, an ordering or a grouping level: it is walked through `specification` and filtered
 * by its `identified_by`.
 */
export function isRelational(field: FieldMeta): boolean {
  return RELATIONAL_TYPES.has(field.type);
}

/** The operators this field takes, or none when it is not filtered directly. */
export function operatorsFor(meta: Meta, field: string): Operator[] {
  return meta.fields[field]?.ops ?? [];
}

/** The fields a filter may name, in the order the model declares them. */
export function fieldsThatFilter(meta: Meta): string[] {
  return Object.keys(meta.fields).filter((name) => isFilterable(meta.fields[name]!));
}

/**
 * The fields a page may be ordered by.
 *
 * A nullable column is not among them, and that is not a detail: a page ordered by one
 * silently drops the rows that hold no value.
 */
export function fieldsThatSort(meta: Meta): string[] {
  return Object.keys(meta.fields).filter((name) => meta.fields[name]!.sortable);
}

/**
 * The fields a grouping level may split by: the ones that can be asked about and do not
 * point at another aggregate.
 */
export function fieldsThatGroup(meta: Meta): string[] {
  return Object.keys(meta.fields).filter((name) => {
    const field = meta.fields[name]!;
    return isFilterable(field) && !isRelational(field);
  });
}

/**
 * The word a screen shows for a field, in the language it is showing.
 *
 * Falls back to the `default` the engine always sends, and to the field's own name when the
 * model said nothing — a column with no header is worse than a column headed `row_count`.
 *
 * @example
 * labelOf(meta, "row_count", "es"); // "Filas"
 */
export function labelOf(meta: Meta, field: string, locale?: string): string {
  const labels = meta.translations?.labels?.[field];
  if (labels === undefined) return field;
  return (locale ? labels[locale] : undefined) ?? labels.default ?? field;
}

/** The word a screen shows for the model itself. See {@link labelOf}. */
export function nameOf(meta: Meta, locale?: string): string {
  const name = meta.translations?.name;
  if (name === undefined) return meta.aggregate;
  return (locale ? name[locale] : undefined) ?? name.default ?? meta.aggregate;
}

/**
 * What a search box types into a filter: `like` over every text field the model says takes
 * it, OR'd together.
 *
 * The fields come from the definition and not from a list kept by hand, so a model that
 * grows a column is searchable by it the same day, and one that loses a column does not
 * start sending a condition nobody can answer.
 *
 * @param text - what the person typed; blank means no filter at all
 * @returns the expression, or `undefined` when there is nothing to search on
 *
 * @example
 * const q = base.where(searchOver(meta, typed));
 */
export function searchOver<T = AnyRecord>(
  meta: Meta,
  text: string,
): Expression<T> | undefined {
  const written = text.trim();
  if (written.length === 0) return undefined;
  const parts = Object.keys(meta.fields)
    .filter((name) => meta.fields[name]!.ops.includes("like"))
    .map((name) => like<T>(name as never, written));
  return any<T>(...parts);
}
