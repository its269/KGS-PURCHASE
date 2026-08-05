/**
 * Lightweight in-memory TTL cache for server-side API hot paths.
 * Tracks hit/miss for performance logging.
 */
const store = new Map();

const stats = {
    hits: 0,
    misses: 0,
};

export function getCacheStats() {
    const total = stats.hits + stats.misses;
    return {
        hits: stats.hits,
        misses: stats.misses,
        hitRate: total ? Number((stats.hits / total).toFixed(3)) : 0,
        size: store.size,
    };
}

export function resetCacheStats() {
    stats.hits = 0;
    stats.misses = 0;
}

export function getCached(key, ttlMs, loader) {
    const hit = store.get(key);
    if (hit && Date.now() - hit.ts < ttlMs) {
        stats.hits += 1;
        return Promise.resolve(hit.value);
    }
    stats.misses += 1;
    return Promise.resolve(loader()).then((value) => {
        // Don't poison the cache with empty/null results
        if (value !== null && value !== undefined) {
            store.set(key, { ts: Date.now(), value });
        }
        return value;
    });
}

export function invalidateCache(prefix) {
    for (const key of store.keys()) {
        if (key.startsWith(prefix)) store.delete(key);
    }
}

/** Log slow async work (SQL loaders, aggregations). Threshold default 100ms. */
export async function timed(label, fn, thresholdMs = 100) {
    const start = Date.now();
    try {
        return await fn();
    } finally {
        const ms = Date.now() - start;
        if (ms >= thresholdMs) {
            console.warn(`[Slow] ${label} took ${ms}ms`);
        }
    }
}
