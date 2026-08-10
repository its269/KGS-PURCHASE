"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import {
    SESSION_STATUS_EVENT,
    checkSessionStatus,
} from "@/lib/session-client";
import { fetchWithAuth } from "@/lib/api-client";
import "@/styles/session-status.css";

const POLL_MS = 60_000;
const ONLINE_POLL_MS = 30_000;

function formatLastSeen(iso) {
    if (!iso) return "—";
    const t = new Date(iso).getTime();
    if (!Number.isFinite(t)) return "—";
    const sec = Math.max(0, Math.round((Date.now() - t) / 1000));
    if (sec < 15) return "just now";
    if (sec < 60) return `${sec}s ago`;
    const min = Math.round(sec / 60);
    if (min < 60) return `${min}m ago`;
    return new Date(iso).toLocaleString();
}

function formatOfflineFor(iso) {
    if (!iso) return "Never signed in";
    const t = new Date(iso).getTime();
    if (!Number.isFinite(t)) return "Never signed in";
    const sec = Math.max(0, Math.round((Date.now() - t) / 1000));
    if (sec < 60) return `Offline for ${sec}s`;
    const min = Math.floor(sec / 60);
    if (min < 60) return `Offline for ${min}m`;
    const hr = Math.floor(min / 60);
    const remMin = min % 60;
    if (hr < 24) return remMin ? `Offline for ${hr}h ${remMin}m` : `Offline for ${hr}h`;
    const days = Math.floor(hr / 24);
    if (days < 14) return `Offline for ${days}d`;
    return `Offline since ${new Date(iso).toLocaleDateString()}`;
}

function formatLogTime(iso) {
    if (!iso) return "—";
    try {
        return new Date(iso).toLocaleString();
    } catch {
        return String(iso);
    }
}

function formatDimensionsDetail(detail) {
    if (!detail) return "";
    const raw = String(detail).trim();
    if (!raw.startsWith("{")) return raw;
    try {
        const dims = JSON.parse(raw);
        const parts = [];
        const n = (v) => (v == null || v === "" ? null : Number(v));
        const pcs = n(dims.pcs_per_box);
        const len = n(dims.length_m);
        const h = n(dims.height_m);
        const w = n(dims.width_m);
        const kg = n(dims.weight_kg);
        const cbm = n(dims.cbm);
        if (pcs != null && Number.isFinite(pcs)) parts.push(`Pcs/box ${pcs}`);
        if (len != null && Number.isFinite(len)) parts.push(`L ${len} m`);
        if (h != null && Number.isFinite(h)) parts.push(`H ${h} m`);
        if (w != null && Number.isFinite(w)) parts.push(`W ${w} m`);
        if (kg != null && Number.isFinite(kg)) parts.push(`Weight ${kg} kg`);
        if (cbm != null && Number.isFinite(cbm)) parts.push(`CBM ${cbm}`);
        return parts.length ? parts.join(" · ") : "(no values set)";
    } catch {
        return raw;
    }
}

function describeLog(log) {
    if (log.action === "annotation_save") {
        const mod = log.module || "app";
        const field = log.fieldKey || "field";
        const ref = log.refId || "—";
        const val = log.detail ? ` → ${log.detail}` : "";
        return `Saved ${mod} / ${field} on ${ref}${val}`;
    }
    if (log.action === "dimensions_save") {
        const pretty = formatDimensionsDetail(log.detail);
        return `Updated dimensions for ${log.refId || "item"}${pretty ? ` → ${pretty}` : ""}`;
    }
    if (log.action === "profile_update") return `Updated profile (${log.detail || "fields"})`;
    if (log.action === "login") return "Signed in";
    if (log.action === "logout") return "Signed out";
    if (log.action === "session_active") return log.detail || "Active session";
    return log.detail || log.action || "Activity";
}

function IconClose() {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
    );
}

function IconBack() {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="15 18 9 12 15 6" />
        </svg>
    );
}

/**
 * Session indicator next to the username.
 * Admins: click green dot → online users; click a user → their action/input logs.
 */
export default function SessionStatus({ collapsed = false, userName = "", isAdmin = false }) {
    const pathname = usePathname();
    const [status, setStatus] = useState({
        authenticated: true,
        expired: false,
        checking: true,
        isBypass: false,
    });
    const [onlineOpen, setOnlineOpen] = useState(false);
    const [onlineUsers, setOnlineUsers] = useState([]);
    const [offlineUsers, setOfflineUsers] = useState([]);
    const [onlineWindow, setOnlineWindow] = useState(3);
    const [meId, setMeId] = useState(null);
    const [activityUser, setActivityUser] = useState(null);
    const [activityLogs, setActivityLogs] = useState([]);
    const [activityLoading, setActivityLoading] = useState(false);
    const [activityError, setActivityError] = useState("");

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
        if (next?.user?.id != null) setMeId(Number(next.user.id));
    }, []);

    const probe = useCallback(async () => {
        if (onSigninPage) return;
        const result = await checkSessionStatus();
        applyStatus(result);
    }, [applyStatus, onSigninPage]);

    const loadOnline = useCallback(async () => {
        if (!isAdmin) return;
        try {
            const res = await fetchWithAuth("/api/admin/online");
            if (!res.ok) return;
            const data = await res.json();
            setOnlineUsers(data.online || data.users || []);
            setOfflineUsers(data.offline || []);
            if (data.windowMinutes) setOnlineWindow(data.windowMinutes);
        } catch {
            /* ignore */
        }
    }, [isAdmin]);

    const loadActivity = useCallback(async (user) => {
        if (!user?.id) return;
        setActivityUser(user);
        setActivityLoading(true);
        setActivityError("");
        setActivityLogs([]);
        try {
            const res = await fetchWithAuth(`/api/admin/users/${user.id}/activity?limit=100`);
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.message || "Failed to load activity");
            setActivityLogs(data.logs || []);
            if (data.user) setActivityUser(data.user);
        } catch (err) {
            setActivityError(err.message || "Failed to load activity");
        } finally {
            setActivityLoading(false);
        }
    }, []);

    const closeLightbox = () => {
        setOnlineOpen(false);
        setActivityUser(null);
        setActivityLogs([]);
        setActivityError("");
    };

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

    useEffect(() => {
        if (!isAdmin || onSigninPage) return undefined;
        loadOnline();
        const id = window.setInterval(loadOnline, ONLINE_POLL_MS);
        return () => window.clearInterval(id);
    }, [isAdmin, onSigninPage, loadOnline]);

    useEffect(() => {
        if (!onlineOpen) return undefined;
        const onKey = (e) => {
            if (e.key === "Escape") {
                if (activityUser) {
                    setActivityUser(null);
                    setActivityLogs([]);
                    setActivityError("");
                } else {
                    closeLightbox();
                }
            }
        };
        window.addEventListener("keydown", onKey);
        const prev = document.body.style.overflow;
        document.body.style.overflow = "hidden";
        return () => {
            window.removeEventListener("keydown", onKey);
            document.body.style.overflow = prev;
        };
    }, [onlineOpen, activityUser]);

    if (onSigninPage) return null;

    const tooltip = status.checking
        ? "Checking session…"
        : status.authenticated
            ? "Signed in"
            : "Not signed in";

    const stateClass = status.checking
        ? "is-checking"
        : status.authenticated
            ? "is-ok"
            : "is-expired";

    const openOnline = (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!isAdmin) return;
        setActivityUser(null);
        setActivityLogs([]);
        setActivityError("");
        setOnlineOpen(true);
        loadOnline();
    };

    const activityTitle = activityUser
        ? `${activityUser.fullName || activityUser.username}'s activity`
        : "Online users";

    return (
        <>
            <div
                className={`sidebar-user-header session-user ${stateClass} ${collapsed ? "is-collapsed" : ""}`}
                title={tooltip}
                role="status"
                aria-live="polite"
                aria-label={tooltip}
            >
                {isAdmin ? (
                    <button
                        type="button"
                        className="session-status-dot-btn"
                        aria-label="Online users"
                        title="Online users"
                        onClick={openOnline}
                    >
                        <span className="session-status-dot" aria-hidden="true" />
                    </button>
                ) : (
                    <span className="session-status-dot" aria-hidden="true" />
                )}
                {!collapsed && (
                    <span className="sidebar-user-name">{userName || "User"}</span>
                )}
            </div>

            {isAdmin && onlineOpen && (
                <div
                    className="session-online-lightbox"
                    role="presentation"
                    onClick={closeLightbox}
                >
                    <div
                        className="session-online-lightbox-panel session-online-lightbox-panel--wide"
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="session-online-dialog-title"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="session-online-lightbox-head">
                            <div className="session-online-lightbox-titles">
                                {activityUser && (
                                    <button
                                        type="button"
                                        className="session-online-back"
                                        onClick={() => {
                                            setActivityUser(null);
                                            setActivityLogs([]);
                                            setActivityError("");
                                        }}
                                    >
                                        <IconBack />
                                        Back
                                    </button>
                                )}
                                <h2 id="session-online-dialog-title">{activityTitle}</h2>
                                <p className="session-online-hint">
                                    {activityUser
                                        ? "Saved inputs and other recorded actions for this account."
                                        : `Online = active in the last ${onlineWindow} minutes. Offline users show how long they have been away. Click a user for action logs.`}
                                </p>
                            </div>
                            <button
                                type="button"
                                className="session-online-lightbox-close"
                                aria-label="Close"
                                onClick={closeLightbox}
                            >
                                <IconClose />
                            </button>
                        </div>

                        {activityUser ? (
                            <div className="session-activity-body">
                                {activityLoading && (
                                    <p className="session-online-empty">Loading activity…</p>
                                )}
                                {!activityLoading && activityError && (
                                    <p className="session-online-empty session-online-empty--error">
                                        {activityError}
                                    </p>
                                )}
                                {!activityLoading && !activityError && activityLogs.length === 0 && (
                                    <p className="session-online-empty">
                                        No activity logged yet. Save a PO field, stock-item dimensions, or sign in again — new actions will appear here.
                                    </p>
                                )}
                                {!activityLoading && !activityError && activityLogs.length > 0 && (
                                    <ul className="session-activity-list">
                                        {activityLogs.map((log) => (
                                            <li key={log.id} className="session-activity-item">
                                                <div className="session-activity-main">
                                                    <span className="session-activity-desc">
                                                        {describeLog(log)}
                                                    </span>
                                                    <span className="session-activity-meta">
                                                        {log.action}
                                                        {log.module ? ` · ${log.module}` : ""}
                                                    </span>
                                                </div>
                                                <time
                                                    className="session-activity-time"
                                                    dateTime={log.createdAt || undefined}
                                                >
                                                    {formatLogTime(log.createdAt)}
                                                </time>
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </div>
                        ) : onlineUsers.length === 0 && offlineUsers.length === 0 ? (
                            <p className="session-online-empty">No users to show.</p>
                        ) : (
                            <div className="session-presence-body">
                                <section className="session-online-section" aria-label="Online users">
                                    <h3 className="session-online-section-title">
                                        Online ({onlineUsers.length})
                                    </h3>
                                    {onlineUsers.length === 0 ? (
                                        <p className="session-online-empty">No users online right now.</p>
                                    ) : (
                                        <ul className="session-online-list">
                                            {onlineUsers.map((u) => (
                                                <li key={u.id}>
                                                    <button
                                                        type="button"
                                                        className="session-online-item session-online-item--btn"
                                                        onClick={() => loadActivity(u)}
                                                    >
                                                        <span className="session-online-dot" aria-hidden="true" />
                                                        <div className="session-online-meta">
                                                            <span className="session-online-name">
                                                                {u.fullName || u.username}
                                                                {meId === u.id ? (
                                                                    <span className="session-online-you"> (you)</span>
                                                                ) : null}
                                                            </span>
                                                            <span className="session-online-user">@{u.username}</span>
                                                            <span className="session-online-sub">
                                                                <span className={`session-online-role session-online-role--${u.role}`}>
                                                                    {u.role}
                                                                </span>
                                                                {" · "}
                                                                {u.activeCompanyId || "main"}
                                                                {" · "}
                                                                Last seen {formatLastSeen(u.lastSeenAt)}
                                                            </span>
                                                        </div>
                                                    </button>
                                                </li>
                                            ))}
                                        </ul>
                                    )}
                                </section>
                                <section className="session-online-section" aria-label="Offline users">
                                    <h3 className="session-online-section-title">
                                        Offline ({offlineUsers.length})
                                    </h3>
                                    {offlineUsers.length === 0 ? (
                                        <p className="session-online-empty">Everyone is online.</p>
                                    ) : (
                                        <ul className="session-online-list">
                                            {offlineUsers.map((u) => (
                                                <li key={u.id}>
                                                    <button
                                                        type="button"
                                                        className="session-online-item session-online-item--btn session-online-item--offline"
                                                        onClick={() => loadActivity(u)}
                                                    >
                                                        <span
                                                            className="session-online-dot session-online-dot--offline"
                                                            aria-hidden="true"
                                                        />
                                                        <div className="session-online-meta">
                                                            <span className="session-online-name">
                                                                {u.fullName || u.username}
                                                                {meId === u.id ? (
                                                                    <span className="session-online-you"> (you)</span>
                                                                ) : null}
                                                            </span>
                                                            <span className="session-online-user">@{u.username}</span>
                                                            <span className="session-online-sub">
                                                                <span className={`session-online-role session-online-role--${u.role}`}>
                                                                    {u.role}
                                                                </span>
                                                                {" · "}
                                                                {u.activeCompanyId || "main"}
                                                            </span>
                                                            <span className="session-online-offline-for">
                                                                <span className="session-online-offline-badge">Offline</span>
                                                                {" · "}
                                                                {formatOfflineFor(u.lastSeenAt).replace(/^Offline for /i, "Away for ").replace(/^Offline since /i, "Last seen ")}
                                                            </span>
                                                        </div>
                                                    </button>
                                                </li>
                                            ))}
                                        </ul>
                                    )}
                                </section>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </>
    );
}
