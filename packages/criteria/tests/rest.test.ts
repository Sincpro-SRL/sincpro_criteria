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
  model_version: "3f9c",
  dropped: [],
};

const OK_GROUPS = {
  groups: [{ field: "encoding", value: "utf-8", count: 5, criteria: {} }],
  cursor: null,
  count: null,
  model_version: "3f9c",
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
      restSource<Dataset>("/datasets", { fetch: fetchStub, meta: datasetMeta }),
    );

    const page = await datasets.page(
      criteria<Dataset>().selection(["encoding", "=", "utf-8"]),
    );

    assert.equal(page.rows.length, 1);
    assert.equal(page.count?.value, 1);
    assert.equal(page.meta?.aggregate, "Dataset", "the definition the source was given");
    assert.equal(page.version, "3f9c", "the version the server answered with");
    assert.equal(calls.length, 1);

    const url = new URL(calls[0]!.url, "http://x");
    assert.equal(url.pathname, "/datasets");
    const sent = unpack(url.searchParams.get("criteria")!);
    assert.deepEqual(sent.selection, { field: "encoding", operator: "=", value: "utf-8" });
  });

  it("sends the criteria as plain JSON, the format the framework's REST route reads", async () => {
    const { fetchStub, calls } = stub(200, OK_PAGE);
    const datasets = restSource<Dataset>("/datasets", { fetch: fetchStub });

    await datasets.read({ selection: { field: "encoding", operator: "=", value: "utf-8" } });

    const raw = new URL(calls[0]!.url, "http://x").searchParams.get("criteria")!;
    assert.deepEqual(JSON.parse(raw).selection, {
      field: "encoding",
      operator: "=",
      value: "utf-8",
    });
  });

  it("joins with & when the route already carries its own query", async () => {
    const { fetchStub, calls } = stub(200, OK_PAGE);
    const datasets = restSource<Dataset>("/projects?tenant_id=acme", { fetch: fetchStub });

    await datasets.read({ pagination: { limit: 5 } });

    const url = new URL(calls[0]!.url, "http://x");
    assert.equal(url.pathname, "/projects");
    assert.equal(url.searchParams.get("tenant_id"), "acme");
    assert.equal(unpack(url.searchParams.get("criteria")!).pagination?.limit, 5);
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

describe("restSource — a body in another format, read by a decoder the platform plugs", () => {
  it("reads the envelope the decoder answers, and leaves a JSON body to JSON", async () => {
    const parquetStub = (async () =>
      new Response(new Uint8Array([80, 65, 82, 49]), {
        status: 200,
        headers: { "content-type": "application/vnd.apache.parquet" },
      })) as typeof fetch;
    const decode = async (response: Response) =>
      response.headers.get("content-type") === "application/vnd.apache.parquet"
        ? { ...OK_PAGE, datasets: [{ dataset_id: "d9", name: "from.parquet" }] }
        : undefined;

    const fromParquet = await resource<Dataset>(
      restSource<Dataset>("/datasets", { fetch: parquetStub, meta: datasetMeta, decode }),
    ).page(criteria<Dataset>());
    const { fetchStub } = stub(200, OK_PAGE);
    const fromJson = await resource<Dataset>(
      restSource<Dataset>("/datasets", { fetch: fetchStub, meta: datasetMeta, decode }),
    ).page(criteria<Dataset>());

    assert.deepEqual(fromParquet.rows, [{ dataset_id: "d9", name: "from.parquet" }]);
    assert.deepEqual(fromJson.rows, OK_PAGE.datasets);
  });
});

describe("restSource — a refusal never reaches the decoder", () => {
  it("throws a RestError with the problem read as JSON, whatever the decoder", async () => {
    let decoded = 0;
    const refused = (async () =>
      new Response(JSON.stringify({ status: 403, title: "Forbidden", kind: "forbidden" }), {
        status: 403,
      })) as typeof fetch;
    const source = restSource<Dataset>("/datasets", {
      fetch: refused,
      decode: async () => {
        decoded += 1;
        return undefined;
      },
    });

    await assert.rejects(resource<Dataset>(source).page(criteria<Dataset>()), RestError);
    assert.equal(decoded, 0);
  });
});
