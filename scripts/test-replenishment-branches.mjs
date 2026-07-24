/**
 * Quick multi-branch replenishment API test.
 * Usage: node scripts/test-replenishment-branches.mjs [branch1 branch2 ...]
 */
import dotenv from "dotenv";
import fs from "fs";

dotenv.config({ path: fs.existsSync(".env.local") ? ".env.local" : ".env" });

const basePath = (process.env.NEXT_PUBLIC_BASE_PATH || "").replace(/\/$/, "");
const BASE = basePath ? `http://localhost:3001${basePath}` : "http://localhost:3000";
const branches = process.argv.slice(2).length
    ? process.argv.slice(2)
    : ["ILOILO", "CEBU", "BACOLOD", "MAIN", "DAVAO"];

const user = process.env.ACU_USERNAME || process.env.ACUMATICA_USERNAME;
const pass = process.env.ACU_PASSWORD || process.env.ACUMATICA_PASSWORD;

async function login() {
    const res = await fetch(`${BASE}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: user, password: pass }),
    });
    const cookie = (res.headers.get("set-cookie") || "").match(/acu_session=([^;]+)/)?.[1];
    if (!cookie) throw new Error("Login failed");
    return cookie;
}

console.log(`BASE: ${BASE}\n`);

const cookie = await login();

for (const branch of branches) {
    const t0 = Date.now();
    const res = await fetch(`${BASE}/api/replenishment?branch=${encodeURIComponent(branch)}`, {
        headers: { Cookie: `acu_session=${cookie}` },
    });
    const data = await res.json();
    const ms = Date.now() - t0;
    const count = data.recommendations?.length ?? 0;
    const meta = data.meta || {};
    console.log(
        `${branch}: ${res.status} recs=${count} salesSource=${meta.salesSource} salesMode=${meta.salesMode} salesScope=${meta.salesScope} lookback=${meta.salesLookbackDays} (${ms}ms)`
    );
    if (data.message) console.log(`  error: ${data.message}`);
    if (count > 0) {
        const top = data.recommendations[0];
        console.log(`  top: ${top.itemId} qty=${top.suggestedQty} priority=${top.priorityLevel}`);
    }
}
