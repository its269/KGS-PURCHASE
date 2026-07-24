"use client";

import { withBasePath } from "@/lib/base-path";
import { SESSION_EXPIRED_MESSAGE } from "@/lib/session-messages";

export { SESSION_EXPIRED_MESSAGE };
export const SESSION_STATUS_EVENT = "acu-session-status";

const AUTH_PROBE_PATHS = ["/api/auth/login", "/api/auth/logout", "/api/auth/session"];

export function isAuthProbeUrl(url) {
    const path = typeof url === "string" ? url : "";
    return AUTH_PROBE_PATHS.some((p) => path.includes(p));
}

export function emitSessionStatus(detail) {
    if (typeof window === "undefined") return;
    window.dispatchEvent(new CustomEvent(SESSION_STATUS_EVENT, { detail }));
}

/**
 * Clear client session and send the user to sign-in with an expired notice.
 * Safe to call multiple times — only the first redirect runs.
 */
export function handleSessionExpired(options = {}) {
    if (typeof window === "undefined") return;

    const message = options.message || SESSION_EXPIRED_MESSAGE;
    const delayMs = Number.isFinite(options.delayMs) ? options.delayMs : 1800;

    if (window.__acu_session_expiring) {
        emitSessionStatus({ authenticated: false, expired: true, message });
        return;
    }
    window.__acu_session_expiring = true;

    try {
        localStorage.removeItem("acu_session");
        localStorage.removeItem("userName");
        localStorage.removeItem("userFirstName");
        localStorage.removeItem("userLastName");
        localStorage.removeItem("activeCompanyId");
    } catch {
        // ignore storage errors
    }

    emitSessionStatus({ authenticated: false, expired: true, message });

    window.setTimeout(() => {
        window.location.href = withBasePath("/api/auth/logout?expired=1");
    }, delayMs);
}

/**
 * Probe session via BFF — server validates against Acumatica credentials.
 * Does not trigger the expired redirect itself.
 */
export async function checkSessionStatus() {
    try {
        const res = await fetch(withBasePath("/api/auth/session"), {
            method: "GET",
            credentials: "include",
            cache: "no-store",
            headers: (() => {
                const headers = { Accept: "application/json" };
                try {
                    const sessionId = localStorage.getItem("acu_session");
                    if (sessionId) headers.Authorization = `Bearer ${sessionId}`;
                } catch {
                    // ignore
                }
                return headers;
            })(),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || data.authenticated === false) {
            return {
                authenticated: false,
                expired: true,
                message: data.message || SESSION_EXPIRED_MESSAGE,
                source: data.source || "acumatica",
            };
        }
        return {
            authenticated: true,
            expired: false,
            activeCompanyId: data.activeCompanyId || "main",
            isBypass: !!data.isBypass,
            source: data.source || "acumatica",
            degraded: !!data.degraded,
        };
    } catch {
        // Network blip — keep current UI state; do not force logout
        return {
            authenticated: true,
            expired: false,
            offline: true,
        };
    }
}
