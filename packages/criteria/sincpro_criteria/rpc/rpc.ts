import type { CriteriaLike } from "@sincpro/criteria/criteria/builder";
import { plain } from "@sincpro/criteria/criteria/builder";
import type { AnyRecord } from "@sincpro/criteria/criteria/grammar";
import type { Bucket, Envelope, Page } from "@sincpro/criteria/page/page";
import { pageFrom } from "@sincpro/criteria/page/page";
import type { Source } from "@sincpro/criteria/source/source";

/** The two method names a read side of one aggregate publishes over JSON-RPC. */
export interface RpcMethods {
  /** `{instance}.{layer}.{dto_name}` for the `Query` that answers a plain page. */
  read: string;
  /** Same, for the `Query` that answers a grouping's first level. Omit if there is none. */
  group?: string;
}

/** What an RPC source needs beyond the endpoint and its methods. */
export interface RpcSourceOptions {
  /** Defaults to the global `fetch`. Inject one for tests, or one wired to an interceptor. */
  fetch?: typeof fetch;

  /** Sent with every request. A function is called fresh each time — for a token that rotates. */
  headers?:
    Record<string, string> | (() => Record<string, string> | Promise<Record<string, string>>);

  /**
   * The JSON-RPC 2.0 `context` object every method call carries, merged server-side with
   * whatever context the transport itself already attaches (`jrpc.py`'s `handle_single`).
   * A function is called fresh each time, the same reason `headers` is.
   */
  context?:
    | Record<string, unknown>
    | (() => Record<string, unknown> | Promise<Record<string, unknown>>);
}

/** A JSON-RPC error object, exactly as the spec defines it. */
export interface RpcErrorObject {
  code: number;
  message: string;
  data?: unknown;
}

/** The call answered with a transport-level failure, or the JSON-RPC envelope carried `error`. */
export class RpcError extends Error {
  constructor(
    public readonly method: string,
    public readonly rpcError: RpcErrorObject,
  ) {
    super(`${method} — ${rpcError.code} ${rpcError.message}`);
    this.name = "RpcError";
  }
}

let nextId = 0;

/**
 * A source over the framework's own JSON-RPC 2.0 entrypoint.
 *
 * Verified against `sincpro_framework/entrypoints/rpc/jrpc.py`: every read `Command` extends
 * `Query`, whose one enforced field is `criteria` (`sincpro_framework/ddd/query.py`) — so a
 * method's params are always `{"criteria": ...}`, the plain JSON, never packed the way REST
 * packs it into a URL — there is no URL here to keep short. The method name is
 * `{instance}.{layer}.{dto_name}` (`jrpc.py`'s `method_name`), which is application-specific,
 * so it is the one thing this asks the caller for rather than guessing. The result of a
 * successful call is the same DTO shape a REST route returns for the same command —
 * `pageFrom` reads it exactly like {@link restSource} does.
 *
 * @example
 * // simple
 * import { criteria, resource } from "@sincpro/criteria";
 * import { rpcSource } from "@sincpro/criteria/rpc";
 *
 * const datasets = resource<Dataset>(
 *   rpcSource("/rpc", { read: "catalog.query.ListDatasets", group: "catalog.query.GroupDatasets" }),
 * );
 * await datasets.page(criteria<Dataset>().where(["encoding", "=", "utf-8"]));
 *
 * @example
 * // medium: a per-tenant context merged into every call, and error handling
 * import { RpcError, rpcSource } from "@sincpro/criteria/rpc";
 *
 * const datasets = resource<Dataset>(
 *   rpcSource(
 *     "/rpc",
 *     { read: "catalog.query.ListDatasets", group: "catalog.query.GroupDatasets" },
 *     { context: () => ({ tenant: currentTenant() }) },
 *   ),
 * );
 * try {
 *   await datasets.page(criteria<Dataset>());
 * } catch (error) {
 *   if (error instanceof RpcError) console.error(error.rpcError.code, error.rpcError.message);
 * }
 *
 * @example
 * // complex: nested AND/OR/NOT, two grouping levels, two measures, a filter over the groups
 * // themselves, group-count paging AND row-count paging, and following a bucket's own cursor
 * // — the method name decides the shape, the filter travels through unchanged either way.
 * import { measure, resumingFrom, where } from "@sincpro/criteria";
 *
 * const q = criteria<Dataset>()
 *   .where(
 *     ["row_count", ">", 50],
 *     ["encoding", "!=", "latin-1"],
 *     where.any(
 *       where.all(["tags", "contains", "raw"], ["producer_id", "!=", null]),
 *       ["registered_at", ">=", "2026-03-01T00:00:00.000Z"],
 *     ),
 *     where.negate(["name", "like", "draft"]),
 *   )
 *   .groupBy("encoding", "producer_id")
 *   .measures({ total_rows: measure.sum("row_count"), avg_rows: measure.avg("row_count") })
 *   .whereMeasures(["total_rows", ">", 200])
 *   .orderGroups("-total_rows")
 *   .limitGroups(2)
 *   .limit(2);
 *
 * const page = await datasets.groups(q);
 * const deepest = page.rows[0].groups![0];
 * const next = await datasets.page(resumingFrom(deepest.criteria, deepest.cursor));
 * // next.rows -> the next page of ids INSIDE that one group, not the whole catalog
 */
export function rpcSource<T = AnyRecord>(
  url: string,
  methods: RpcMethods,
  options: RpcSourceOptions = {},
): Source<T> {
  const doFetch = options.fetch ?? fetch;

  async function call(
    method: string,
    criteria: CriteriaLike<T>,
    signal?: AbortSignal,
  ): Promise<Envelope & AnyRecord> {
    const headers =
      typeof options.headers === "function" ? await options.headers() : options.headers;
    const context =
      typeof options.context === "function" ? await options.context() : options.context;

    const response = await doFetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: ++nextId,
        method,
        params: { criteria: plain(criteria) },
        ...(context !== undefined ? { context } : {}),
      }),
      signal,
    });

    const body = await response.text();
    if (!response.ok) {
      throw new RpcError(method, { code: response.status, message: body });
    }

    const parsed = JSON.parse(body) as { result?: unknown; error?: RpcErrorObject };
    if (parsed.error !== undefined) throw new RpcError(method, parsed.error);
    return parsed.result as Envelope & AnyRecord;
  }

  return {
    read: async (criteria, signal) => pageFrom<T>(await call(methods.read, criteria, signal)),

    group:
      methods.group === undefined
        ? undefined
        : async (criteria, signal): Promise<Page<Bucket<T>>> =>
            pageFrom<Bucket<T>>(await call(methods.group!, criteria, signal)),
  };
}
