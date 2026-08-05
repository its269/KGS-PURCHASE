/**
 * Client data cache — DISABLED.
 * List/detail screens always load live MySQL via the API (no memory / localStorage reuse).
 * clear() still wipes any leftover `acu_data_*` keys from older builds.
 */

function purgePersistedEntries() {
    if (typeof window === "undefined") return;
    try {
        Object.keys(localStorage)
            .filter((k) => k.startsWith("acu_data_"))
            .forEach((k) => localStorage.removeItem(k));
    } catch (err) {
        console.warn("[Cache] Error clearing localStorage", err);
    }
}

if (typeof window !== "undefined") {
    purgePersistedEntries();
}

export const DataCache = {
    isFresh() {
        return false;
    },

    markFresh() {},

    get() {
        return null;
    },

    set() {},

    delete() {},

    deleteByPrefix() {
        purgePersistedEntries();
    },

    clear() {
        purgePersistedEntries();
    },
};
