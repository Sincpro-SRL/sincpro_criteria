import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { criteria, resource } from "@sincpro/criteria";
import { RpcError, rpcSource } from "@sincpro/criteria/rpc";

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

function rpcResult(result: unknown) {
  return { jsonrpc: "2.0", id: 1, result };
}

function rpcErrorBody(code: number, message: string) {
  return { jsonrpc: "2.0", id: 1, error: { code, message } };
}

function stub(status: number, body: unknown) {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const fetchStub = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status });
  }) as typeof fetch;
  return { fetchStub, calls };
}

function sentBody(init: RequestInit | undefined): Record<string, unknown> {
  return JSON.parse(String(init?.body)) as Record<string, unknown>;
}

describe("rpcSource — a Source over the framework's JSON-RPC 2.0 entrypoint", () => {
  it("POSTs a jsonrpc 2.0 envelope with the criteria under params.criteria", async () => {
    const { fetchStub, calls } = stub(200, rpcResult(OK_PAGE));
    const datasets = resource<Dataset>(
      rpcSource("/rpc", { read: "catalog.query.ListDatasets" }, { fetch: fetchStub }),
    );

    const page = await datasets.page(criteria<Dataset>().where(["encoding", "=", "utf-8"]));

    assert.equal(page.rows.length, 1);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.url, "/rpc");
    assert.equal(calls[0]!.init?.method, "POST");

    const body = sentBody(calls[0]!.init);
    assert.equal(body.jsonrpc, "2.0");
    assert.equal(body.method, "catalog.query.ListDatasets");
    assert.deepEqual((body.params as { criteria: unknown }).criteria, {
      where: { field: "encoding", operator: "=", value: "utf-8" },
    });
  });

  it("groups through the group method, when one is given", async () => {
    const { fetchStub, calls } = stub(200, rpcResult(OK_GROUPS));
    const datasets = resource<Dataset>(
      rpcSource(
        "/rpc",
        { read: "catalog.query.ListDatasets", group: "catalog.query.GroupDatasets" },
        { fetch: fetchStub },
      ),
    );

    const page = await datasets.groups(criteria<Dataset>().groupBy("encoding"));

    assert.equal(page.rows.length, 1);
    const body = sentBody(calls[0]!.init);
    assert.equal(body.method, "catalog.query.GroupDatasets");
  });

  it("has no group() when no group method was given", () => {
    const source = rpcSource<Dataset>("/rpc", { read: "catalog.query.ListDatasets" });
    assert.equal(source.group, undefined);
  });

  it("merges a static or freshly-computed context into the request", async () => {
    const { fetchStub, calls } = stub(200, rpcResult(OK_PAGE));
    let tenant = "acme";
    const datasets = rpcSource<Dataset>(
      "/rpc",
      { read: "catalog.query.ListDatasets" },
      { fetch: fetchStub, context: () => ({ tenant }) },
    );

    await datasets.read({});
    tenant = "other";
    await datasets.read({});

    assert.deepEqual(sentBody(calls[0]!.init).context, { tenant: "acme" });
    assert.deepEqual(sentBody(calls[1]!.init).context, { tenant: "other" });
  });

  it("throws RpcError with the JSON-RPC error object when the envelope carries one", async () => {
    const { fetchStub } = stub(200, rpcErrorBody(-32602, "Invalid params"));
    const source = rpcSource<Dataset>(
      "/rpc",
      { read: "catalog.query.ListDatasets" },
      { fetch: fetchStub },
    );

    await assert.rejects(
      async () => {
        await source.read({});
      },
      (error: unknown) => {
        assert.ok(error instanceof RpcError);
        assert.equal(error.rpcError.code, -32602);
        assert.equal(error.method, "catalog.query.ListDatasets");
        return true;
      },
    );
  });

  it("throws RpcError on a transport-level (non-2xx) failure too", async () => {
    const { fetchStub } = stub(500, "internal server error");
    const source = rpcSource<Dataset>(
      "/rpc",
      { read: "catalog.query.ListDatasets" },
      { fetch: fetchStub },
    );

    await assert.rejects(
      async () => {
        await source.read({});
      },
      (error: unknown) => {
        assert.ok(error instanceof RpcError);
        assert.equal(error.rpcError.code, 500);
        return true;
      },
    );
  });
});
