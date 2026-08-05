/**
 * List loading helper — always fetches live (client DataCache is disabled).
 */
export const LIST_CACHE_FRESH_MS = 0;

/**
 * Always refetch from the API / MySQL. `cached` is ignored.
 */
export function loadListWithCache({ refetch }) {
    refetch(false);
}
