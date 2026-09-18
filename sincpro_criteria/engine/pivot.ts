/**
 * Groups crossed by groups: a table with folded cells and its margins.
 *
 * The axes are not part of a criteria. A pivot asks for rows down one side and columns across
 * the other, and the criteria says which rows it is over — the same split the engine's own
 * `pivot(target, rows, columns, criteria, **folds)` makes.
 *
 * The margins are folded from the rows, never added up from the cells: an average of averages
 * is not an average.
 *
 * @module
 */

import type { AnyRecord, Fields, Fold, Level } from "@sincpro/criteria/criteria/grammar";
import { missing } from "@sincpro/criteria/engine/compare";
import { folded } from "@sincpro/criteria/engine/fold";
import { cutTo } from "@sincpro/criteria/engine/grain";
import type { Pivot, PivotCell } from "@sincpro/criteria/page/page";

/** The two axes of a pivot, and the numbers folded where they cross. */
export interface Axes<T = AnyRecord> {
  rows: (Fields<T> | Level<T>)[];
  columns: (Fields<T> | Level<T>)[];
  totals?: Record<string, Fold<T>>;
}

/**
 * A pivot over rows already filtered — whoever holds the criteria applies it first, the same
 * way a grouping receives the rows it is going to split.
 *
 * `rows` and `columns` hold every key that appeared, in the order it first appeared, so a
 * client renders the grid without scanning the cells; `cells` holds only the crossings that
 * have rows, because a pivot is mostly holes.
 *
 * @example
 * pivotOf(rows, {
 *   rows: ["encoding"],
 *   columns: [{ field: "registered_at", grain: "month" }],
 *   totals: { rows: ["sum", "row_count"] },
 * });
 */
export function pivotOf<T = AnyRecord>(rows: readonly T[], axes: Axes<T>): Pivot {
  const down = axes.rows.map(asLevel);
  const across = axes.columns.map(asLevel);
  const totals = axes.totals;

  const rowKeys: unknown[][] = [];
  const columnKeys: unknown[][] = [];
  const held = new Map<string, { row: unknown[]; column: unknown[]; rows: T[] }>();
  const byRow = new Map<string, T[]>();
  const byColumn = new Map<string, T[]>();

  for (const record of rows) {
    const row = keysOf(record, down);
    const column = keysOf(record, across);
    remember(rowKeys, row);
    remember(columnKeys, column);

    push(byRow, keyOf(row), record);
    push(byColumn, keyOf(column), record);
    pushCell(held, row, column, record);
  }

  const cells: PivotCell[] = [...held.values()].map(({ row, column, rows: mine }) => ({
    row,
    column,
    count: mine.length,
    totals: folded(mine, totals),
  }));

  return {
    rows: rowKeys,
    columns: columnKeys,
    cells,
    row_margin: rowKeys.map((row) => margin(byRow.get(keyOf(row)) ?? [], row, [], totals)),
    column_margin: columnKeys.map((column) =>
      margin(byColumn.get(keyOf(column)) ?? [], [], column, totals),
    ),
    total: margin(rows, [], [], totals),
  };
}

/**
 * The cell where one row key crosses one column key, or `undefined` when nothing fell there.
 *
 * @example
 * cellOf(pivot, ["utf-8"], ["2026-01"])?.count;
 */
export function cellOf(
  pivot: Pivot,
  row: readonly unknown[],
  column: readonly unknown[],
): PivotCell | undefined {
  return pivot.cells.find(
    (cell) => keyOf(cell.row) === keyOf(row) && keyOf(cell.column) === keyOf(column),
  );
}

function margin<T>(
  rows: readonly T[],
  row: unknown[],
  column: unknown[],
  totals: Record<string, Fold<T>> | undefined,
): PivotCell {
  return { row, column, count: rows.length, totals: folded(rows, totals) };
}

function asLevel<T>(level: Fields<T> | Level<T>): Level<T> {
  return typeof level === "string" ? ({ field: level } as Level<T>) : level;
}

function keysOf<T>(record: T, levels: readonly Level<T>[]): unknown[] {
  return levels.map((level) => {
    const raw = (record as AnyRecord)[level.field];
    return level.grain ? cutTo(raw, level.grain) : raw;
  });
}

/** The keys of one axis, in the order they first appeared and without repeats. */
function remember(seen: unknown[][], key: unknown[]): void {
  const written = keyOf(key);
  if (!seen.some((one) => keyOf(one) === written)) seen.push(key);
}

function push<T>(held: Map<string, T[]>, at: string, record: T): void {
  const rows = held.get(at);
  if (rows === undefined) held.set(at, [record]);
  else rows.push(record);
}

function pushCell<T>(
  held: Map<string, { row: unknown[]; column: unknown[]; rows: T[] }>,
  row: unknown[],
  column: unknown[],
  record: T,
): void {
  const at = keyOf([...row, ...column]);
  const cell = held.get(at);
  if (cell === undefined) held.set(at, { row, column, rows: [record] });
  else cell.rows.push(record);
}

/**
 * A key as one string, so a `Map` can hold it.
 *
 * Tagged by type and written as JSON: without the tag the number `1` and the text `"1"` fall
 * in the same cell, and without JSON a value carrying the separator would split a key in two.
 */
function keyOf(key: readonly unknown[]): string {
  return JSON.stringify(
    key.map((one) => {
      if (missing(one)) return ["null"];
      if (one instanceof Date) return ["datetime", one.toISOString()];
      return [typeof one, String(one)];
    }),
  );
}
