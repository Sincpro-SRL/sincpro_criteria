import type { Pivot, PivotCell } from "@sincpro/criteria/page/page";

/** One row of the grid: its key, the cells across, and the margin that closes it. */
export interface TableRow {
  key: unknown[];
  label: string;
  cells: PivotCell[];
  margin: PivotCell | undefined;
}

/** A pivot as a rectangle. */
export interface Table {
  columns: { key: unknown[]; label: string }[];
  rows: TableRow[];

  /** The margin under each column, in the columns' order. */
  footer: PivotCell[];

  /** Everything the criteria matched, folded once. */
  total: PivotCell | undefined;
}

/** How to draw the grid. */
export interface TableOptions {
  /** What a key with no value is called. */
  empty?: string;
}

/**
 * A pivot as a grid with no holes.
 *
 * Every crossing that answered nothing becomes a cell with `count: 0` and no measures, so a
 * renderer walks `rows × columns` without checking anything.
 *
 * @example
 * const grid = asTable(pivot);
 * grid.rows[0].cells[2].count; // the third column of the first row, always there
 * grid.total?.count; // the grand total, folded by the engine and not added up here
 */
export function asTable(pivot: Pivot, options: TableOptions = {}): Table {
  const held = new Map<string, PivotCell>();
  for (const cell of pivot.cells) held.set(keyOf([...cell.row, ...cell.column]), cell);

  const marginOf = new Map<string, PivotCell>();
  for (const cell of pivot.row_margin ?? []) marginOf.set(keyOf(cell.row), cell);

  return {
    columns: pivot.columns.map((key) => ({ key, label: labelOf(key, options.empty) })),
    rows: pivot.rows.map((row) => ({
      key: row,
      label: labelOf(row, options.empty),
      cells: pivot.columns.map(
        (column) =>
          held.get(keyOf([...row, ...column])) ?? { row, column, count: 0, measures: {} },
      ),
      margin: marginOf.get(keyOf(row)),
    })),
    footer: (pivot.column_margin ?? []).slice(),
    total: pivot.total,
  };
}

function keyOf(key: readonly unknown[]): string {
  return JSON.stringify(
    key.map((one) => {
      if (one === null || one === undefined) return ["null"];
      if (one instanceof Date) return ["datetime", one.toISOString()];
      return [typeof one, String(one)];
    }),
  );
}

function labelOf(key: readonly unknown[], empty = "—"): string {
  if (key.length === 0) return empty;
  return key
    .map((one) => {
      if (one === null || one === undefined) return empty;
      return one instanceof Date ? one.toISOString() : String(one);
    })
    .join(" · ");
}
