/**
 * The type-level contract. `@ts-expect-error` fails the build when the error it names stops
 * happening, so these are checked by `make typecheck` rather than at runtime.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { all, criteria, eq, gt, like, merge } from "@sincpro/criteria";

import type { Dataset } from "./fixtures";

describe("typing is opt-in", () => {
  it("asks nothing of a caller that has no type yet", () => {
    const q = criteria().where(eq("whatever", 1), gt("anything_else", 2));
    assert.ok(q.value.where);
  });

  it("checks the field names when there is a record to check them against", () => {
    const q = criteria<Dataset>().where(eq("encoding", "utf-8"), gt("row_count", 1000));
    assert.ok(q.value.where);
  });

  it("refuses a field the record does not have", () => {
    const q = criteria<Dataset>().where(
      // @ts-expect-error 'encodig' is not a field of Dataset
      eq("encodig", "utf-8"),
    );
    assert.ok(q.value.where);
  });

  it("refuses an ordering, a level and a mask over fields the record does not have", () => {
    // @ts-expect-error 'gone' is not a field of Dataset
    criteria<Dataset>().by("gone");
    // @ts-expect-error 'gone' is not a field of Dataset
    criteria<Dataset>().specification({ gone: {} });
    // @ts-expect-error 'gone' is not a field of Dataset
    criteria<Dataset>().totals({ rows: ["sum", "gone"] });
    assert.ok(true);
  });

  it("keeps one filter readable when its conditions name different fields", () => {
    // The trap this guards: inferring the record from the first field name and rejecting
    // every other one against it.
    const filter = all(eq("a", 1), like("b", "x"), gt("c", 2));
    assert.ok(filter);
  });

  it("merges two plain criteria that name different fields", () => {
    const merged = merge({ where: eq("a", 1) }, { where: gt("b", 2) });
    assert.ok(merged.where);
  });

  it("keeps the record's type through a merge done on the builder", () => {
    const merged = criteria<Dataset>()
      .where(eq("encoding", "utf-8"))
      .merge(criteria<Dataset>().limit(10));
    const back: typeof merged.value.order = merged.value.order;
    assert.equal(back, undefined);
  });
});
