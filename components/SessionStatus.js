"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import {
    SESSION_STATUS_EVENT,
    SESSION_EXPIRED_MESSAGE,
    checkSessionStatus,
    handleSessionExpired,
} from "@/lib/session-client";
import { withBasePath } from "@/lib/base-path";
import "@/styles/session-status.css";

const POLL_MS = 60_000;

/**
 * Session indicator: animated status dot to the left of the username.
 * Also shows a blocking notice when the Acumatica session expires.
 */
export default function SessionStatus({ collapsed = false, userName = "" }) {
    const pathname = usePathname();
    const [status, setStatus] = useState({
        authenticated: true,
        expired: false,
        checking: true,
        isBypass: false,
    });
    const [banner, setBanner] = useState(null);

    const onSigninPage =
        typeof pathname === "string" &&
        (pathname.endsWith("/signin") || pathname.includes("/signin"));

    const applyStatus = useCallback((next) => {
        setStatus({
            authenticated: !!next.authenticated,
            expired: !!next.expired,
            checking: false,
            message: next.message,
            isBypass: !!next.isBypass,
            source: next.source,
        });
        if (next.expired && !onSigninPage) {
            setBanner(next.message || SESSION_EXPIRED_MESSAGE);
        }
    }, [onSigninPage]);

    const probe = useCallback(async ({ redirectOnFail = false } = {}) => {
        if (onSigninPage) return;
        const result = await checkSessionStatus();
        applyStatus(result);
        if (result.expired && redirectOnFail) {
            handleSessionExpired({ message: result.message || SESSION_EXPIRED_MESSAGE });
        }
    }, [applyStatus, onSigninPage]);

    useEffect(() => {
        if (onSigninPage) return undefined;

        probe({ redirectOnFail: true });

        const onStatus = (e) => applyStatus(e.detail || {});
        window.addEventListener(SESSION_STATUS_EVENT, onStatus);

        const interval = window.setInterval(() => {
            probe({ redirectOnFail: true });
        }, POLL_MS);

        const onVis = () => {
            if (document.visibilityState === "visible") {
                probe({ redirectOnFail: true });
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
        ? "Checking Acumatica session…"
        : status.authenticated
            ? (status.isBypass ? "Signed in (offline mode)" : "Acumatica session active")
            : "Acumatica session expired";

    const stateClass = status.checking
        ? "is-checking"
        : status.authenticated
            ? "is-ok"
            : "is-expired";

    return (
        <>
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

            {banner && (
                <div
                    className="session-expired-overlay"
                    role="alertdialog"
                    aria-modal="true"
                    aria-labelledby="session-expired-title"
                >
                    <div className="session-expired-card">
                        <h2 id="session-expired-title">Session expired</h2>
                        <p>{banner}</p>
                        <button
                            type="button"
                            className="session-expired-btn"
                            onClick={() => {
                                window.location.href = withBasePath("/api/auth/logout?expired=1");
                            }}
                        >
                            Sign in again
                        </button>
                        <p className="session-expired-hint">Redirecting you to the sign-in page…</p>
                    </div>
                </div>
            )}
        </>
    );
}
