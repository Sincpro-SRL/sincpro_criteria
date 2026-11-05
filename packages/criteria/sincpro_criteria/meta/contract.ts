import type { Expression, Operator } from "@sincpro/criteria/criteria/grammar";
import type { Formula } from "@sincpro/criteria/engine/formula";
import type { FieldKind, FieldMeta, FieldType, Meta } from "@sincpro/criteria/meta/meta";
import { FIELD_TYPES } from "@sincpro/criteria/meta/meta";

/**
 * What the framework says of a property beyond JSON Schema: the `x-sincpro` object of each
 * property of a published contract. Every key but `type` is left out when it says nothing.
 */
export interface PropertyVocabulary {
  type: FieldType;
  widget?: string;
  label?: Record<string, string>;
  help?: Record<string, string>;
  readonly?: boolean;
  default?: unknown;
  readonly_when?: Expression;
  required_when?: Expression;
  visible_when?: Expression;
  total?: string;
  sortable?: boolean;
  groupable?: boolean;
  aggregates?: string[];
  ops?: Operator[];
  computed?: boolean;
  owner?: string;
  choice_labels?: Record<string, Record<string, string>>;
  exact?: boolean;
  relation?: string;
  many?: boolean;
  identified_by?: string;
  parent_field?: string;
  related_field?: string;
  navigable?: boolean;
  holds?: Expression;
  computes?: Formula;
  affects?: string[];
  judged_by?: string[];
}

/** What the framework says of an entity beyond JSON Schema: the schema's own `x-sincpro`. */
export interface EntityVocabulary {
  entity: string;
  identity?: string;
  get_id?: string;
  display?: string;
  default_order?: string;
  search?: Record<string, unknown>;
  detail?: Record<string, unknown>;
  title?: Record<string, string>;
  version?: string;
}

/** One property of a contract: JSON Schema, with the vocabulary under `x-sincpro`. */
export interface ContractProperty {
  type?: string | string[];
  format?: string;
  enum?: unknown[];
  anyOf?: ContractProperty[];
  items?: ContractProperty | Contract;
  $ref?: string;
  title?: string;
  properties?: Record<string, ContractProperty>;
  "x-sincpro"?: PropertyVocabulary;
  [keyword: string]: unknown;
}

/**
 * The published contract of an entity — JSON Schema 2020-12 with one `x-sincpro` per schema
 * and per property — as a bounded context's discovery document carries it: OpenAPI's
 * `components.schemas`, OpenRPC's, MCP's, or the file `export_metamodel` writes.
 */
export interface Contract {
  type: "object";
  title?: string;
  properties: Record<string, ContractProperty>;
  required?: string[];
  "x-sincpro"?: EntityVocabulary;
  $defs?: Record<string, Contract>;
}

const RELATIONAL: ReadonlySet<FieldType> = new Set<FieldType>([
  "many2one",
  "one2many",
  "many2many",
]);

/**
 * The schema of an embedded value: the property itself, its items, or the non-null branch —
 * written in place, or a `$ref` to the shape the contract names once under `$defs`, by its
 * class (`#/$defs/OrderLine`), looked up in `shapes`.
 */
function shapeOf(
  property: ContractProperty,
  shapes: Readonly<Record<string, Contract>>,
): Contract | undefined {
  const held = property.anyOf?.find((one) => one.type !== "null") ?? property;
  const shape = (held.type === "array" ? held.items : held) as ContractProperty | undefined;
  const pointed =
    typeof shape?.$ref === "string" ? shapes[shape.$ref.split("/").pop() ?? ""] : shape;
  return pointed?.properties === undefined ? undefined : (pointed as unknown as Contract);
}

/** The choices of a property, wherever JSON Schema wrote them: on it or in its non-null branch. */
function enumOf(property: ContractProperty): unknown[] | undefined {
  return property.enum ?? property.anyOf?.find((one) => one.enum !== undefined)?.enum;
}

/** One field of the definition, out of one property of the contract and its vocabulary; a
 * relation's definition is the contract of what it points at, when `related` holds it; an
 * embedded value's, the shape it holds — in place, or named in `shapes`. */
function fieldOf(
  property: ContractProperty,
  required: boolean,
  related: Readonly<Record<string, Contract>>,
  shapes: Readonly<Record<string, Contract>>,
): FieldMeta {
  const said = property["x-sincpro"] ?? ({ type: "unknown" } as PropertyVocabulary);
  const type: FieldType = FIELD_TYPES.includes(said.type) ? said.type : "unknown";
  const kind: FieldKind =
    type === "embedded" ? "embedded" : RELATIONAL.has(type) ? "relation" : "scalar";
  const shape = type === "embedded" ? shapeOf(property, shapes) : undefined;
  const choices = enumOf(property);
  const field: FieldMeta = {
    ...said,
    type,
    kind,
    nullable: property.anyOf?.some((one) => one.type === "null") ?? false,
    sortable: said.sortable ?? false,
    ops: said.ops ?? [],
    required: required || undefined,
  };
  if (choices !== undefined) field.choices = choices;
  if (shape !== undefined) field.definition = metaFromContract(shape, related, shapes);
  const pointed = kind === "relation" && said.relation ? related[said.relation] : undefined;
  if (pointed?.properties !== undefined) field.definition = metaFromContract(pointed);
  if (field.required === undefined) delete field.required;
  return field;
}

/**
 * The definition of a model — the `Meta` the engine, `validate`, `matches` and a form read —
 * out of the contract the bounded context published for it.
 *
 * The description is published once, in the discovery document; an answer says only which
 * version of it it is (`model_version`). Read it here once and hand it to the source
 * (`restSource(url, { meta })`), and every page carries it.
 *
 * With `related` — the document's other schemas, by name — a relation is described by the
 * contract of what it points at (`definition`), one level deep: what a line editor and a
 * many2one's display are built from.
 *
 * A value the record holds inside (`embedded`) is described by its shape, written in place or
 * named once by its class under the contract's `$defs` (`#/$defs/OrderLine`) — found there,
 * or among `related`; `shapes` is what a nested shape reads its own by, and a caller leaves it.
 *
 * @example
 * const document = await (await fetch("/openapi.json")).json();
 * const sales = metaFromContract(document.components.schemas.Sale);
 * sales.fields.total.widget;          // "decimal"
 * sales.fields.lines.affects;         // ["total"]
 */
export function metaFromContract(
  contract: Contract,
  related: Readonly<Record<string, Contract>> = {},
  shapes: Readonly<Record<string, Contract>> = { ...related, ...(contract.$defs ?? {}) },
): Meta {
  const entity = contract["x-sincpro"];
  const required = new Set(contract.required ?? []);
  const fields: Record<string, FieldMeta> = {};
  for (const [name, property] of Object.entries(contract.properties)) {
    fields[name] = fieldOf(property, required.has(name), related, shapes);
  }
  const meta: Meta = {
    aggregate: entity?.entity ?? contract.title ?? "",
    identity: entity?.identity ?? "",
    default_order: entity?.default_order ?? "",
    fields,
  };
  if (entity?.title !== undefined) meta.name = entity.title;
  if (entity?.display !== undefined) meta.display = entity.display;
  if (entity?.get_id !== undefined) meta.get_id = entity.get_id;
  if (entity?.search !== undefined) meta.search = entity.search;
  if (entity?.detail !== undefined) meta.detail = entity.detail;
  return meta;
}

/** The version of the model a contract describes — what a page's `version` is compared with. */
export function versionOf(contract: Contract): string | null {
  return contract["x-sincpro"]?.version ?? null;
}
