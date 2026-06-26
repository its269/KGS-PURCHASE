"use client";

import { withBasePath } from "@/lib/base-path";

/**
 * Client-side API client that automatically includes the session token
 * from localStorage in the Authorization header.
 * Automatically handles 401 Unauthorized by redirecting to sign-in.
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

        if (response.status === 401) {
            console.warn("[API Client] 401 Unauthorized detected, redirecting to sign-in...");
            if (typeof window !== "undefined") {
                window.location.href = withBasePath("/signin");
            }
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
