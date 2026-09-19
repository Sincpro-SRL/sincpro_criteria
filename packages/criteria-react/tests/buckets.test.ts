import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Bucket, Page } from "@sincpro/criteria";
import { criteria, plain, resource } from "@sincpro/criteria";
import React from "react";
import { act, create } from "react-test-renderer";

import { useBuckets } from "../src/buckets";

interface Widget {
  id: string;
  kind: string;
}

function bucketPage(buckets: Bucket<Widget>[]): Page<Bucket<Widget>> {
  return { rows: buckets, cursor: null, count: null, meta: null, dropped: [] };
}

describe("useBuckets", () => {
  it("loads the first level on mount", async () => {
    const widgets = resource<Widget>({
      read: async () => ({ rows: [], cursor: null, count: null, meta: null, dropped: [] }),
      group: async () =>
        bucketPage([{ field: "kind", value: "raw", count: 3, criteria: {} }]),
    });

    let latest: ReturnType<typeof useBuckets<Widget>> | undefined;
    function Probe() {
      latest = useBuckets(widgets, criteria<Widget>().groupBy("kind"));
      return null;
    }

    await act(async () => {
      create(React.createElement(Probe));
    });

    assert.equal(latest?.status, "ready");
    assert.equal(latest?.buckets.length, 1);
    assert.equal(latest?.buckets[0]?.value, "raw");
  });

  it("open() hands back a Reading for that bucket's own criteria", async () => {
    const bucketCriteria = plain(criteria<Widget>().where(["kind", "=", "raw"]));
    const widgets = resource<Widget>({
      read: async () => ({ rows: [], cursor: null, count: null, meta: null, dropped: [] }),
      group: async () =>
        bucketPage([{ field: "kind", value: "raw", count: 3, criteria: bucketCriteria }]),
    });

    let latest: ReturnType<typeof useBuckets<Widget>> | undefined;
    function Probe() {
      latest = useBuckets(widgets, criteria<Widget>().groupBy("kind"));
      return null;
    }

    await act(async () => {
      create(React.createElement(Probe));
    });

    const reading = latest!.open(latest!.buckets[0]!);
    assert.deepEqual(reading.criteria, bucketCriteria);
  });
});
