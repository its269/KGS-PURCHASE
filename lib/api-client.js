"use client";

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
    
    try {
        const response = await fetch(url, { ...options, headers });
        
        if (response.status === 401) {
            console.warn("[API Client] 401 Unauthorized detected, redirecting to sign-in...");
            if (typeof window !== "undefined") {
                window.location.href = "/signin";
            }
            throw new Error("Unauthorized");
        }
        
        return response;
    } catch (err) {
        console.error(`[API Client Error] ${url}:`, err.message);
        throw err;
    }
}
