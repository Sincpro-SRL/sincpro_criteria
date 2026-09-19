const ISO = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;

/**
 * The instant a value names, or `undefined` when it does not name one.
 *
 * @example
 * readInstant("2026-03-14T15:09:26Z"); // Date
 * readInstant("2026-03-14"); // Date
 * readInstant("utf-8"); // undefined — and NOT the 1st of August 2001
 */
export function readInstant(value: unknown): Date | undefined {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? undefined : value;
  if (typeof value !== "string" || !ISO.test(value)) return undefined;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : new Date(parsed);
}

/** Whether a value is written as an instant. See {@link readInstant}. */
export function isInstant(value: unknown): boolean {
  return readInstant(value) !== undefined;
}
