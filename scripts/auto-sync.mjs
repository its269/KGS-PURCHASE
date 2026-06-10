import fetch from "node-fetch";
import dotenv from "dotenv";
dotenv.config();

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";
const SYNC_SECRET = process.env.SYNC_SECRET;

async function runAutoSync() {
    console.log(`[Auto-Sync] Starting automated synchronization at ${new Date().toISOString()}`);
    
    if (!SYNC_SECRET) {
        console.error("[Auto-Sync] SYNC_SECRET is not set in environment variables.");
        process.exit(1);
    }

    try {
        // 1. First, we need an active Acumatica session for the server to use.
        // If we want a truly headless sync, the /api/sync route needs a way to 
        // login to Acumatica using system credentials.
        // For now, we assume the server has a valid 'system' session or we provide one.
        
        const res = await fetch(`${BASE_URL}/api/sync?inventory=true&sales=true&mode=incremental`, {
            method: "POST",
            headers: {
                "x-sync-secret": SYNC_SECRET
            }
        });

        if (!res.ok) {
            throw new Error(`Sync API returned ${res.status}: ${await res.text()}`);
        }

        console.log("[Auto-Sync] Sync process started. Streaming results:");

        const body = res.body;
        body.on("data", (chunk) => {
            const lines = chunk.toString().split("\n");
            lines.forEach(line => {
                if (line.trim()) {
                    try {
                        const data = JSON.parse(line);
                        if (data.details) console.log(`  > ${data.details}`);
                        if (data.status === "complete") console.log("[Auto-Sync] SUCCESS: Synchronization complete.");
                        if (data.status === "error") console.error(`[Auto-Sync] ERROR: ${data.message}`);
                    } catch (e) {
                        // Not JSON, probably ping or partial
                    }
                }
            });
        });

        body.on("end", () => {
            console.log("[Auto-Sync] Stream ended.");
        });

    } catch (err) {
        console.error("[Auto-Sync] CRITICAL FAILURE:", err.message);
        process.exit(1);
    }
}

runAutoSync();
