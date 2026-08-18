"use client";

import { useEffect, useState } from "react";
import { fetchWithAuth } from "@/lib/api-client";
import { subscribeAutoSyncStatus } from "@/lib/auto-sync-status";

const POLL_MS = 4000;

/**
 * Super-thin full-width divider between collapse and version.
 * Idle = plain border color. Running = green fill as auto Quick Sync progresses.
 */
export default function AutoSyncIndicator({ collapsed = false }) {
    const [running, setRunning] = useState(false);
    const [progress, setProgress] = useState(0);

    useEffect(() => {
        let cancelled = false;

        const apply = (detail) => {
            if (cancelled || !detail) return;
            setRunning(Boolean(detail.running));
            setProgress(Math.max(0, Math.min(100, Number(detail.progress) || 0)));
        };

        const unsubscribe = subscribeAutoSyncStatus(apply);

        const poll = async () => {
            try {
                const res = await fetchWithAuth("/api/sync?status=1");
                if (!res.ok || cancelled) return;
                const data = await res.json();
                apply(data);
            } catch {
                /* ignore */
            }
        };

        poll();
        const id = setInterval(poll, POLL_MS);
        return () => {
            cancelled = true;
            clearInterval(id);
            unsubscribe();
        };
    }, []);

    const pct = running ? Math.max(8, progress) : 0;
    const title = running
        ? `Auto Quick Sync running${progress ? ` (${Math.round(progress)}%)` : ""}`
        : "Auto sync idle";

    return (
        <div
            className={`sidebar-autosync ${running ? "is-running" : "is-idle"} ${collapsed ? "is-collapsed" : ""}`}
            role="progressbar"
            aria-label={title}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={running ? Math.round(progress) : 0}
            title={title}
        >
            <span className="sidebar-autosync-fill" style={{ width: `${pct}%` }} />
        </div>
    );
}
