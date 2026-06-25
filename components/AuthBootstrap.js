"use client";

import { useEffect } from "react";
import { withBasePath } from "@/lib/base-path";

/**
 * AuthBootstrap component that intercepts all fetch calls to /api/*
 * and adds the Authorization header if a session exists in localStorage.
 */
export default function AuthBootstrap() {
    useEffect(() => {
        const originalFetch = window.fetch;
        window.fetch = async (...args) => {
            let [resource, config] = args;

            if (typeof resource === "string" && resource.startsWith("/api/")) {
                resource = withBasePath(resource);
            }

            const isApiCall =
                typeof resource === "string" &&
                (resource.includes("/api/") || resource.startsWith("api/"));

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
