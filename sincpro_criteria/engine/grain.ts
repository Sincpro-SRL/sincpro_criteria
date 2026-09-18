/**
 * Cutting a date down to the grain a grouping level asks for.
 *
 * Without a grain, grouping a catalogue by a date gives one bucket per row. The label a
 * bucket carries is the one the engine writes — `"2026-01"` for a month — and the criteria
 * that opens it is a RANGE, never an equality: `posted_at = "2026-01"` matches nothing,
 * because the rows hold instants and the label holds a month.
 *
 * @module
 */

import type { Grain } from "@sincpro/criteria/criteria/grammar";
import { readInstant } from "@sincpro/criteria/engine/temporal";

/** The label of the bucket a date falls into, or the value untouched when it is not a date. */
export function cutTo(value: unknown, grain: Grain): unknown {
  const at = asDate(value);
  if (at === undefined) return value;
  switch (grain) {
    case "year":
      return String(at.getUTCFullYear());
    case "month":
      return `${at.getUTCFullYear()}-${pad(at.getUTCMonth() + 1)}`;
    case "week": {
      const [year, week] = isoWeek(at);
      return `${year}-W${pad(week)}`;
    }
    case "day":
      return at.toISOString().slice(0, 10);
  }
}

/** The half-open span of time a bucket covers. */
export interface Range {
  from: string;
  to: string;
}

/**
 * The half-open range the grain of an instant covers: `[from, to)`.
 *
 * It takes the instant itself, not the label cut from it: `"2026-01"` is a name, and the rows
 * hold instants.
 *
 * @example
 * rangeOf("2026-01-20T00:00:00.000Z", "month");
 * // {from: "2026-01-01T00:00:00.000Z", to: "2026-02-01T00:00:00.000Z"}
 */
export function rangeOf(value: unknown, grain: Grain): Range | undefined {
  const at = asDate(value);
  if (at === undefined) return undefined;
  const from = startOf(at, grain);
  return { from: from.toISOString(), to: next(from, grain).toISOString() };
}

function asDate(value: unknown): Date | undefined {
  return readInstant(value);
}

function startOf(at: Date, grain: Grain): Date {
  const year = at.getUTCFullYear();
  switch (grain) {
    case "year":
      return new Date(Date.UTC(year, 0, 1));
    case "month":
      return new Date(Date.UTC(year, at.getUTCMonth(), 1));
    case "week": {
      const day = new Date(Date.UTC(year, at.getUTCMonth(), at.getUTCDate()));
      // ISO weeks start on Monday, and `getUTCDay()` calls Sunday 0.
      const weekday = (day.getUTCDay() + 6) % 7;
      day.setUTCDate(day.getUTCDate() - weekday);
      return day;
    }
    case "day":
      return new Date(Date.UTC(year, at.getUTCMonth(), at.getUTCDate()));
  }
}

function next(from: Date, grain: Grain): Date {
  const at = new Date(from.getTime());
  switch (grain) {
    case "year":
      at.setUTCFullYear(at.getUTCFullYear() + 1);
      return at;
    case "month":
      at.setUTCMonth(at.getUTCMonth() + 1);
      return at;
    case "week":
      at.setUTCDate(at.getUTCDate() + 7);
      return at;
    case "day":
      at.setUTCDate(at.getUTCDate() + 1);
      return at;
  }
}

/**
 * The ISO-8601 week a date falls in, and the year that week belongs to — which is not always
 * the date's own year: the 29th of December can be week 1 of the year after.
 *
 * A week is named after the year of its THURSDAY, which is what makes the rule work at both
 * ends of December. So: step to this week's Thursday, step to the Thursday of the week that
 * holds the 4th of January (week 1, by definition), and count the weeks between them.
 */
function isoWeek(at: Date): [number, number] {
  const thursday = thursdayOf(at);
  const firstThursday = thursdayOf(new Date(Date.UTC(thursday.getUTCFullYear(), 0, 4)));
  const week = 1 + Math.round((thursday.getTime() - firstThursday.getTime()) / 604800000);
  return [thursday.getUTCFullYear(), week];
}

/** The Thursday of the week a date falls in, with Monday as the first day. */
function thursdayOf(at: Date): Date {
  const day = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
  day.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7) + 3);
  return day;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}
