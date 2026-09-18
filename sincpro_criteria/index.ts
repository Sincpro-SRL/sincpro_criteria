/**
 * `@sincpro/criteria` — the read grammar of the Sincpro engine, in TypeScript.
 *
 * What a caller sends (`Criteria`), what the answer carries back (`Meta`, `Count`,
 * `Dropped`, `Bucket`), and the pure functions that work on both: build one, merge two, put
 * one in a URL, check it against a model, print it.
 *
 * No transport, no framework, no dependencies. Where the rows come from is somebody else's
 * business.
 *
 * @example
 * import { criteria, eq, gt, pack } from "@sincpro/criteria";
 *
 * const q = criteria<Dataset>()
 *   .where(eq("encoding", "utf-8"), gt("row_count", 1000))
 *   .order("-registered_at")
 *   .limit(100);
 *
 * const answer = await fetch(`/datasets?criteria=${pack(q)}`).then((r) => r.json());
 *
 * @module
 */

export * from "@sincpro/criteria/criteria";
export * from "@sincpro/criteria/engine";
export * from "@sincpro/criteria/explain";
export * from "@sincpro/criteria/meta";
export * from "@sincpro/criteria/page";
export * from "@sincpro/criteria/reading";
export * from "@sincpro/criteria/source";
export * from "@sincpro/criteria/validate";
