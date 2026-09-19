import type {
  AnyRecord,
  Fields,
  Measure,
  MeasureFunction,
} from "@sincpro/criteria/criteria/grammar";
import { InvalidCriteria, MEASURE_FUNCTIONS } from "@sincpro/criteria/criteria/grammar";

/**
 * The five numbers a group can answer.
 *
 * A namespace and not five loose exports because `sum`, `min`, `max` and `count` are names
 * every codebase already has: `measure.` says whose they are, and offers the five as soon as
 * the dot is typed.
 */
export const measure = {
  /** Every value added up. */
  sum<T = AnyRecord>(field: NoInfer<Fields<T>>): Measure<T> {
    return { function: "sum", field };
  },

  /** The mean of the values that are there — an empty one is left out, not counted as zero. */
  avg<T = AnyRecord>(field: NoInfer<Fields<T>>): Measure<T> {
    return { function: "avg", field };
  },

  /** The smallest value. */
  min<T = AnyRecord>(field: NoInfer<Fields<T>>): Measure<T> {
    return { function: "min", field };
  },

  /** The largest value. */
  max<T = AnyRecord>(field: NoInfer<Fields<T>>): Measure<T> {
    return { function: "max", field };
  },

  /**
   * How many DIFFERENT values this field holds — "how many customers", not how many rows.
   *
   * @example
   * measure.countDistinct("partner_id")
   */
  countDistinct<T = AnyRecord>(field: NoInfer<Fields<T>>): Measure<T> {
    return { function: "count_distinct", field };
  },

  /**
   * The value at a fraction of the sorted values, interpolating between the two it falls
   * between — what a database calls `percentile_cont`.
   *
   * **Not every engine computes it**: SQLite has no percentile, and the repository refuses it
   * by name rather than letting it reach the database. Over rows in hand it always works.
   *
   * @param fraction - between 0 and 1: `0.95` is a P95
   */
  percentile<T = AnyRecord>(field: NoInfer<Fields<T>>, fraction: number): Measure<T> {
    return { function: "percentile", field, argument: fraction };
  },

  /** The middle value. The same as {@link measure.percentile} at `0.5`, said shorter. */
  median<T = AnyRecord>(field: NoInfer<Fields<T>>): Measure<T> {
    return { function: "percentile", field, argument: 0.5 };
  },

  /**
   * How many rows hold a value in this field.
   *
   * Not how many rows the group has — every bucket answers that as `count` without being
   * asked. This one counts the rows where the field is not empty, which is the question "how
   * many of these have a producer".
   */
  count<T = AnyRecord>(field: NoInfer<Fields<T>>): Measure<T> {
    return { function: "count", field };
  },
} as const;

/**
 * A measure as it may be written: the object, or the pair a hand-written JSON carries.
 *
 * @throws {InvalidCriteria} when it is neither.
 */
export function readMeasure<T = AnyRecord>(written: unknown): Measure<T> {
  if (Array.isArray(written)) {
    const [asked, field] = written as [unknown, unknown];
    if (typeof asked !== "string" || typeof field !== "string" || !isMeasureFunction(asked)) {
      throw new InvalidCriteria(
        `a measure is written {function, field}, or as the pair ["sum", "row_count"]; got ${JSON.stringify(written)}`,
      );
    }
    return { function: asked, field: field as Fields<T> };
  }

  const one = written as { function?: unknown; field?: unknown } | null;
  if (one === null || typeof one !== "object" || typeof one.field !== "string") {
    throw new InvalidCriteria(
      `a measure is written {function, field}; got ${JSON.stringify(written)}`,
    );
  }
  if (typeof one.function !== "string" || !isMeasureFunction(one.function)) {
    throw new InvalidCriteria(
      `'${String(one.function)}' is not a measure; use one of ${MEASURE_FUNCTIONS.join(", ")}`,
    );
  }

  const argument = (one as { argument?: unknown }).argument;
  if (one.function === "percentile") {
    if (typeof argument !== "number" || !(argument > 0 && argument < 1)) {
      throw new InvalidCriteria(
        "a percentile is cut at a fraction between 0 and 1, e.g. 0.5 for the median; got " +
          JSON.stringify(argument),
      );
    }
    return { function: one.function, field: one.field as Fields<T>, argument };
  }
  if (argument !== undefined) {
    throw new InvalidCriteria(`'${one.function}' takes no argument`);
  }
  return { function: one.function, field: one.field as Fields<T> };
}

/** Whether a string is one of the five functions the engine computes. */
export function isMeasureFunction(written: string): written is MeasureFunction {
  return (MEASURE_FUNCTIONS as readonly string[]).includes(written);
}
