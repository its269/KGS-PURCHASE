"use client";

import { useEffect, useRef } from "react";

const INTERVAL_MS = 10 * 60 * 1000; // 10 minutes
const INITIAL_DELAY_MS = 45 * 1000; // let the app settle after login
const LOCK_KEY = "acu_auto_sync_lock";
const LOCK_TTL_MS = 9 * 60 * 1000; // avoid multi-tab stampedes

/**
 * While a user is signed in, quietly run Standard Incremental Sync every 10 minutes.
 * Only pulls Acumatica changes since the last MySQL watermark (server-side).
 */
export default function BackgroundIncrementalSync() {
    const runningRef = useRef(false);

    useEffect(() => {
        if (typeof window === "undefined") return;

        const path = window.location.pathname || "";
        if (path.includes("/signin")) return;

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
                        if (data.status === "error") {
                            failed = true;
                            message = data.message || "Sync error";
                        }
                        if (data.status === "complete") {
                            message = data.message || "ok";
                        }
                    } catch {
                        /* partial NDJSON line */
                    }
                }
            }
            return { ok: res.ok && !failed, message };
        };

        const runIncremental = async (reason) => {
            if (cancelled || runningRef.current) return;
            if (!hasSession()) return;
            if (document.visibilityState === "hidden") return;
            if (!acquireLock()) return;

            runningRef.current = true;
            try {
                console.log(`[AutoSync] Starting incremental sync (${reason})…`);
                const res = await fetch(
                    "/api/sync?inventory=true&sales=true&mode=incremental",
                    { method: "POST" }
                );

                if (res.status === 409) {
                    console.log("[AutoSync] Skipped — another sync is already running.");
                    return;
                }
                if (res.status === 401) {
                    console.warn("[AutoSync] Session expired — stopping auto-sync.");
                    return;
                }

                const result = await drainStream(res);
                if (result.ok) {
                    console.log("[AutoSync] Incremental sync finished.", result.message || "");
                } else {
                    console.warn("[AutoSync] Incremental sync failed:", result.message || res.status);
                }
            } catch (err) {
                console.warn("[AutoSync] Error:", err?.message || err);
            } finally {
                runningRef.current = false;
            }
        };

        initialTimer = setTimeout(() => {
            runIncremental("initial");
            intervalId = setInterval(() => runIncremental("interval"), INTERVAL_MS);
        }, INITIAL_DELAY_MS);

        const onVisible = () => {
            if (document.visibilityState === "visible") {
                runIncremental("visible");
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
