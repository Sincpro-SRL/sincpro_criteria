import type { CriteriaLike } from "@sincpro/criteria/criteria/builder";
import { plain } from "@sincpro/criteria/criteria/builder";
import type { AnyRecord } from "@sincpro/criteria/criteria/grammar";
import type { Meta } from "@sincpro/criteria/meta/meta";
import type { Bucket, Envelope, Page } from "@sincpro/criteria/page/page";
import { pageFrom } from "@sincpro/criteria/page/page";
import type { Problem } from "@sincpro/criteria/page/problem";
import { readProblem } from "@sincpro/criteria/page/problem";
import type { Source } from "@sincpro/criteria/source/source";

/** What a REST source needs beyond the URL: how to fetch, and what to send with every call. */
export interface RestSourceOptions {
  /** Defaults to the global `fetch`. Inject one for tests, or one wired to an interceptor. */
  fetch?: typeof fetch;

  /** Sent with every request. A function is called fresh each time — for a token that rotates. */
  headers?:
    Record<string, string> | (() => Record<string, string> | Promise<Record<string, string>>);

  /**
   * Where a grouping request is sent. Omit it and `group()` reuses the same URL `read()`
   * does — the criteria's own `grouping` is what asks for it, not a different address. Pass
   * one only when the backend genuinely answers grouping at a separate endpoint.
   */
  groupUrl?: string;

  /**
   * The definition of the model the bounded context published — read once from its discovery
   * document (`metaFromContract`). Every page carries it: an answer says only which version
   * of the model it is (`model_version`), never the model again.
   */
  meta?: Meta;
}

/**
 * A read answered with a non-2xx status.
 *
 * `problem` is what the engine said about it — kind, reason, next step, the fields that did not
 * validate — read from the body, or `null` when the body was not one (a proxy's page). `body`
 * keeps the text as it came, for whatever the problem did not cover.
 */
export class RestError extends Error {
  public readonly problem: Problem | null;

  constructor(
    public readonly status: number,
    public readonly url: string,
    public readonly body: string,
  ) {
    super(`${status} answering ${url}${body ? ` — ${body}` : ""}`);
    this.name = "RestError";
    this.problem = readProblem(body);
  }
}

/**
 * A source over a REST endpoint that speaks the engine's own envelope.
 *
 * Deliberately thin: `plain` and `pageFrom` already do the whole job of writing and reading the
 * wire format, so the only thing missing to turn a URL into a {@link Source} was `fetch`
 * itself. The URL for `group` is never guessed — it is not this package's place to assume any
 * consumer's routing convention; pass `groupUrl` only when the backend genuinely answers
 * grouping at a different endpoint, and leave it out to reuse `read`'s own URL for both, with
 * the criteria's own `grouping` deciding what comes back.
 *
 * @example
 * // simple
 * import { criteria, resource } from "@sincpro/criteria";
 * import { restSource } from "@sincpro/criteria/rest";
 *
 * const datasets = resource<Dataset>(restSource("/datasets"));
 * await datasets.page(criteria<Dataset>().selection(["encoding", "=", "utf-8"]).limit(50));
 *
 * @example
 * // medium: rotating auth, a backend that answers grouping at its own endpoint, and error handling
 * import { RestError, restSource } from "@sincpro/criteria/rest";
 *
 * const datasets = resource<Dataset>(
 *   restSource("/datasets", {
 *     headers: () => ({ Authorization: `Bearer ${currentToken()}` }),
 *     groupUrl: "/datasets/groups", // omit it and group() reuses the same URL as read()
 *   }),
 * );
 *
 * try {
 *   await datasets.page(criteria<Dataset>());
 * } catch (error) {
 *   if (error instanceof RestError) console.error(error.status, error.body);
 * }
 *
 * @example
 * // complex: nested AND/OR/NOT, two grouping levels, two measures, a filter over the groups
 * // themselves, group-count paging AND row-count paging, and following a bucket's own cursor
 * // — every call below goes through the same restSource, verified against real rows.
 * import { measure, resumingFrom, selection } from "@sincpro/criteria";
 *
 * const q = criteria<Dataset>()
 *   .selection(
 *     ["row_count", ">", 50],
 *     ["encoding", "!=", "latin-1"],
 *     selection.any(
 *       selection.all(["tags", "contains", "raw"], ["producer_id", "!=", null]),
 *       ["registered_at", ">=", "2026-03-01T00:00:00.000Z"],
 *     ),
 *     selection.negate(["name", "like", "draft"]),
 *   )
 *   .groupBy("encoding", "producer_id")
 *   .measures({ total_rows: measure.sum("row_count"), avg_rows: measure.avg("row_count") })
 *   .whereMeasures(["total_rows", ">", 200])
 *   .orderGroups("-total_rows")
 *   .limitGroups(2) // at most 2 groups at the top level, offset-paged, no cursor
 *   .limit(2); // at most 2 row ids per surviving group, cursor-paged
 *
 * const page = await datasets.groups(q);
 * // [{ value: "utf-8", count: 5, measures: { total_rows: 9610, avg_rows: 1922 },
 * //    ids: ["d10", "d09"], cursor: "eyJrIjpb…",
 * //    groups: [{ value: "p1", count: 4, measures: { total_rows: 9550, avg_rows: 2387.5 },
 * //               ids: ["d10", "d07"], cursor: "eyJrIjpb…" }] }]
 *
 * const deepest = page.rows[0].groups![0];
 * const next = await datasets.page(resumingFrom(deepest.criteria, deepest.cursor));
 * // next.rows -> the next page of ids INSIDE that one group, not the whole catalog
 */
export function restSource<T = AnyRecord>(
  baseUrl: string,
  options: RestSourceOptions = {},
): Source<T> {
  const doFetch = options.fetch ?? fetch;
  const groupUrl = options.groupUrl ?? baseUrl;

  async function call(url: string, signal?: AbortSignal): Promise<Envelope & AnyRecord> {
    const headers =
      typeof options.headers === "function" ? await options.headers() : options.headers;
    const response = await doFetch(url, { headers, signal });
    const body = await response.text();
    if (!response.ok) throw new RestError(response.status, url, body);
    return JSON.parse(body) as Envelope & AnyRecord;
  }

  /**
   * The criteria as plain JSON in `?criteria=`, the format the framework's REST route reads.
   *
   * 1. Encode the plain JSON, not base64url: it is what the framework owns, and a URL a person
   *    can read and write by hand.
   * 2. Join with `&` when the route already carries its own query (`/projects?tenant_id=acme`).
   */
  function urlFor(base: string, criteria: CriteriaLike<T>): string {
    const joiner = base.includes("?") ? "&" : "?";
    return `${base}${joiner}criteria=${encodeURIComponent(JSON.stringify(plain(criteria)))}`;
  }

  return {
    read: async (criteria, signal) =>
      pageFrom<T>(await call(urlFor(baseUrl, criteria), signal), options.meta ?? null),

    group: async (criteria, signal): Promise<Page<Bucket<T>>> =>
      pageFrom<Bucket<T>>(
        await call(urlFor(groupUrl, criteria), signal),
        options.meta ?? null,
      ),
  };
}
