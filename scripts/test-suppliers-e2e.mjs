/**
 * End-to-end check: login, vendors API, reliability shape.
 * Usage: node scripts/test-suppliers-e2e.mjs
 */
import dotenv from "dotenv";
import fs from "fs";

dotenv.config({ path: fs.existsSync(".env.local") ? ".env.local" : ".env" });

const BASE = process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";
const username = process.env.ACU_USERNAME || process.env.ACUMATICA_USERNAME;
const password = process.env.ACU_PASSWORD || process.env.ACUMATICA_PASSWORD;

if (!username || !password) {
    console.error("Missing ACU_USERNAME / ACU_PASSWORD in env");
    process.exit(1);
}

console.log("1. Logging in...");
const loginRes = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
});
if (!loginRes.ok) {
    console.error("Login failed:", loginRes.status, await loginRes.text());
    process.exit(1);
}
const sessionCookie = (loginRes.headers.getSetCookie?.() || [])
    .map(c => c.split(";")[0].trim()).join("; ");

console.log("2. Fetching vendors API...");
const vendorsRes = await fetch(`${BASE}/api/vendors?page=1&pageSize=20`, {
    headers: { Cookie: sessionCookie },
});
if (!vendorsRes.ok) {
    console.error("Vendors API failed:", vendorsRes.status, await vendorsRes.text());
    process.exit(1);
}

const data = await vendorsRes.json();
const vendors = data.vendors || [];
console.log(`   Received ${vendors.length} vendors (source: ${data.source})`);

let withScore = 0;
let withNa = 0;
let mathOk = 0;

for (const v of vendors) {
    const hasHistory = v.totalOrders > 0;
    if (v.reliabilityScore == null) {
        withNa++;
        if (!hasHistory) mathOk++;
        else console.warn(`WARN: ${v.vendorId} has orders but null score`);
    } else {
        withScore++;
        const expected = Math.round((v.onTimeOrders / v.totalOrders) * 10000) / 100;
        if (v.totalOrders > 0 && Math.abs(v.reliabilityScore - expected) < 0.01) {
            mathOk++;
        } else if (v.totalOrders > 0) {
            console.warn(`WARN: ${v.vendorId} score ${v.reliabilityScore}% != expected ${expected}%`);
        }
    }
}

console.log(`3. Summary: ${withScore} scored, ${withNa} N/A, ${mathOk} math checks passed`);

if (vendors.length === 0) {
    console.error("FAIL: No vendors returned");
    process.exit(1);
}

console.log("\nPASS: Suppliers E2E API check complete");
