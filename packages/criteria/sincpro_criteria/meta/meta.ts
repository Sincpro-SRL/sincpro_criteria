import { isDynamic } from "@sincpro/criteria/criteria/dynamic";
import {
  isAll,
  isCondition,
  isNegate,
  readExpression,
} from "@sincpro/criteria/criteria/expression";
import { any } from "@sincpro/criteria/criteria/filter";
import type {
  AnyRecord,
  Criteria,
  Expression,
  Operator,
} from "@sincpro/criteria/criteria/grammar";
import { GRAINS, PERIODS, UNITS } from "@sincpro/criteria/criteria/grammar";

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
 * One dynamic value the server reads, so a filter builder offers «Today» and «This month» from
 * what the backend says and a value a project adds appears with no client release.
 */
export interface ResolverMeta {
  /** The name under `"$"`. */
  name: string;

  /** What it reads to: `date`, `datetime`, `range`, `field`, or `any` for what a key holds. */
  returns: string;

  /** Each parameter and its kind: `span`, `grain`, `period`, `integer`, `boolean`, `text`. */
  params: Record<string, string>;

  /** The values a parameter may take, when it takes only some. */
  choices: Record<string, readonly string[]>;
}

const SHIFT = { plus: "span", start_of: "grain" };
const SHIFT_CHOICES = { plus: [...UNITS], start_of: [...GRAINS] };

/**
 * The dynamic values the engine reads, as `Meta.resolvers` publishes them.
 *
 * Here for a client that has no definition from a server (rows in hand), and checked against
 * the one the engine publishes, so the two cannot say different things.
 */
export const RESOLVERS: readonly ResolverMeta[] = [
  { name: "today", returns: "date", params: SHIFT, choices: SHIFT_CHOICES },
  { name: "now", returns: "datetime", params: SHIFT, choices: SHIFT_CHOICES },
  {
    name: "period",
    returns: "range",
    params: {
      name: "period",
      unit: "grain",
      last: "integer",
      next: "integer",
      include_current: "boolean",
    },
    choices: { name: [...PERIODS], unit: [...GRAINS] },
  },
  {
    name: "context",
    returns: "any",
    params: { key: "text", ...SHIFT },
    choices: SHIFT_CHOICES,
  },
  {
    name: "param",
    returns: "any",
    params: { name: "text", ...SHIFT },
    choices: SHIFT_CHOICES,
  },
  { name: "field", returns: "field", params: { name: "text" }, choices: {} },
];

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

  /**
   * The values an enum field may hold, in the order the enum declares them — what a select is
   * built from. {@link choicesOf} pairs each with its word.
   */
  choices?: unknown[];

  /**
   * What each of `choices` is called, `{default, ...languages}`, keyed by the value as text —
   * JSON keys are always text, so `1` is under `"1"`. Only the values the enum named: one left
   * out has no word of its own, and {@link choiceLabelOf} shows the value itself.
   */
  choice_labels?: Record<string, Record<string, string>>;

  /**
   * The field's own name for a screen, `{default, ...languages}`. A field that declared none is
   * called what its enum calls itself, so a category named once is named the same everywhere;
   * empty when neither said anything. {@link labelOf} reads it.
   */
  label?: Record<string, string>;

  /** What the field is for, longer than the label, in the same `{default, ...}` shape. */
  help?: Record<string, string>;

  /**
   * Whether a grouping may split by this field (`groupable`), the functions it can be folded with
   * (`aggregates`), and whether it is computed by the server rather than a column — read-only,
   * and filtered, ordered and grouped like one. Absent means the server did not say.
   */
  groupable?: boolean;
  aggregates?: string[];
  computed?: boolean;

  /**
   * The module that adds this field to the entity, by class name (`"MoveDelivery"`); absent for a
   * field the entity has itself. A record that has no such extension holds nothing there, so the
   * server sends it nullable and not sortable: a screen can group the fields by owner, and show
   * the ones of a module the record lacks as empty. Nothing about filtering changes: it is
   * filtered like any other field.
   */
  owner?: string | null;

  /**
   * A decimal: its values travel as text so no digit is lost (`"10.50"`), and they compare as
   * numbers — `matches`, a sort and a cursor read them that way when handed this `meta`.
   */
  exact?: boolean;

  /**
   * Form hints: what a form starts from, never a rule — a component that says otherwise
   * wins, and the server accepts the write either way. `readonly`/`required` always;
   * `default` for a new record; each `*_when` while its condition holds over the record,
   * evaluated with `matches(record, condition, meta)`.
   */
  readonly?: boolean;
  required?: boolean;
  default?: unknown;
  readonly_when?: Expression | null;
  required_when?: Expression | null;
  visible_when?: Expression | null;

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
   * The field read on THIS side to match a relation, with {@link FieldMeta.related_field} the
   * one read on the other. The pair says outright what `identified_by` leaves to a
   * cardinality convention.
   */
  parent_field?: string | null;

  /** The field read on the OTHER side of a relation — see {@link FieldMeta.parent_field}. */
  related_field?: string | null;

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

  /**
   * The aggregate's own name for a screen, `{default, ...languages}`: what the engine sends.
   * {@link nameOf} reads it.
   */
  name?: Record<string, string>;

  /**
   * The field shown beside the identity — what a select and a many2one show. Empty when the
   * entity names none.
   */
  display?: string;

  /**
   * The field a single record is fetched by — the identity, unless the entity names a natural
   * key (`number`, `code`). Empty for a value object.
   */
  get_id?: string;

  /**
   * How a typed text finds a record, as the entity declared it: a criteria as the engine writes
   * it, whose `where` holds `dynamic.param("text")` where the text goes. `null` when the entity
   * searches nothing. {@link searchOver} and {@link matching} fill it.
   */
  search?: Record<string, unknown> | null;

  /**
   * What a read of one record brings when it asks for the detail: a criteria as the engine
   * writes it, nulls included. Read it with `readCriteria(meta.detail)` before merging or
   * sending it.
   */
  detail?: Record<string, unknown> | null;

  /**
   * The dynamic values a condition's value may be (`today`, `context`, …): what a filter
   * builder offers beside a literal.
   */
  resolvers?: ResolverMeta[];

  /**
   * Every word a screen shows, gathered in one object. Built by {@link describeRows} for rows
   * in hand; the engine sends `name` and each field's `label`/`help` instead, and the label
   * helpers read both.
   */
  translations?: Translated;
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

/**
 * Every function below takes `meta` as `Meta | null | undefined`, not just `Meta`, on
 * purpose: `reading.meta` genuinely is `null` before the first page arrives, an older backend
 * may never send `entity_meta_data` at all, and `criteria.meta: false` turns it off by choice.
 * None of that is a bug in the caller — a screen built against a definition that has not
 * arrived yet is the normal first render, not an exception. Every function here answers the
 * same way {@link operatorsFor} already answered a field the definition never mentioned: an
 * empty, safe default, never a throw. This is the same law as {@link isFilterable}'s
 * `ops.length === 0` — dropped and reported by an empty result, never thrown.
 */

/** The operators this field takes, or none when it is not filtered directly. */
export function operatorsFor(meta: Meta | null | undefined, field: string): Operator[] {
  return meta?.fields[field]?.ops ?? [];
}

/** The fields a filter may name, in the order the model declares them. */
export function fieldsThatFilter(meta: Meta | null | undefined): string[] {
  if (meta == null) return [];
  return Object.keys(meta.fields).filter((name) => isFilterable(meta.fields[name]!));
}

/**
 * The fields a page may be ordered by.
 *
 * A nullable column is not among them, and that is not a detail: a page ordered by one
 * silently drops the rows that hold no value.
 */
export function fieldsThatSort(meta: Meta | null | undefined): string[] {
  if (meta == null) return [];
  return Object.keys(meta.fields).filter((name) => meta.fields[name]!.sortable);
}

/**
 * The fields a grouping level may split by: the ones that can be asked about and do not
 * point at another aggregate.
 */
export function fieldsThatGroup(meta: Meta | null | undefined): string[] {
  if (meta == null) return [];
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
 * With no `meta` at all, the field's own name is the only word there is to show.
 *
 * @example
 * labelOf(meta, "row_count", "es"); // "Filas"
 */
export function labelOf(
  meta: Meta | null | undefined,
  field: string,
  locale?: string,
): string {
  const gathered = meta?.translations?.labels?.[field];
  const declared = meta?.fields[field]?.label;
  const labels =
    gathered ?? (declared && Object.keys(declared).length > 0 ? declared : undefined);
  if (labels === undefined) return field;
  return (locale ? labels[locale] : undefined) ?? labels.default ?? field;
}

/**
 * The word a screen shows for the model itself. See {@link labelOf}.
 *
 * With no `meta` at all there is no aggregate name to fall back to either — this answers `""`,
 * which is itself the visible signal that the definition has not arrived, not a crash.
 */
export function nameOf(meta: Meta | null | undefined, locale?: string): string {
  if (meta == null) return "";
  const name = meta.translations?.name ?? meta.name;
  if (name === undefined) return meta.aggregate;
  return (locale ? name[locale] : undefined) ?? name.default ?? meta.aggregate;
}

/**
 * The word a screen shows for one value of an enum field, in the language it is showing.
 *
 * Falls back to the `default` the engine sends, and to the value itself when the enum gave it
 * no word — a badge that says `medium` is better than an empty one. The value is looked up as
 * text, the way it travelled as a key.
 *
 * @example
 * // meta.fields.priority.choice_labels = {high: {default: "High", es: "Alta"}}
 * choiceLabelOf(meta, "priority", "high", "es"); // "Alta"
 * choiceLabelOf(meta, "priority", "high", "fr"); // "High"   — no French, the default
 * choiceLabelOf(meta, "priority", "medium", "es"); // "medium" — the enum named it nothing
 */
export function choiceLabelOf(
  meta: Meta | null | undefined,
  field: string,
  value: unknown,
  locale?: string,
): string {
  const key = String(value);
  const labels = meta?.fields[field]?.choice_labels?.[key];
  if (labels === undefined) return key;
  return (locale ? labels[locale] : undefined) ?? labels.default ?? key;
}

/**
 * The options of a select over an enum field: each value it may hold with its word, in the
 * order the enum declares them. Empty for a field that is not an enum, or a definition that
 * has not arrived.
 *
 * The value is kept as the engine sent it — a number stays a number — so the option chosen is
 * what goes into the condition, untouched.
 *
 * @example
 * // simple: a select of priorities, in Spanish
 * choicesOf(meta, "priority", "es");
 * // [{value: "high", label: "Alta"}, {value: "medium", label: "medium"}, {value: "low", label: "Baja"}]
 *
 * @example
 * // medium: the options feed a filter, and a chip reads the condition back
 * const options = choicesOf(meta, "priority", "es");
 * const q = criteria<Ticket>().where(["priority", "in", options.slice(0, 2).map((o) => o.value)]);
 * choiceLabelOf(meta, "priority", "high", "es"); // "Alta" — what the chip shows
 */
export function choicesOf(
  meta: Meta | null | undefined,
  field: string,
  locale?: string,
): { value: unknown; label: string }[] {
  const choices = meta?.fields[field]?.choices ?? [];
  return choices.map((value) => ({
    value,
    label: choiceLabelOf(meta, field, value, locale),
  }));
}

/**
 * What a search box types into a filter.
 *
 * When the entity declared how a text finds it (`meta.search`), that template, with the text
 * where it goes — `code starts with` and `name like`, or whatever the backend chose, and what
 * it asks besides (`active = true`). Otherwise `like` over every text field the model says
 * takes it, OR'd together: the fields come from the definition and not from a list kept by
 * hand, so a model that grows a column is searchable by it the same day.
 *
 * With no `meta` at all there is nothing to search over yet, so this answers `undefined` —
 * the same "no filter" a blank box already answers — rather than throwing on a screen that is
 * still waiting for its first page.
 *
 * @param text - what the person typed; blank means no filter at all
 * @returns the expression, or `undefined` when there is nothing to search on
 *
 * @example
 * // meta.search.where = {any: [number starts with TEXT, title like TEXT]}
 * searchOver(meta, "F-1");
 * // {any: [{field: "number", operator: "starts with", value: "F-1"},
 * //        {field: "title", operator: "like", value: "F-1"}]}
 *
 * @example
 * const q = base.where(searchOver(meta, typed));
 */
export function searchOver<T = AnyRecord>(
  meta: Meta | null | undefined,
  text: string,
): Expression<T> | undefined {
  if (meta == null) return undefined;
  const written = text.trim();
  if (written.length === 0) return undefined;
  const template = searchTemplateOf(meta);
  if (template !== undefined) return withText(template, written) as Expression<T> | undefined;
  const parts = Object.keys(meta.fields)
    .filter((name) => meta.fields[name]!.ops.includes("like"))
    .map((name) => ({ field: name, operator: "like" as const, value: written }));
  return any<T>(...(parts as Expression<T>[]));
}

/** How many references a select lists for a typed text — the engine's `NAME_SEARCH_LIMIT`. */
export const MATCHING_LIMIT = 8;

/**
 * The reading a select (a many2one, an autocomplete) sends for what was typed: the entity's
 * search template filled with it, a short page, each record as a reference — its identity and
 * its display field. The same criteria the engine's own `matching` builds, so a select over
 * REST, RPC or rows in hand finds what the backend's select would.
 *
 * Unlike {@link searchOver}, a blank text still asks what the template asks besides the text,
 * and an entity that searches nothing (`search: null`) finds nothing for a typed text: an
 * empty page, never every record. A definition that does not say (`search` absent — one
 * {@link describeRows} read off rows in hand, an older backend) searches as `searchOver` does.
 *
 * @example
 * // simple: what a select sends as the person types
 * await tickets.page(matching(meta, "F-1"));
 * // {where: {any: [...]}, pagination: {limit: 8}, specification: {}}
 *
 * @example
 * // medium: the options of the select, labelled by the entity's display field
 * const page = await tickets.page(matching(meta, typed));
 * const options = page.rows.map((row) => ({ id: row[meta.identity], label: row[meta.display!] }));
 */
export function matching<T = AnyRecord>(
  meta: Meta | null | undefined,
  text: string,
): Criteria<T> {
  const written = text.trim();
  const reference: Criteria<T> = { specification: {}, pagination: { limit: MATCHING_LIMIT } };
  const template = meta == null ? undefined : searchTemplateOf(meta);
  const where =
    template !== undefined
      ? (withText(template, written) as Expression<T> | undefined)
      : meta?.search === undefined
        ? searchOver<T>(meta, written)
        : undefined;
  if (where !== undefined) return { ...reference, where };
  // Nothing to search by, yet something was typed: an empty page, never every record.
  return written.length === 0 ? reference : { ...reference, pagination: { limit: 0 } };
}

/** The `where` of the entity's search template, read; `undefined` when it declared none. */
function searchTemplateOf(meta: Meta): Expression | undefined {
  const where = meta.search?.where;
  return where === undefined || where === null ? undefined : readExpression(where);
}

/** Whether a value is the placeholder a search template holds where the text goes. */
function isTextPlaceholder(value: unknown): boolean {
  if (!isDynamic(value) || value.$ !== "param" || value.name !== "text") return false;
  // `param("text", {plus: …})` is another value: only the bare placeholder is the text.
  return Object.entries(value).every(
    ([key, one]) => key === "$" || key === "name" || one == null,
  );
}

/**
 * A search template's filter with the text in place of every placeholder — the whole value, or
 * each placeholder of a list. A condition holding one is dropped when there is no text, and a
 * group left with nothing goes with it: the engine's `with_text`, leaf for leaf.
 */
function withText(expression: Expression, text: string): Expression | undefined {
  if (isCondition(expression)) {
    const { value } = expression;
    const holds = Array.isArray(value)
      ? value.some(isTextPlaceholder)
      : isTextPlaceholder(value);
    if (!holds) return expression;
    if (text.length === 0) return undefined;
    return {
      ...expression,
      value: Array.isArray(value)
        ? value.map((one) => (isTextPlaceholder(one) ? text : one))
        : text,
    };
  }
  if (isNegate(expression)) {
    const inner = withText(expression.negate, text);
    return inner === undefined ? undefined : { negate: inner };
  }
  const grouped = isAll(expression) ? expression.all : expression.any;
  const parts = grouped
    .map((part) => withText(part, text))
    .filter((part): part is Expression => part !== undefined);
  if (parts.length === 0) return undefined;
  if (parts.length === 1) return parts[0];
  return isAll(expression) ? { all: parts } : { any: parts };
}
