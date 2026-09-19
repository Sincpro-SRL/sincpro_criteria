import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { criteria, resource, unpack } from "@sincpro/criteria";
import { RestError, restSource } from "@sincpro/criteria/rest";

import type { Dataset } from "./fixtures";
import { datasetMeta } from "./fixtures";

const OK_PAGE = {
  datasets: [{ dataset_id: "d1", name: "labs.csv" }],
  cursor: null,
  count: { value: 1, exact: true },
  model_meta_data: datasetMeta,
  dropped: [],
};

const OK_GROUPS = {
  groups: [{ field: "encoding", value: "utf-8", count: 5, criteria: {} }],
  cursor: null,
  count: null,
  model_meta_data: null,
  dropped: [],
};

function stub(status: number, body: unknown) {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const fetchStub = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status });
  }) as typeof fetch;
  return { fetchStub, calls };
}

describe("restSource — a Source that wraps fetch around pack/pageFrom", () => {
  it("reads a page from GET {baseUrl}?criteria=...", async () => {
    const { fetchStub, calls } = stub(200, OK_PAGE);
    const datasets = resource<Dataset>(
      restSource<Dataset>("/datasets", { fetch: fetchStub }),
    );

    const page = await datasets.page(criteria<Dataset>().where(["encoding", "=", "utf-8"]));

    assert.equal(page.rows.length, 1);
    assert.equal(page.count?.value, 1);
    assert.equal(page.meta?.aggregate, "Dataset");
    assert.equal(calls.length, 1);

    const url = new URL(calls[0]!.url, "http://x");
    assert.equal(url.pathname, "/datasets");
    const sent = unpack(url.searchParams.get("criteria")!);
    assert.deepEqual(sent.where, { field: "encoding", operator: "=", value: "utf-8" });
  });

  it("groups from the same URL read() uses, by default — the criteria decides, not a guessed path", async () => {
    const { fetchStub, calls } = stub(200, OK_GROUPS);
    const datasets = resource<Dataset>(
      restSource<Dataset>("/datasets", { fetch: fetchStub }),
    );

    const page = await datasets.groups(criteria<Dataset>().groupBy("encoding"));

    assert.equal(page.rows.length, 1);
    assert.equal(page.rows[0]!.field, "encoding");
    const url = new URL(calls[0]!.url, "http://x");
    assert.equal(url.pathname, "/datasets");
  });

  it("groups from `groupUrl` when the backend answers it at a different endpoint", async () => {
    const { fetchStub, calls } = stub(200, OK_GROUPS);
    const datasets = resource<Dataset>(
      restSource<Dataset>("/datasets", { fetch: fetchStub, groupUrl: "/datasets/groups" }),
    );

    await datasets.groups(criteria<Dataset>().groupBy("encoding"));

    const url = new URL(calls[0]!.url, "http://x");
    assert.equal(url.pathname, "/datasets/groups");
  });

  it("sends static headers with every call", async () => {
    const { fetchStub, calls } = stub(200, OK_PAGE);
    const datasets = restSource<Dataset>("/datasets", {
      fetch: fetchStub,
      headers: { Authorization: "Bearer t" },
    });

    await datasets.read({});

    assert.equal(
      (calls[0]!.init!.headers as Record<string, string>).Authorization,
      "Bearer t",
    );
  });

  it("calls a header function fresh on every request, for a token that rotates", async () => {
    const { fetchStub, calls } = stub(200, OK_PAGE);
    let token = "first";
    const datasets = restSource<Dataset>("/datasets", {
      fetch: fetchStub,
      headers: () => ({ Authorization: `Bearer ${token}` }),
    });

    await datasets.read({});
    token = "second";
    await datasets.read({});

    assert.equal(
      (calls[0]!.init!.headers as Record<string, string>).Authorization,
      "Bearer first",
    );
    assert.equal(
      (calls[1]!.init!.headers as Record<string, string>).Authorization,
      "Bearer second",
    );
  });

  it("passes the AbortSignal through to fetch", async () => {
    const { fetchStub, calls } = stub(200, OK_PAGE);
    const datasets = restSource<Dataset>("/datasets", { fetch: fetchStub });
    const controller = new AbortController();

    await datasets.read({}, controller.signal);

    assert.equal(calls[0]!.init!.signal, controller.signal);
  });

  it("throws RestError, with the status and body, on a non-2xx answer", async () => {
    const { fetchStub } = stub(404, { detail: "not found" });
    const datasets = restSource<Dataset>("/datasets", { fetch: fetchStub });

    await assert.rejects(
      async () => {
        await datasets.read({});
      },
      (error: unknown) => {
        assert.ok(error instanceof RestError);
        assert.equal(error.status, 404);
        assert.match(error.body, /not found/);
        return true;
      },
    );
  });
});
