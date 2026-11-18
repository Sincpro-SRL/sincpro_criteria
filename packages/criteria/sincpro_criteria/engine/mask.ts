import type { AnyRecord, Criteria, Specification } from "@sincpro/criteria/criteria/grammar";
import type { Meta } from "@sincpro/criteria/meta/meta";

/**
 * The names a specification brings besides the identity: what it names, or the display when it
 * names none — an empty specification is a reference (sincpro_framework's `Meta.masked`).
 */
function brought(specification: Specification, meta: Meta): string[] {
  const named = Object.keys(specification);
  return named.length === 0 && meta.display ? [meta.display] : named;
}

/**
 * One record as the wire hands it back under a specification (sincpro_framework's
 * `_flattened`, `entity_collection.py`).
 *
 *     masked(row, undefined, meta)        → the record whole: nothing was asked
 *     masked(row, {}, meta)               → { dataset_id, name }   a reference: identity, display
 *     masked(row, { encoding: {} }, meta) → { dataset_id, encoding }
 *
 * The identity always travels: a record whose id did not cannot be opened, refreshed or cached.
 * A field named but absent travels as `null`, as the server writes it.
 *
 * Context: the engine used to filter, order and page a reading and then hand every record back
 * whole, whatever its specification asked. A screen that read a reference (`matching`) and then
 * a field the reference does not carry passed against `memoryTransport` and drew nothing against
 * the real backend (sincpro_web_framework#48).
 *
 * 1. Nothing asked, or not a record: as it is.
 * 2. The identity, then each name the specification brings (`brought`).
 *    2.1 A node with a specification of its own over an embedded value is masked by the field's
 *        `definition`, in turn — each item of a list.
 *    2.2 A relation without a definition here goes as it came: the engine has no model of the
 *        other side, the same reason `validate` keeps its node unchecked.
 * Final: a new record holding only those fields, in that order.
 */
export function masked<T>(
  record: T,
  specification: Specification<T> | undefined,
  meta: Meta,
): T {
  if (specification === undefined || record === null || typeof record !== "object")
    return record;
  const source = record as AnyRecord;
  const nodes = specification as Readonly<Record<string, Criteria | undefined>>;
  const out: AnyRecord = meta.identity
    ? { [meta.identity]: source[meta.identity] ?? null }
    : {};
  for (const name of brought(specification as Specification, meta)) {
    const value = source[name] ?? null;
    const inner = nodes[name]?.specification;
    const definition = meta.fields[name]?.definition;
    out[name] =
      inner === undefined || definition === undefined || definition === null
        ? value
        : Array.isArray(value)
          ? value.map((one: unknown) => masked(one, inner, definition))
          : masked(value, inner, definition);
  }
  return out as T;
}
