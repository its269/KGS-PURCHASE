/**
 * Headless Acumatica sync via SYNC_SECRET.
 * Usage: node scripts/auto-sync.mjs
 * Env: SYNC_SECRET (required), SYNC_MODE=incremental|delta|full (default incremental),
 *      NEXT_PUBLIC_BASE_URL or NEXT_PUBLIC_BASE_PATH for URL resolution.
 */
import fetch from "node-fetch";
import dotenv from "dotenv";
import fs from "fs";

dotenv.config({ path: fs.existsSync(".env.local") ? ".env.local" : ".env" });

function resolveBaseUrl() {
    const explicit = process.env.SYNC_BASE_URL;
    if (explicit) return explicit.replace(/\/$/, "");

    const baseUrl = (process.env.NEXT_PUBLIC_BASE_URL || "").replace(/\/$/, "");
    const basePath = (process.env.NEXT_PUBLIC_BASE_PATH || "").replace(/\/$/, "");

    if (baseUrl && basePath && !baseUrl.endsWith(basePath)) {
        return `${baseUrl}${basePath}`;
    }
    if (baseUrl) return baseUrl;

    if (basePath) return `http://localhost:3001${basePath}`;
    return "http://localhost:3000";
}

const BASE_URL = resolveBaseUrl();
const SYNC_SECRET = process.env.SYNC_SECRET;
const SYNC_MODE = process.env.SYNC_MODE || "incremental";

async function runAutoSync() {
    console.log(`[Auto-Sync] Starting at ${new Date().toISOString()}`);
    console.log(`[Auto-Sync] Target: ${BASE_URL}/api/sync?inventory=true&sales=true&mode=${SYNC_MODE}`);

    if (!SYNC_SECRET) {
        console.error("[Auto-Sync] SYNC_SECRET is not set in environment variables.");
        process.exit(1);
    }

    const url = `${BASE_URL}/api/sync?inventory=true&sales=true&mode=${encodeURIComponent(SYNC_MODE)}`;

    try {
        const res = await fetch(url, {
            method: "POST",
            headers: { "x-sync-secret": SYNC_SECRET },
        });

        if (!res.ok) {
            throw new Error(`Sync API returned ${res.status}: ${await res.text()}`);
        }

        console.log("[Auto-Sync] Streaming results:");

        let complete = false;
        let errorMsg = null;

        await new Promise((resolve, reject) => {
            const body = res.body;
            body.on("data", (chunk) => {
                const lines = chunk.toString().split("\n");
                for (const line of lines) {
                    if (!line.trim()) continue;
                    try {
                        const data = JSON.parse(line);
                        if (data.details) console.log(`  > ${data.details}`);
                        if (data.status === "complete") {
                            complete = true;
                            console.log("[Auto-Sync] SUCCESS: Synchronization complete.");
                        }
                        if (data.status === "error") {
                            errorMsg = data.message || "Unknown sync error";
                            console.error(`[Auto-Sync] ERROR: ${errorMsg}`);
                        }
                    } catch {
                        // partial line
                    }
                }
            });
            body.on("end", resolve);
            body.on("error", reject);
        });

        if (errorMsg) {
            process.exit(1);
        }
        if (!complete) {
            console.warn("[Auto-Sync] Stream ended without complete status.");
        }
    } catch (err) {
        console.error("[Auto-Sync] CRITICAL FAILURE:", err.message);
        process.exit(1);
    }
}

runAutoSync();
