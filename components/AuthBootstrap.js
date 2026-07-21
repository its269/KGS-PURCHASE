"use client";

import { useEffect } from "react";
import { withBasePath } from "@/lib/base-path";
import { handleSessionExpired, isAuthProbeUrl } from "@/lib/session-client";

/**
 * AuthBootstrap intercepts fetch calls to /api/*:
 * - Adds Authorization from localStorage
 * - On 401 (except auth probes), shows expired notice and redirects to sign-in
 */
export default function AuthBootstrap() {
    useEffect(() => {
        const originalFetch = window.fetch;
        window.fetch = async (...args) => {
            let [resource, config] = args;

            if (typeof resource === "string" && resource.startsWith("/api/")) {
                resource = withBasePath(resource);
            }

            const urlStr =
                typeof resource === "string"
                    ? resource
                    : resource instanceof Request
                        ? resource.url
                        : String(resource || "");

            const isApiCall = urlStr.includes("/api/");

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

            const response = await originalFetch(resource, config);

            if (
                isApiCall &&
                response.status === 401 &&
                !isAuthProbeUrl(urlStr)
            ) {
                handleSessionExpired();
            }

            return response;
        };

        return () => {
            window.fetch = originalFetch;
        };
    }, []);

    return null;
}
