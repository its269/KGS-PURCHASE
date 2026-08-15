"use client";

/** Dispatched on window when connectivity state changes. */
export const CONNECTION_STATUS_EVENT = "kgs-connection-status";

export const CONNECTION_KIND = {
    OK: "ok",
    INTERNET: "internet",
    SERVER: "server",
};

/**
 * @param {"ok"|"internet"|"server"} kind
 * @param {{ detail?: string }} [extra]
 */
export function reportConnectionStatus(kind, extra = {}) {
    if (typeof window === "undefined") return;
    try {
        window.dispatchEvent(
            new CustomEvent(CONNECTION_STATUS_EVENT, {
                detail: { kind, at: Date.now(), ...extra },
            })
        );
    } catch {
        /* ignore */
    }
}

export function reportInternetDown(detail) {
    reportConnectionStatus(CONNECTION_KIND.INTERNET, { detail });
}

export function reportServerDown(detail) {
    reportConnectionStatus(CONNECTION_KIND.SERVER, { detail });
}

export function reportConnectionOk() {
    reportConnectionStatus(CONNECTION_KIND.OK);
}
