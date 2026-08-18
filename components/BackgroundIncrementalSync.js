"use client";

import { useEffect, useRef } from "react";
import { fetchWithAuth } from "@/lib/api-client";
import { reportAutoSyncStatus } from "@/lib/auto-sync-status";

const INTERVAL_MS = 10 * 60 * 1000; // 10 minutes
const INITIAL_DELAY_MS = 20 * 1000;
const LOCK_KEY = "acu_auto_sync_lock";
const LOCK_TTL_MS = 9 * 60 * 1000;

/**
 * While anyone is signed in (user or admin), quietly run Quick Sync (incremental)
 * so MySQL stays current with Acumatica. Server 409 prevents overlapping runs.
 */
export default function BackgroundIncrementalSync() {
    const runningRef = useRef(false);

    useEffect(() => {
        if (typeof window === "undefined") return;

        const path = window.location.pathname || "";
        if (path.includes("/signin") || path.includes("/syncing")) return;

        let cancelled = false;
        let intervalId = null;
        let initialTimer = null;

        const hasSession = () => Boolean(localStorage.getItem("acu_session"));

        const acquireLock = () => {
            const now = Date.now();
            try {
                const raw = localStorage.getItem(LOCK_KEY);
                if (raw) {
                    const lock = JSON.parse(raw);
                    if (lock?.ts && now - Number(lock.ts) < LOCK_TTL_MS) {
                        return false;
                    }
                }
                localStorage.setItem(
                    LOCK_KEY,
                    JSON.stringify({ ts: now, owner: Math.random().toString(36).slice(2) })
                );
                return true;
            } catch {
                return true;
            }
        };

        const drainStream = async (res) => {
            if (!res.body) return { ok: res.ok, message: null };
            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            let buffer = "";
            let message = null;
            let failed = false;
            let lastProgress = 0;

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split("\n");
                buffer = lines.pop() || "";
                for (const line of lines) {
                    if (!line.trim()) continue;
                    try {
                        const data = JSON.parse(line);
                        if (data.ping) continue;
                        const p = Number(data.progress);
                        if (Number.isFinite(p)) lastProgress = p;
                        if (data.section || Number.isFinite(p)) {
                            reportAutoSyncStatus({
                                running: true,
                                progress: lastProgress,
                                section: data.section || "",
                            });
                        }
                        if (data.status === "error") {
                            failed = true;
                            message = data.message || "Sync error";
                        }
                        if (data.status === "complete") {
                            message = data.message || "ok";
                            lastProgress = 100;
                            reportAutoSyncStatus({ running: true, progress: 100, section: data.section || "" });
                        }
                    } catch {
                        /* partial NDJSON line */
                    }
                }
            }
            return { ok: res.ok && !failed, message };
        };

        const runQuickSync = async (reason) => {
            if (cancelled || runningRef.current) return;
            if (!hasSession()) return;
            if (document.visibilityState === "hidden") return;
            if (!acquireLock()) return;

            runningRef.current = true;
            reportAutoSyncStatus({ running: true, progress: 4, section: "Quick Sync" });
            try {
                console.log(`[AutoSync] Starting Quick Sync (${reason})…`);
                const res = await fetchWithAuth(
                    "/api/sync?inventory=true&sales=true&mode=incremental",
                    { method: "POST" }
                );

                if (res.status === 409) {
                    console.log("[AutoSync] Skipped — another sync is already running.");
                    reportAutoSyncStatus({ running: true, progress: 8, section: "Syncing" });
                    return;
                }
                if (res.status === 401) {
                    console.warn("[AutoSync] Unauthorized — pausing auto-sync until next cycle.");
                    reportAutoSyncStatus({ running: false, progress: 0 });
                    return;
                }

                const result = await drainStream(res);
                if (result.ok) {
                    console.log("[AutoSync] Quick Sync finished.", result.message || "");
                } else {
                    console.warn("[AutoSync] Quick Sync failed:", result.message || res.status);
                }
            } catch (err) {
                console.warn("[AutoSync] Error:", err?.message || err);
            } finally {
                runningRef.current = false;
                reportAutoSyncStatus({ running: false, progress: 0 });
            }
        };

        initialTimer = setTimeout(() => {
            runQuickSync("online");
            intervalId = setInterval(() => runQuickSync("interval"), INTERVAL_MS);
        }, INITIAL_DELAY_MS);

        const onVisible = () => {
            if (document.visibilityState === "visible") {
                runQuickSync("visible");
            }
        };
        document.addEventListener("visibilitychange", onVisible);

        return () => {
            cancelled = true;
            if (initialTimer) clearTimeout(initialTimer);
            if (intervalId) clearInterval(intervalId);
            document.removeEventListener("visibilitychange", onVisible);
        };
    }, []);

    return null;
}
