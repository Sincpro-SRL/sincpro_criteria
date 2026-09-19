import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { LiveChannel, Source } from "@sincpro/criteria";
import { criteria, resource } from "@sincpro/criteria";

import type { Dataset } from "./fixtures";

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

/** A fake live channel this test controls directly, plus a way to invalidate it. */
function fakeLiveSource(rowCounter: () => number) {
  const listeners = new Set<() => void>();
  let closed = false;

  const source: Source<Dataset> = {
    read: async () => ({
      rows: Array.from({ length: rowCounter() }, (_unused, index) => ({
        dataset_id: `d${index}`,
        name: `d${index}.csv`,
        encoding: "utf-8",
        row_count: 1,
        registered_at: "2026-01-01T00:00:00.000Z",
        producer_id: null,
        tags: [],
      })),
      cursor: null,
      count: null,
      meta: null,
      dropped: [],
    }),
    live: (): LiveChannel => ({
      onInvalidate: (fn) => {
        listeners.add(fn);
        return () => listeners.delete(fn);
      },
      close: () => {
        closed = true;
      },
    }),
  };

  return {
    source,
    invalidate: () => listeners.forEach((fn) => fn()),
    isClosed: () => closed,
  };
}

describe("Reading.follow()", () => {
  it("throws when the source has no live channel", () => {
    const noLive = resource<Dataset>(async () => ({
      rows: [],
      cursor: null,
      count: null,
      meta: null,
      dropped: [],
    }));
    const reading = noLive.read();
    assert.throws(() => reading.follow(), /does not answer .live./);
  });

  it("reloads once invalidated", async () => {
    let count = 1;
    const { source, invalidate } = fakeLiveSource(() => count);
    const reading = resource<Dataset>(source).read(criteria<Dataset>());
    await reading.load();
    assert.equal(reading.rows.length, 1);

    const stop = reading.follow(10);
    await delay(0); // let the channel finish opening before invalidating it
    count = 3;
    invalidate();
    await delay(50);

    assert.equal(reading.rows.length, 3);
    stop();
  });

  it("collapses several invalidations close together into one reload", async () => {
    let count = 1;
    let reads = 0;
    const { source, invalidate } = fakeLiveSource(() => count);
    const countingSource: Source<Dataset> = {
      read: async (...args) => {
        reads++;
        return source.read(...args);
      },
      live: source.live,
    };
    const reading = resource<Dataset>(countingSource).read(criteria<Dataset>());
    await reading.load();
    reads = 0;

    const stop = reading.follow(20);
    await delay(0); // let the channel finish opening before invalidating it
    count = 5;
    invalidate();
    invalidate();
    invalidate();
    await delay(60);

    assert.equal(reads, 1);
    assert.equal(reading.rows.length, 5);
    stop();
  });

  it("stops reloading and closes the channel once stopped", async () => {
    let count = 1;
    const { source, invalidate, isClosed } = fakeLiveSource(() => count);
    const reading = resource<Dataset>(source).read(criteria<Dataset>());
    await reading.load();

    const stop = reading.follow(10);
    await delay(0); // let the channel finish opening
    stop();
    assert.equal(isClosed(), true);

    count = 9;
    invalidate();
    await delay(50);

    assert.equal(reading.rows.length, 1); // unchanged — nobody was listening any more
  });
});
