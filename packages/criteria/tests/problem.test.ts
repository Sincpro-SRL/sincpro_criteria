import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { readProblem } from "@sincpro/criteria";
import { RestError, restSource } from "@sincpro/criteria/rest";
import { RpcError, rpcSource } from "@sincpro/criteria/rpc";

/*
 * Each body below is what sincpro_framework answered, dumped from `failure_answer(error)` (REST)
 * and `answer_for(error)` (JSON-RPC) and pasted as it came.
 */

const GUIDANCE =
  "The request does not fit what the use case takes: correct the fields named and send it again.";

/** A criteria with a misspelt key (`valeu`), over REST: the RFC 9457 body itself. */
const REST_INVALID_CRITERIA = {
  kind: "invalid",
  reason: "INVALID",
  title: "The request does not validate",
  status: 422,
  detail: "a filter node has no 'valeu'; it takes ['field', 'operator', 'value']",
  next_step: "fix_request",
  guidance: GUIDANCE,
  retryable: false,
};

/** The same failure over JSON-RPC: the error's `data`, the text under `message`. */
const RPC_INVALID_CRITERIA = {
  kind: "invalid",
  reason: "INVALID",
  retryable: false,
  next_step: "fix_request",
  guidance: GUIDANCE,
  message: "a filter node has no 'valeu'; it takes ['field', 'operator', 'value']",
};

/** A DTO field that did not validate, over REST: a pointer per field. */
const REST_VALIDATION = {
  kind: "invalid",
  reason: "INVALID",
  title: "The request does not validate",
  status: 422,
  next_step: "fix_request",
  guidance: GUIDANCE,
  retryable: false,
  errors: [
    {
      pointer: "#/total",
      detail: "Input should be a valid integer, unable to parse string as an integer",
    },
  ],
};

/** The same over JSON-RPC, where the field errors still come as the validation library wrote them. */
const RPC_VALIDATION = {
  kind: "invalid",
  reason: "VALIDATION_ERROR",
  retryable: false,
  next_step: "fix_request",
  guidance: GUIDANCE,
  errors: [
    {
      type: "int_parsing",
      loc: ["total"],
      msg: "Input should be a valid integer, unable to parse string as an integer",
      input: "x",
      url: "https://errors.pydantic.dev/2.13/v/int_parsing",
    },
  ],
};

function answering(status: number, body: unknown): typeof fetch {
  return (async () =>
    new Response(typeof body === "string" ? body : JSON.stringify(body), {
      status,
    })) as typeof fetch;
}

describe("a failure the engine tells", () => {
  it("reads the same over REST and over JSON-RPC", () => {
    const overRest = readProblem(REST_INVALID_CRITERIA)!;
    const overRpc = readProblem(RPC_INVALID_CRITERIA)!;

    assert.equal(overRest.kind, "invalid");
    assert.equal(overRest.next_step, "fix_request");
    assert.equal(overRest.retryable, false);
    assert.equal(overRest.detail, overRpc.detail);
    assert.equal(overRpc.kind, overRest.kind);
    assert.equal(overRpc.reason, overRest.reason);
    assert.equal(overRpc.status, undefined);
  });

  it("addresses a field that did not validate by the same pointer on both wires", () => {
    const expected = [
      {
        pointer: "#/total",
        detail: "Input should be a valid integer, unable to parse string as an integer",
      },
    ];

    assert.deepEqual(readProblem(REST_VALIDATION)!.errors, expected);
    assert.deepEqual(readProblem(RPC_VALIDATION)!.errors, expected);
  });

  it("drops where a value came from, and escapes a pointer as RFC 6901 says", () => {
    const problem = readProblem({
      ...RPC_VALIDATION,
      errors: [{ loc: ["body", "lines", 0, "a/b~c"], msg: "bad" }],
    })!;

    assert.deepEqual(problem.errors, [{ pointer: "#/lines/0/a~1b~0c", detail: "bad" }]);
  });

  it("keeps what the error disclosed besides, and reads the gateway's {error}", () => {
    const problem = readProblem({
      error: {
        ...REST_INVALID_CRITERIA,
        kind: "exhausted",
        retryable: true,
        retry_after: 30,
        limit: 50,
      },
    })!;

    assert.equal(problem.kind, "exhausted");
    assert.equal(problem.retry_after, 30);
    assert.deepEqual(problem.extensions, { limit: 50 });
  });

  it("is null for a body that is not one", () => {
    assert.equal(readProblem("<html>Bad gateway</html>"), null);
    assert.equal(readProblem(""), null);
    assert.equal(readProblem({ detail: "not found" }), null);
    assert.equal(readProblem(undefined), null);
  });
});

describe("a transport that failed", () => {
  it("hands the REST problem on the error it throws", async () => {
    const source = restSource("/tickets", { fetch: answering(422, REST_INVALID_CRITERIA) });

    await assert.rejects(
      async () => source.read({}),
      (error: unknown) => {
        assert.ok(error instanceof RestError);
        assert.equal(error.problem?.next_step, "fix_request");
        assert.match(error.problem?.detail ?? "", /valeu/);
        return true;
      },
    );
  });

  it("hands the JSON-RPC problem on the error it throws", async () => {
    const source = rpcSource(
      "/rpc",
      { read: "helpdesk.query.ListTickets" },
      {
        fetch: answering(200, {
          jsonrpc: "2.0",
          id: 1,
          error: { code: -32602, message: "Invalid params", data: RPC_VALIDATION },
        }),
      },
    );

    await assert.rejects(
      async () => source.read({}),
      (error: unknown) => {
        assert.ok(error instanceof RpcError);
        assert.equal(error.problem?.reason, "VALIDATION_ERROR");
        assert.equal(error.problem?.errors[0]?.pointer, "#/total");
        return true;
      },
    );
  });

  it("has no problem to hand when a proxy answered instead of the engine", async () => {
    const source = restSource("/tickets", {
      fetch: answering(502, "<html>Bad gateway</html>"),
    });

    await assert.rejects(
      async () => source.read({}),
      (error: unknown) => {
        assert.ok(error instanceof RestError);
        assert.equal(error.problem, null);
        assert.match(error.body, /Bad gateway/);
        return true;
      },
    );
  });
});
