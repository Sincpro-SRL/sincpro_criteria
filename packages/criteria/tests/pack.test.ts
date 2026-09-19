import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  criteria,
  decodeBase64Url,
  encodeBase64Url,
  InvalidCriteria,
  measure,
  pack,
  readCriteria,
  unpack,
} from "@sincpro/criteria";

import type { Dataset } from "./fixtures";

describe("a criteria in a URL", () => {
  it("comes back the way it went", () => {
    const q = criteria<Dataset>()
      .where(["encoding", "=", "utf-8"])
      .order("-registered_at")
      .limit(100)
      .groupBy("encoding")
      .measures({ rows: measure.sum("row_count") });
    assert.deepEqual(unpack(pack(q)), q.value);
  });

  it("carries no padding, so one request is never two URLs", () => {
    assert.ok(!pack(criteria().limit(80)).includes("="));
  });

  it("is safe in a URL", () => {
    const packed = pack(criteria().where(["name", "=", "a/b+c?d=e"]));
    assert.ok(/^[A-Za-z0-9_-]+$/.test(packed));
  });

  it("reads plain JSON too, because a hand-written URL is a real thing", () => {
    const written = '{"pagination":{"limit":5}}';
    assert.deepEqual(unpack(written), { pagination: { limit: 5 } });
  });

  it("refuses what does not read as a criteria", () => {
    assert.throws(() => unpack("not base64 and not json {"), InvalidCriteria);
    assert.throws(() => unpack("[1,2,3]"), InvalidCriteria);
  });
});

describe("base64url", () => {
  it("survives anything a person types", () => {
    for (const text of [
      "",
      "a",
      "ab",
      "abc",
      "ñandú",
      "日本語",
      "🙂 mixed 🙃",
      '{"a":"é"}',
    ]) {
      assert.equal(decodeBase64Url(encodeBase64Url(text)), text);
    }
  });

  it("reads padded and classic base64 as well", () => {
    assert.equal(decodeBase64Url("YWJjZA=="), "abcd");
    assert.equal(decodeBase64Url(encodeBase64Url("a+b/c")), "a+b/c");
  });
});

describe("reading a criteria that came from outside", () => {
  it("takes the ordering as a line or as objects", () => {
    assert.deepEqual(readCriteria({ order: "-a,b" }).order, [
      { field: "a", descending: true },
      { field: "b" },
    ]);
    assert.deepEqual(readCriteria({ order: [{ field: "a", descending: true }] }).order, [
      { field: "a", descending: true },
    ]);
  });

  it("refuses a page that is both a cursor and an offset", () => {
    assert.throws(() => readCriteria({ pagination: { strategy: {} } }), InvalidCriteria);
  });

  it("refuses a fold the engine cannot compute", () => {
    assert.throws(
      () => readCriteria({ grouping: { measures: { rows: ["median", "row_count"] } } }),
      InvalidCriteria,
    );
  });

  it("refuses a grain it cannot cut", () => {
    assert.throws(
      () =>
        readCriteria({
          grouping: { group_by: [{ field: "registered_at", grain: "fortnight" }] },
        }),
      InvalidCriteria,
    );
  });

  it("refuses a level written as a bare string, because the wire has one spelling", () => {
    assert.throws(
      () => readCriteria({ grouping: { group_by: ["encoding"] } }),
      InvalidCriteria,
    );
  });

  it("reads a nested specification as the same object, at any depth", () => {
    const read = readCriteria({
      specification: {
        name: {},
        runs: { pagination: { limit: 20 }, specification: { id: {} } },
      },
    });
    assert.deepEqual(read.specification?.runs?.specification, { id: {} });
  });
});
