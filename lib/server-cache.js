/**
 * Lightweight in-memory TTL cache for server-side API hot paths.
 */
const store = new Map();

export function getCached(key, ttlMs, loader) {
    const hit = store.get(key);
    if (hit && Date.now() - hit.ts < ttlMs) {
        return Promise.resolve(hit.value);
    }
    return Promise.resolve(loader()).then((value) => {
        store.set(key, { ts: Date.now(), value });
        return value;
    });
}

export function invalidateCache(prefix) {
    for (const key of store.keys()) {
        if (key.startsWith(prefix)) store.delete(key);
    }
}
