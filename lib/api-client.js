"use client";

import { withBasePath } from "@/lib/base-path";
import { handleSessionExpired, isAuthProbeUrl } from "@/lib/session-client";

/**
 * Client-side API client that automatically includes the session token
 * from localStorage in the Authorization header.
 * On 401, shows an expired-session notice and redirects to sign-in.
 */
export async function fetchWithAuth(url, options = {}) {
    const sessionId = localStorage.getItem("acu_session");
    const headers = {
        ...options.headers,
    };

    if (sessionId) {
        headers["Authorization"] = `Bearer ${sessionId}`;
    }

    const resolvedUrl =
        typeof url === "string" && url.startsWith("/") ? withBasePath(url) : url;

    try {
        const response = await fetch(resolvedUrl, { ...options, headers });

        if (response.status === 401 && !isAuthProbeUrl(String(resolvedUrl))) {
            console.warn("[API Client] Session expired — signing out...");
            handleSessionExpired();
            throw new Error("Unauthorized");
        }

        return response;
    } catch (err) {
        const aborted =
            err?.name === "AbortError" ||
            String(err?.message || "").toLowerCase().includes("abort");
        if (!aborted) {
            console.error(`[API Client Error] ${resolvedUrl}:`, err.message);
        }
        throw err;
    }
}
