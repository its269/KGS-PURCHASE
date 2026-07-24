import { DataCache } from "@/lib/data-cache";

/** Rows shown on first paint before background prefetch. */
export const INITIAL_PAGE_SIZE = 10;

/**
 * Prefetch remaining paginated API pages into the client cache (fire-and-forget).
 * Skips pages already cached. Returns a cancel function.
 */
export function prefetchRemainingPages({
    startPage = 2,
    pageSize = INITIAL_PAGE_SIZE,
    totalCount,
    cacheKeyForPage,
    fetchPage,
    maxConcurrent = 2,
    onComplete,
}) {
    const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
    if (startPage > totalPages || totalCount <= pageSize) {
        onComplete?.();
        return () => {};
    }

    const abort = { cancelled: false };

    void (async () => {
        const pages = [];
        for (let p = startPage; p <= totalPages; p++) {
            const key = cacheKeyForPage(p);
            if (key && DataCache.get(key)) continue;
            pages.push(p);
        }

        let index = 0;
        async function worker() {
            while (index < pages.length && !abort.cancelled) {
                const p = pages[index++];
                try {
                    await fetchPage(p, { background: true });
                } catch (err) {
                    if (err?.name !== "AbortError") {
                        console.warn(`[prefetch] page ${p} failed`, err);
                    }
                }
            }
        }

        const workers = Array.from(
            { length: Math.min(maxConcurrent, pages.length) },
            () => worker()
        );
        await Promise.all(workers);
        if (!abort.cancelled) onComplete?.();
    })();

    return () => {
        abort.cancelled = true;
    };
}

/**
 * Prefetch pages until the API reports hasMore=false (PO-style pagination).
 * Returns a cancel function.
 */
export function prefetchUntilNoMore({
    startPage = 2,
    fetchPage,
    onComplete,
}) {
    const abort = { cancelled: false };

    void (async () => {
        let p = startPage;
        while (!abort.cancelled) {
            try {
                const data = await fetchPage(p, { background: true });
                if (!data?.hasMore) break;
                p += 1;
            } catch (err) {
                if (err?.name !== "AbortError") {
                    console.warn(`[prefetch] page ${p} failed`, err);
                }
                break;
            }
        }
        if (!abort.cancelled) onComplete?.();
    })();

    return () => {
        abort.cancelled = true;
    };
}
