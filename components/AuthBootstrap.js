"use client";

import { useEffect } from "react";

/**
 * AuthBootstrap component that intercepts all fetch calls to /api/* 
 * and adds the Authorization header if a session exists in localStorage.
 * This effectively removes the need for cookie-based auth on the client.
 */
export default function AuthBootstrap() {
    useEffect(() => {
        const originalFetch = window.fetch;
        window.fetch = async (...args) => {
            let [resource, config] = args;

            // Only intercept relative /api/ calls
            const isApiCall = typeof resource === 'string' && (resource.startsWith('/api/') || resource.startsWith('api/'));
            
            if (isApiCall) {
                const sessionId = localStorage.getItem("acu_session");
                if (sessionId) {
                    config = config || {};
                    const headers = config.headers || {};

                    if (headers instanceof Headers) {
                        if (!headers.has("Authorization")) {
                            headers.set("Authorization", `Bearer ${sessionId}`);
                        }
                    } else if (Array.isArray(headers)) {
                        if (!headers.some(([k]) => k.toLowerCase() === "authorization")) {
                            headers.push(["Authorization", `Bearer ${sessionId}`]);
                        }
                    } else {
                        if (!headers["Authorization"] && !headers["authorization"]) {
                            headers["Authorization"] = `Bearer ${sessionId}`;
                        }
                    }
                    config.headers = headers;
                }
            }
            return originalFetch(resource, config);
        };

        return () => {
            window.fetch = originalFetch;
        };
    }, []);

    return null;
}
