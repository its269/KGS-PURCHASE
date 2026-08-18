"use client";

export const AUTO_SYNC_EVENT = "kgs-auto-sync-status";
const CHANNEL = "kgs-auto-sync";

/**
 * @param {{ running: boolean, progress?: number, section?: string }} payload
 */
export function reportAutoSyncStatus(payload) {
    if (typeof window === "undefined") return;
    const detail = {
        running: Boolean(payload?.running),
        progress: Math.max(0, Math.min(100, Number(payload?.progress) || 0)),
        section: payload?.section || "",
        at: Date.now(),
    };
    try {
        window.dispatchEvent(new CustomEvent(AUTO_SYNC_EVENT, { detail }));
    } catch { /* ignore */ }
    try {
        if (!reportAutoSyncStatus._ch) {
            reportAutoSyncStatus._ch = new BroadcastChannel(CHANNEL);
        }
        reportAutoSyncStatus._ch.postMessage(detail);
    } catch { /* ignore */ }
}

export function subscribeAutoSyncStatus(onChange) {
    if (typeof window === "undefined") return () => {};
    const handler = (e) => onChange(e.detail || e.data || {});
    window.addEventListener(AUTO_SYNC_EVENT, handler);
    let ch = null;
    try {
        ch = new BroadcastChannel(CHANNEL);
        ch.onmessage = handler;
    } catch { /* ignore */ }
    return () => {
        window.removeEventListener(AUTO_SYNC_EVENT, handler);
        try { ch?.close(); } catch { /* ignore */ }
    };
}
