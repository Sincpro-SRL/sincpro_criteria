import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Page } from "@sincpro/criteria";
import { criteria, resource } from "@sincpro/criteria";
import React from "react";
import { act, create } from "react-test-renderer";

import { useReading } from "../src/reading";

interface Widget {
  id: string;
  name: string;
}

function pageOf(rows: Widget[]): Page<Widget> {
  return {
    rows,
    cursor: null,
    count: { value: rows.length, exact: true },
    meta: null,
    dropped: [],
  };
}

describe("useReading", () => {
  it("loads on mount and re-renders with the rows once they arrive", async () => {
    const widgets = resource<Widget>(async () => pageOf([{ id: "1", name: "a" }]));
    let latest: ReturnType<typeof useReading<Widget>> | undefined;

    function Probe() {
      latest = useReading(widgets, criteria<Widget>());
      return null;
    }

    await act(async () => {
      create(React.createElement(Probe));
    });

    assert.equal(latest?.status, "ready");
    assert.equal(latest?.rows.length, 1);
    assert.equal(latest?.rows[0]?.name, "a");
  });

  it("does not restart the reading when an equal-but-new criteria object is passed", async () => {
    let calls = 0;
    const widgets = resource<Widget>(async () => {
      calls++;
      return pageOf([{ id: "1", name: "a" }]);
    });

    let renderCount = 0;
    function Probe() {
      renderCount++;
      // A fresh object literal every render — this is the case `pack(criteria)` guards
      // against: without it, this would be an infinite loop of new readings.
      useReading(widgets, criteria<Widget>().where(["id", "=", "1"]));
      return null;
    }

    let root: ReturnType<typeof create> | undefined;
    await act(async () => {
      root = create(React.createElement(Probe));
    });
    await act(async () => {
      root!.update(React.createElement(Probe));
    });

    assert.equal(calls, 1);
    assert.ok(renderCount >= 2);
  });

  it("refine() asks again and reports the new rows", async () => {
    const widgets = resource<Widget>(async (asked) => {
      const id = asked.where && "value" in asked.where ? String(asked.where.value) : "1";
      return pageOf([{ id, name: `widget-${id}` }]);
    });

    let latest: ReturnType<typeof useReading<Widget>> | undefined;
    function Probe() {
      latest = useReading(widgets, criteria<Widget>().where(["id", "=", "1"]));
      return null;
    }

    await act(async () => {
      create(React.createElement(Probe));
    });
    assert.equal(latest?.rows[0]?.id, "1");

    await act(async () => {
      await latest!.refine(criteria<Widget>().where(["id", "=", "2"]));
    });
    assert.equal(latest?.rows[0]?.id, "2");
  });
});
