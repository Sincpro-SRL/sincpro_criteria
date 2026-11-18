import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Bucket, Page } from "@sincpro/criteria";
import { criteria, resource } from "@sincpro/criteria";
import React from "react";
import { renderToString } from "react-dom/server";
import { act, create } from "react-test-renderer";

import { useBuckets } from "../src/buckets";
import { useReading } from "../src/reading";

interface Widget {
  id: string;
  kind: string;
}

const widgets: Widget[] = [
  { id: "w1", kind: "raw" },
  { id: "w2", kind: "clean" },
];

function pageOf<R>(rows: R[]): Page<R> {
  return {
    rows,
    cursor: null,
    count: { value: rows.length, exact: true },
    meta: null,
    dropped: [],
  };
}

/** A resource that counts how often it is asked, for rows and for groups. */
function counted() {
  const asked = { read: 0, group: 0 };
  const source = resource<Widget>({
    read: async () => {
      asked.read += 1;
      return pageOf(widgets);
    },
    group: async () => {
      asked.group += 1;
      return pageOf<Bucket<Widget>>([
        { field: "kind", value: "raw", count: 1, criteria: {} },
      ]);
    },
  });
  return { source, asked };
}

describe("useReading on the server", () => {
  const all = criteria<Widget>().limit(10);

  it("renders a reading without a page as idle, instead of refusing to render", () => {
    const { source, asked } = counted();
    function Rows() {
      const { status, rows } = useReading(source, all);
      return React.createElement("p", null, `${status}:${rows.length}`);
    }

    assert.equal(renderToString(React.createElement(Rows)), "<p>idle:0</p>");
    assert.equal(asked.read, 0);
  });

  it("renders the rows of the page it was given", () => {
    const { source } = counted();
    function Rows() {
      const { rows } = useReading(source, all, { page: pageOf(widgets) });
      return React.createElement("p", null, rows.map((one) => one.id).join(","));
    }

    assert.equal(renderToString(React.createElement(Rows)), "<p>w1,w2</p>");
  });
});

describe("useReading in the browser, after the server", () => {
  it("keeps the page it was given on mount: hydrating asks nothing", async () => {
    const { source, asked } = counted();
    let latest: ReturnType<typeof useReading<Widget>> | undefined;
    function Rows() {
      latest = useReading(source, criteria<Widget>().limit(10), { page: pageOf(widgets) });
      return null;
    }

    await act(async () => {
      create(React.createElement(Rows));
    });

    assert.equal(asked.read, 0);
    assert.equal(latest?.status, "ready");
    assert.equal(latest?.rows.length, 2);

    await act(async () => {
      await latest?.reload();
    });
    assert.equal(asked.read, 1);
  });
});

describe("useBuckets on the server", () => {
  const byKind = criteria<Widget>().groupBy("kind");

  it("renders without a page, and renders the groups it was given", () => {
    const { source, asked } = counted();
    function Idle() {
      const { status } = useBuckets(source, byKind);
      return React.createElement("p", null, status);
    }
    function Given() {
      const { buckets } = useBuckets(source, byKind, {
        page: pageOf<Bucket<Widget>>([
          { field: "kind", value: "raw", count: 1, criteria: {} },
        ]),
      });
      return React.createElement(
        "p",
        null,
        buckets.map((one) => String(one.value)).join(","),
      );
    }

    assert.equal(renderToString(React.createElement(Idle)), "<p>idle</p>");
    assert.equal(renderToString(React.createElement(Given)), "<p>raw</p>");
    assert.equal(asked.group, 0);
  });
});
