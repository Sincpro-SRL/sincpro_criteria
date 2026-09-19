import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { criteria } from "@sincpro/criteria";

import { queryKeyFor } from "../src/query-key";

interface Widget {
  id: string;
}

describe("queryKeyFor", () => {
  it("packs the criteria under the given prefix", () => {
    const key = queryKeyFor(
      ["catalog", "widgets"],
      criteria<Widget>().where(["id", "=", "1"]),
    );
    assert.equal(key[0], "catalog");
    assert.equal(key[1], "widgets");
    assert.equal(typeof key[2], "string");
  });

  it("is the same key for two criteria that ask the same question", () => {
    const a = queryKeyFor(["widgets"], criteria<Widget>().where(["id", "=", "1"]));
    const b = queryKeyFor(["widgets"], criteria<Widget>().where(["id", "=", "1"]));
    assert.deepEqual(a, b);
  });

  it("is a different key for a different criteria", () => {
    const a = queryKeyFor(["widgets"], criteria<Widget>().where(["id", "=", "1"]));
    const b = queryKeyFor(["widgets"], criteria<Widget>().where(["id", "=", "2"]));
    assert.notDeepEqual(a, b);
  });

  it("defaults to the empty criteria", () => {
    assert.deepEqual(queryKeyFor(["widgets"]), ["widgets", "e30"]); // base64url of "{}"
  });
});
