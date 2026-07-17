/**
 * Simple client-side cache utility.
 * Stores data in memory for instant access during navigation
 * and in localStorage for persistence across refreshes.
 */

const memoryCache = new Map();
const freshness = new Map();

export const DataCache = {
    isFresh(key, maxAgeMs = 60_000) {
        const ts = freshness.get(key);
        return Boolean(ts && Date.now() - ts < maxAgeMs);
    },

    markFresh(key) {
        freshness.set(key, Date.now());
    },

    get(key) {
        // 1. Try memory cache first (fastest)
        if (memoryCache.has(key)) {
            return memoryCache.get(key);
        }

        // 2. Try localStorage (persistence)
        if (typeof window !== "undefined") {
            try {
                const stored = localStorage.getItem(`acu_data_${key}`);
                if (stored) {
                    const parsed = JSON.parse(stored);
                    // Hydrate memory cache
                    memoryCache.set(key, parsed);
                    return parsed;
                }
            } catch (err) {
                console.warn("[Cache] Error reading from localStorage", err);
            }
        }

        return null;
    },

    set(key, data, options = {}) {
        // Update memory cache
        memoryCache.set(key, data);
        freshness.set(key, Date.now());

        // Skip localStorage for large payloads (faster reads/writes)
        if (options.persist === false) return;

        // Update localStorage
        if (typeof window !== "undefined") {
            try {
                localStorage.setItem(`acu_data_${key}`, JSON.stringify(data));
            } catch (err) {
                console.warn("[Cache] Error writing to localStorage", err);
                // If quota exceeded, clear old items?
                if (err.name === "QuotaExceededError") {
                    this.clear();
                }
            }
        }
    },

    delete(key) {
        memoryCache.delete(key);
        freshness.delete(key);
        if (typeof window !== "undefined") {
            localStorage.removeItem(`acu_data_${key}`);
        }
    },

    deleteByPrefix(prefix) {
        for (const key of [...memoryCache.keys()]) {
            if (key.startsWith(prefix)) {
                memoryCache.delete(key);
                freshness.delete(key);
            }
        }
        if (typeof window !== "undefined") {
            Object.keys(localStorage)
                .filter((k) => k.startsWith(`acu_data_${prefix}`))
                .forEach((k) => localStorage.removeItem(k));
        }
    },

    clear() {
        memoryCache.clear();
        freshness.clear();
        if (typeof window !== "undefined") {
            Object.keys(localStorage)
                .filter(k => k.startsWith("acu_data_"))
                .forEach(k => localStorage.removeItem(k));
        }
    }
};
