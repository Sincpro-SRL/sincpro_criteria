import type { CriteriaFor } from "@sincpro/criteria";
import { pack, plain } from "@sincpro/criteria";

/**
 * A cache key for a criteria, under a prefix of the caller's choosing.
 *
 * Two criteria that ask the same question pack to the same string regardless of key order or
 * object identity, so this is safe to use as a `queryKey`/`SWRKey` directly: the same filter
 * built twice hits the same cache entry, and a different one is a different entry.
 *
 * @example
 * useQuery({
 *   queryKey: queryKeyFor(["catalog", "datasets"], criteria),
 *   queryFn: ({ signal }) => datasets.page(criteria, signal),
 * });
 */
export function queryKeyFor<T>(
  prefix: readonly unknown[],
  criteria: CriteriaFor<T> = {},
): readonly [...unknown[], string] {
  return [...prefix, pack(plain(criteria))];
}
