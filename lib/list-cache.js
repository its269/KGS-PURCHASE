import { DataCache } from "@/lib/data-cache";

/** How long client list caches are considered fresh before a background refetch. */
export const LIST_CACHE_FRESH_MS = 300_000;

/**
 * Show cached list data instantly; only background-refetch when the entry is stale.
 */
export function loadListWithCache({ cacheKey, cached, apply, setLoading, refetch }) {
    if (!cached) {
        refetch(false);
        return;
    }
    apply(cached);
    if (setLoading) setLoading(false);
    if (!DataCache.isFresh(cacheKey, LIST_CACHE_FRESH_MS)) {
        refetch(true);
    }
}
