/**
 * Rows already in hand, as a source.
 *
 * Not a test double. This is what a caller uses when it brought everything down and wants to
 * filter, sort, page, group and pivot it itself — with the same criteria it would have sent
 * to a server, so the day it stops bringing everything down, only the source changes.
 *
 * @module
 */

import type { AnyRecord, Criteria } from "@sincpro/criteria/criteria/grammar";
import { answer, answerGroups } from "@sincpro/criteria/engine/answer";
import { filtered } from "@sincpro/criteria/engine/evaluate";
import type { Axes } from "@sincpro/criteria/engine/pivot";
import { pivotOf } from "@sincpro/criteria/engine/pivot";
import { describeRows } from "@sincpro/criteria/meta/describe";
import type { Meta } from "@sincpro/criteria/meta/meta";
import type { Bucket, Page, Pivot } from "@sincpro/criteria/page/page";
import type { Source } from "@sincpro/criteria/source/source";
import { validate } from "@sincpro/criteria/validate";

/** How to read a set of rows as a source. */
export interface FromRowsOptions {
  /**
   * What the rows are, as a model definition. Without one it is read off the rows themselves
   * — see {@link describeRows} — which is a guess, and a good enough one to filter and sort
   * by. Hand over the definition a server sent and the guess is not used at all.
   */
  meta?: Meta;

  /** Which field identifies a row, when the definition is being guessed. */
  identity?: string;
}

/**
 * A source over rows already in hand.
 *
 * It answers `read`, `group` and `pivot`, because everything it needs is right here.
 *
 * @example
 * const datasets = resource(fromRows(rows, { identity: "dataset_id" }));
 * const page = await datasets.page(criteria().where(eq("encoding", "utf-8")).limit(20));
 */
export function fromRows<T = AnyRecord>(
  rows: readonly T[],
  options: FromRowsOptions = {},
): Source<T> & { meta: Meta } {
  const meta = options.meta ?? describeRows(rows, { identity: options.identity });
  return {
    meta,
    read: (criteria: Criteria<T>): Page<T> => answer(rows, criteria, meta),
    group: (criteria: Criteria<T>): Page<Bucket<T>> => answerGroups(rows, criteria, meta),
    pivot: (criteria: Criteria<T>, axes: Axes<T>): Pivot =>
      pivotOf(filtered(rows, validate<T>(criteria, meta).criteria.where), axes),
  };
}
