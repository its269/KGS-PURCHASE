/**
 * Simple client-side cache utility.
 * Stores data in memory for instant access during navigation
 * and in localStorage for persistence across refreshes.
 */

const memoryCache = new Map();

export const DataCache = {
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

    set(key, data) {
        // Update memory cache
        memoryCache.set(key, data);

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
        if (typeof window !== "undefined") {
            localStorage.removeItem(`acu_data_${key}`);
        }
    },

    clear() {
        memoryCache.clear();
        if (typeof window !== "undefined") {
            Object.keys(localStorage)
                .filter(k => k.startsWith("acu_data_"))
                .forEach(k => localStorage.removeItem(k));
        }
    }
};
