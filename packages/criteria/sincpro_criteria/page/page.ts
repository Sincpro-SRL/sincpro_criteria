import type { AnyRecord, Criteria } from "@sincpro/criteria/criteria/grammar";
import type { Meta } from "@sincpro/criteria/meta/meta";

/**
 * How many match in total.
 *
 * `exact: false` means *at least* `value`: counting stops at a ceiling so its cost does not
 * grow with the table. A client renders that as `10000+`.
 */
export interface Count {
  value: number;
  exact: boolean;
}

/**
 * A condition that was asked for and could not be honoured.
 *
 * Reported rather than raised: a shared link outlives the schema it was written against, and
 * a dropped filter always *widens* the result — so it is dropped and said out loud.
 */
export interface Dropped {
  field: string;
  reason: DropReason;
}

/** Why a condition could not be honoured. The engine's own vocabulary. */
export type DropReason =
  "unknown_field" | "unsupported_operator" | "bad_value" | "not_expandable" | "not_navigable";

/**
 * One bucket: what its rows share, how many there are, and how to see them.
 *
 * `criteria` is the whole point. It is the reading that produced the grouping plus "and this
 * bucket's value", so opening the group is a plain read with it and nothing else — **no
 * client rebuilds a filter it did not write.**
 */
export interface Bucket<T = AnyRecord> {
  field: string;
  value: unknown;
  count: number;
  measures?: Record<string, unknown>;

  /**
   * The reading that opens this bucket, carrying the record type it is over — so opening one
   * is a read with it and the field names stay checked all the way down.
   */
  criteria: Criteria<T>;

  /**
   * The identities of this bucket's first page, in the criteria's order; empty unless the
   * criteria asked for a page. Ids and not records: light enough for thousands of buckets,
   * stable enough to select, compare and open later.
   */
  ids?: unknown[];

  /** Where the next page inside this bucket starts; `null` when there is none. */
  cursor?: string | null;

  /** The level below, when the grouping named one. Empty on the deepest level. */
  groups?: Bucket<T>[];

  /**
   * Whether `criteria` selects this group's rows. `false` for a group of a date PART («every
   * March»), which no filter on the date can say: its `criteria` is then its parent's.
   * Absent is open.
   */
  openable?: boolean;
}

/** One cell of a pivot. A margin is a cell with one axis empty; both empty is the grand total. */
export interface PivotCell {
  row: unknown[];
  column: unknown[];
  count: number;
  measures?: Record<string, unknown>;
}

/**
 * A table of groups crossed by groups.
 *
 * `rows` and `columns` hold every key that appeared, in order, so a client renders the grid
 * without scanning the cells; `cells` holds only the crossings that have rows, because a
 * pivot is mostly holes. The margins are folded in the database and not added up here: an
 * average of averages is not an average.
 */
export interface Pivot {
  rows: unknown[][];
  columns: unknown[][];
  cells: PivotCell[];
  row_margin?: PivotCell[];
  column_margin?: PivotCell[];
  total?: PivotCell;
}

/**
 * The fields every paginated answer carries besides its records.
 *
 * The envelope the engine's `ResponsePaginatedQuery` writes out. The records keep the
 * resource's own name — `datasets`, `runs`, `plans` — because a reader of the answer should
 * see what it is about, not `items`.
 *
 * This type is written by hand rather than generated for a concrete reason: the engine
 * serialises this envelope through a custom serializer, which is invisible to the JSON Schema
 * the OpenAPI document is built from — there it comes out as `{[key: string]: unknown}`. This
 * is the shape the server actually sends.
 */
export interface Envelope {
  /** Where the next page starts. `null` means there is no next one. */
  cursor: string | null;

  /** How many match in total, capped unless the criteria asked for the exact number. */
  count: Count | null;

  /**
   * The version of the model of the records — the fingerprint its published contract carries
   * (`x-sincpro.version`). What may be filtered, ordered and shown is described once, in the
   * bounded context's discovery document; another version means: load it again.
   */
  model_version: string;

  /** Conditions the model could not answer. */
  dropped: Dropped[];
}

/**
 * A paginated answer: the envelope plus the one field holding the records, under its own
 * name.
 *
 * @example
 * type ListDatasets = PaginatedResponse<"datasets", Dataset>;
 * const answer: ListDatasets = await read();
 * answer.datasets; answer.cursor; answer.model_version;
 */
export type PaginatedResponse<Field extends string, T> = { [K in Field]: T[] } & Envelope;

/**
 * A paginated answer with its records already taken out of the envelope.
 *
 * The one shape every source hands back and every reading holds. A grouped answer is a
 * `Page<Bucket>`: the engine answers buckets under a field name of their own — `groups` —
 * with the same envelope around them, so nothing here needs a second type for it.
 *
 * In the shared vocabulary a page is an `EntityCollection` — sincpro_framework's and
 * @sincpro/client-framework's word for records, how many there are and the cursor to go on —
 * read together with the definition of its model: `rows` are its `items`.
 */
export interface Page<T> {
  rows: T[];
  cursor: string | null;
  count: Count | null;
  /** The definition of the model: the one the engine answered over in memory, or the one the
   * source was given (`metaFromContract`); `null` when it was given none. */
  meta: Meta | null;
  dropped: Dropped[];
  /** The version of the model the server answered with; absent for a page built in memory. */
  version?: string | null;
}

/** An answer whose records field is not known in advance. */
export type AnyPaginatedResponse<T> = Envelope & Record<string, unknown | T[]>;

const ENVELOPE_FIELDS: ReadonlySet<string> = new Set([
  "cursor",
  "count",
  "model_version",
  "dropped",
  "missing",
]);

/**
 * The answer a server sent, as the page a reading holds.
 *
 * This is the whole job of a transport adapter: whatever it fetched, handed over in the one
 * shape everything else reads. The definition of the model is not in the answer — it is the
 * one the bounded context published, read once (`metaFromContract`) and given here.
 *
 * @example
 * const meta = metaFromContract(document.components.schemas.Dataset, document.components.schemas);
 * const source = { read: async (c) => pageFrom(await getJson("/datasets", { criteria: pack(c) }), meta) };
 */
export function pageFrom<T>(
  answer: Envelope & Record<string, unknown>,
  meta: Meta | null = null,
): Page<T> {
  return {
    rows: recordsOf<T>(answer),
    cursor: answer.cursor ?? null,
    count: answer.count ?? null,
    meta,
    dropped: answer.dropped ?? [],
    version: answer.model_version ?? null,
  };
}

/**
 * The records of an answer whose field name is not known here.
 *
 * The engine names that field after what the answer is about, and asks its own responses to
 * declare exactly one field of their own. This reads the answer the same way: the one key
 * that is not part of the envelope holds the records.
 *
 * @example
 * recordsOf<Dataset>(answer); // answer.datasets, without knowing it is called that
 */
export function recordsOf<T>(answer: Envelope & Record<string, unknown>): T[] {
  for (const [name, value] of Object.entries(answer)) {
    if (ENVELOPE_FIELDS.has(name)) continue;
    if (Array.isArray(value)) return value as T[];
    // The records held as a collection (`{items, count, cursor}`): its items.
    if (
      typeof value === "object" &&
      value !== null &&
      Array.isArray((value as { items?: unknown }).items)
    )
      return (value as { items: T[] }).items;
  }
  return [];
}
