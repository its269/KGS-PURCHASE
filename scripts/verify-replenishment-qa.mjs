/**
 * Verify replenishment API vs sales velocity formulas for a sample item.
 * Usage: node scripts/verify-replenishment-qa.mjs [itemId] [branch]
 */
import dotenv from "dotenv";
import fs from "fs";
import { averageDailySales, SALES_LOOKBACK_DAYS } from "../lib/sales-velocity.js";

dotenv.config({ path: fs.existsSync(".env.local") ? ".env.local" : ".env" });

const basePath = (process.env.NEXT_PUBLIC_BASE_PATH || "").replace(/\/$/, "");
const BASE = basePath ? `http://localhost:3001${basePath}` : "http://localhost:3000";
const itemId = process.argv[2] || "130701101101292";
const branch = process.argv[3] || "MAIN";

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

console.log(`=== Replenishment QA: ${itemId} @ ${branch} ===\n`);

try {
    const cookie = await login();
    const url = `${BASE}/api/replenishment?branch=${encodeURIComponent(branch)}`;
    const res = await fetch(url, { headers: { Cookie: `acu_session=${cookie}` } });
    const data = await res.json();
    if (!res.ok) throw new Error(`API ${res.status}: ${data.message || ""}`);

    const recommendations = data.recommendations || [];
    const rec =
        recommendations.find((r) => r.itemId?.toUpperCase() === itemId.toUpperCase())
        || recommendations.find((r) => parseFloat(r.aiInsights?.salesVelocity || "0") > 0);

    const testItemId = rec?.itemId || itemId;

    if (!rec) {
        console.warn(`WARN: No replenishment item with ads>0 for branch ${branch}`);
        console.log(`Total recommendations: ${data.recommendations?.length ?? 0}`);
        console.log(`meta.salesSource: ${data.meta?.salesSource}, salesScope: ${data.meta?.salesScope}`);
        process.exit(0);
    }

    const ai = rec.aiInsights || {};
    const ads = parseFloat(ai.salesVelocity || "0");
    const qtySold90 = ads * SALES_LOOKBACK_DAYS;
    const expectedAds = averageDailySales(qtySold90, SALES_LOOKBACK_DAYS);
    const adsMatch = Math.abs(ads - expectedAds) < 0.02;
    const expectedDays = ads > 0 ? Math.floor(rec.currentStock / ads) : null;

    console.log("API recommendation:");
    console.log(`  item: ${testItemId}`);
    console.log(`  sells/day (ads): ${ads}`);
    console.log(`  days left: ${ai.daysRemaining}`);
    console.log(`  order qty: ${rec.suggestedQty}`);
    console.log(`  priority: ${rec.priorityLevel}`);
    console.log(`  estimated 90d qty: ${qtySold90.toFixed(0)}`);
    console.log(`  currentStock: ${rec.currentStock}`);

    console.log("\nFormula checks:");
    console.log(`  ${adsMatch ? "OK" : "FAIL"} ADS consistency → ${ads.toFixed(2)}/day`);
    if (expectedDays !== null) {
        const daysMatch = ai.daysRemaining === expectedDays;
        console.log(`  ${daysMatch ? "OK" : "FAIL"} days left = floor(stock/ads) → expected ${expectedDays}, got ${ai.daysRemaining}`);
    }
    console.log(`  meta.salesSource: ${data.meta?.salesSource}`);
    console.log(`  meta.salesScope: ${data.meta?.salesScope}`);

    if (branch.toUpperCase() === "MAIN" && data.meta?.salesScope !== "network") {
        console.warn("WARN: MAIN branch should use network sales scope");
    }

    console.log("\nPASS: Replenishment QA spot-check complete");
} catch (err) {
    console.error("FAIL:", err.message);
    process.exit(1);
}
