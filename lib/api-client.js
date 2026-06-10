"use client";

/**
 * Client-side API client that automatically includes the session token 
 * from localStorage in the Authorization header.
 */
export async function fetchWithAuth(url, options = {}) {
    const sessionId = localStorage.getItem("acu_session");
    const headers = {
        ...options.headers,
    };
    
    if (sessionId) {
        headers["Authorization"] = `Bearer ${sessionId}`;
    }
    
    return fetch(url, { ...options, headers });
}
