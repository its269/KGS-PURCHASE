"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import {
    SESSION_STATUS_EVENT,
    checkSessionStatus,
} from "@/lib/session-client";
import "@/styles/session-status.css";

const POLL_MS = 60_000;

/**
 * Session indicator next to the username.
 * Never auto-logs the user out — Logout is the only way to end a session.
 */
export default function SessionStatus({ collapsed = false, userName = "" }) {
    const pathname = usePathname();
    const [status, setStatus] = useState({
        authenticated: true,
        expired: false,
        checking: true,
        isBypass: false,
    });

    const onSigninPage =
        typeof pathname === "string" &&
        (pathname.endsWith("/signin") || pathname.includes("/signin"));

    const applyStatus = useCallback((next) => {
        setStatus({
            authenticated: next.authenticated !== false,
            expired: false,
            checking: false,
            message: next.message,
            isBypass: !!next.isBypass,
            source: next.source,
            degraded: !!next.degraded,
        });
    }, []);

    const probe = useCallback(async () => {
        if (onSigninPage) return;
        const result = await checkSessionStatus();
        applyStatus(result);
    }, [applyStatus, onSigninPage]);

    useEffect(() => {
        if (onSigninPage) return undefined;

        probe();

        const onStatus = (e) => applyStatus(e.detail || {});
        window.addEventListener(SESSION_STATUS_EVENT, onStatus);

        const interval = window.setInterval(() => {
            probe();
        }, POLL_MS);

        const onVis = () => {
            if (document.visibilityState === "visible") {
                probe();
            }
        };
        document.addEventListener("visibilitychange", onVis);

        return () => {
            window.removeEventListener(SESSION_STATUS_EVENT, onStatus);
            window.clearInterval(interval);
            document.removeEventListener("visibilitychange", onVis);
        };
    }, [onSigninPage, probe, applyStatus]);

    if (onSigninPage) return null;

    const tooltip = status.checking
        ? "Checking session…"
        : status.authenticated
            ? (status.isBypass || status.degraded ? "Signed in" : "Signed in")
            : "Not signed in";

    const stateClass = status.checking
        ? "is-checking"
        : status.authenticated
            ? "is-ok"
            : "is-expired";

    return (
        <div
            className={`sidebar-user-header session-user ${stateClass} ${collapsed ? "is-collapsed" : ""}`}
            title={tooltip}
            role="status"
            aria-live="polite"
            aria-label={tooltip}
        >
            <span className="session-status-dot" aria-hidden="true" />
            {!collapsed && (
                <span className="sidebar-user-name">{userName || "User"}</span>
            )}
        </div>
    );
}
