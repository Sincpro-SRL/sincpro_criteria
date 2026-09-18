/**
 * Writing a criteria.
 *
 * The builder is not another grammar: it is the same one, without writing the object by
 * hand. `criteria().where(eq("encoding", "utf-8")).limit(100).value` is exactly
 * `{where: {...}, pagination: {limit: 100}}`, and every function in this package takes
 * either form.
 *
 * Immutable: each method returns another builder. That is what lets a screen keep `base` and
 * derive `base.where(whatWasTyped)` on every keystroke without dragging the previous one
 * along.
 *
 * @module
 */

import { combined } from "@sincpro/criteria/criteria/expression";
import type {
  AnyRecord,
  CountMode,
  Criteria,
  Expression,
  Fields,
  Fold,
  Grouping,
  Level,
  Sort,
  Specification,
} from "@sincpro/criteria/criteria/grammar";
import { merge as mergeCriterias } from "@sincpro/criteria/criteria/merge";
import { parseOrder } from "@sincpro/criteria/criteria/order";

/** A criteria written either way. Everything public accepts this. */
export type CriteriaLike<T = AnyRecord> = Criteria<T> | CriteriaBuilder<T>;

/**
 * A criteria for this record, or one written without a record type at all.
 *
 * **This is what makes typing opt-in where the record type is already fixed by something
 * else.** A resource over `Dataset` knows its type, and `criteria()` — the one a caller
 * writes when it has no generated type to hang on — is a criteria over no record in
 * particular. Without this union those two do not fit together, because a criteria carries
 * its field names in its type and is therefore invariant in it.
 *
 * Nothing is lost: field names are checked where the criteria is BUILT, which is where the
 * mistake would be made.
 */
export type CriteriaFor<T> = CriteriaLike<T> | CriteriaLike;

/** The plain object, however it was written. */
export function plain<T = AnyRecord>(written: CriteriaFor<T>): Criteria<T> {
  // The cast is the union above being collapsed: a criteria over no record in particular is
  // read as one over this record, and its field names were checked when it was written.
  const value = written instanceof CriteriaBuilder ? written.value : written;
  return value as Criteria<T>;
}

/**
 * The door: `criteria<Dataset>()` to have it typed, `criteria()` when there is no type to
 * hang it on yet.
 *
 * @example
 * const q = criteria<Dataset>()
 *   .where(eq("encoding", "utf-8"), gt("row_count", 1000))
 *   .order("-registered_at")
 *   .limit(100);
 */
export function criteria<T = AnyRecord>(initial: Criteria<T> = {}): CriteriaBuilder<T> {
  return new CriteriaBuilder<T>(initial);
}

/** An immutable criteria under construction. Built through {@link criteria}. */
export class CriteriaBuilder<T = AnyRecord> {
  /**
   * The plain object.
   *
   * Frozen at the top level, so no method of this class can write to it and the builder
   * before a call keeps saying what it said. What it holds is not copied: a mask or a list of
   * levels handed in stays the caller's object, and mutating it afterwards reaches in here.
   * Hand over literals, or freeze your own.
   */
  readonly value: Criteria<T>;

  constructor(written: Criteria<T> = {}) {
    this.value = Object.freeze({ ...written });
  }

  /** What `JSON.stringify` writes out: the criteria, not the builder. */
  toJSON(): Criteria<T> {
    return this.value;
  }

  private with(part: Criteria<T>): CriteriaBuilder<T> {
    return new CriteriaBuilder<T>({ ...this.value, ...part });
  }

  /**
   * The filter. **Accumulates with AND** — `.where(a).where(b)` is `a` and `b` — so a screen
   * derives from a base without overwriting it. To start over, derive from the base again:
   * it is still whole, because this is immutable.
   */
  where(...parts: (Expression<T> | undefined)[]): CriteriaBuilder<T> {
    const where = combined<T>(this.value.where, ...parts);
    return this.with(where === undefined ? {} : { where });
  }

  /**
   * The ordering. **Replaces**: two orderings have no combination. Takes the line a URL
   * carries (`"-registered_at,name"`) or the objects. With no arguments, it drops it.
   */
  order(...entries: (string | Sort<T> | readonly Sort<T>[])[]): CriteriaBuilder<T> {
    const sorts = entries.flatMap((entry): Sort<T>[] => {
      if (typeof entry === "string") return parseOrder<T>(entry);
      if (Array.isArray(entry)) return [...(entry as readonly Sort<T>[])];
      return [entry as Sort<T>];
    });
    const next = { ...this.value };
    if (sorts.length === 0) delete next.order;
    else next.order = sorts;
    return new CriteriaBuilder<T>(next);
  }

  /** How many rows a page brings. */
  limit(rows: number): CriteriaBuilder<T> {
    return this.with({ pagination: { ...(this.value.pagination ?? {}), limit: rows } });
  }

  /** Where it goes on: the token that came back with the previous page. `null` is the first. */
  resumingFrom(token: string | null): CriteriaBuilder<T> {
    return this.with({
      pagination: { ...(this.value.pagination ?? {}), strategy: { token } },
    });
  }

  /**
   * The other strategy: counting rows from the start. It is what a grid jumping to page 7
   * needs, and it costs what it costs — the engine says so without dressing it up.
   */
  skipping(rows: number): CriteriaBuilder<T> {
    return this.with({
      pagination: { ...(this.value.pagination ?? {}), strategy: { rows } },
    });
  }

  /**
   * What to bring of each record: field → how to bring it. **Replaces**, because a mask is
   * one thing; to cross two criteria there is {@link CriteriaBuilder.merge}.
   */
  specification(mask: Specification<T>): CriteriaBuilder<T> {
    return this.with({ specification: mask });
  }

  /**
   * The grouping levels, **in order and accumulating**: `.by("encoding")` and then
   * `.by({field: "registered_at", grain: "month"})` are two levels.
   */
  by(...levels: (Fields<T> | Level<T>)[]): CriteriaBuilder<T> {
    const written = levels.map((level) =>
      typeof level === "string" ? ({ field: level } as Level<T>) : level,
    );
    return this.grouping({ by: [...(this.value.grouping?.by ?? []), ...written] });
  }

  /**
   * The numbers every bucket folds: `{rows: ["sum", "row_count"]}`. Added to the ones
   * already there.
   */
  totals(folds: Record<string, Fold<T>>): CriteriaBuilder<T> {
    return this.grouping({ totals: { ...(this.value.grouping?.totals ?? {}), ...folds } });
  }

  /**
   * The filter over what the buckets folded, not over the rows. The names it takes are the
   * ones in `totals` plus `"count"`.
   */
  having(expression: Expression | undefined): CriteriaBuilder<T> {
    return this.grouping(expression === undefined ? {} : { having: expression });
  }

  /**
   * The rest of the grouping — the order of the buckets, their page. Merged into what was
   * already there, so `.by()` and `.totals()` are not lost.
   */
  grouping(part: Grouping<T>): CriteriaBuilder<T> {
    return this.with({ grouping: { ...(this.value.grouping ?? {}), ...part } });
  }

  /** How much counting costs: `none`, `capped` (stops at a ceiling and says so), `exact`. */
  counting(mode: CountMode): CriteriaBuilder<T> {
    return this.with({ count: mode });
  }

  /**
   * Whether the answer carries the model definition. Turning it off is paid for in surprise:
   * a client that turns it off cannot build its filter form from what it received.
   */
  meta(travels: boolean): CriteriaBuilder<T> {
    return this.with({ meta: travels });
  }

  /**
   * This criteria plus a more specific one, under the engine's law.
   *
   * This is the typed way to merge: the builder knows its record type and passes it on. The
   * bare {@link merge} function cannot infer it from two plain objects, so it merges them
   * untyped unless it is given an explicit type argument.
   */
  merge(other: CriteriaLike<T>): CriteriaBuilder<T> {
    return new CriteriaBuilder<T>(mergeCriterias<T>(this.value, plain(other)));
  }
}
