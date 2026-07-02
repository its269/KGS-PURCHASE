/**
 * Login verification — local dev or production.
 * Usage: node scripts/verify-login.mjs [baseUrl]
 * Default baseUrl: http://localhost:3000 (dev) or set VERIFY_BASE_URL in .env
 */
import dotenv from "dotenv";
import fs from "fs";

dotenv.config({ path: fs.existsSync(".env.local") ? ".env.local" : ".env" });

const basePath = (process.env.NEXT_PUBLIC_BASE_PATH || "").replace(/\/$/, "");
const defaultBase = process.env.VERIFY_BASE_URL
    || (basePath ? `http://localhost:3001${basePath}` : "http://localhost:3000");
const BASE = (process.argv[2] || defaultBase).replace(/\/$/, "");

const user = process.env.ACU_USERNAME || process.env.ACUMATICA_USERNAME;
const pass = process.env.ACU_PASSWORD || process.env.ACUMATICA_PASSWORD;
const company = process.env.ACU_COMPANY || process.env.ACUMATICA_COMPANY;

if (!user || !pass) {
    console.error("FAIL: Set ACUMATICA_USERNAME/ACUMATICA_PASSWORD or ACU_USERNAME/ACU_PASSWORD in .env");
    process.exit(1);
}

console.log(`=== Login verification ===`);
console.log(`Target: ${BASE}/api/auth/login`);

const loginRes = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: user, password: pass, company }),
});

const body = await loginRes.json().catch(() => ({}));
const setCookie = loginRes.headers.get("set-cookie") || "";
const hasSession = setCookie.includes("acu_session=");

if (!loginRes.ok) {
    console.error(`FAIL: HTTP ${loginRes.status}`, body.message || body);
    process.exit(1);
}

if (!hasSession && !body.sessionId) {
    console.error("FAIL: No acu_session cookie or sessionId in response");
    process.exit(1);
}

console.log("OK  Login API returned success");
console.log(`    sessionId: ${body.sessionId ? body.sessionId.slice(0, 8) + "..." : "(cookie only)"}`);
console.log(`    acu_session cookie: ${hasSession ? "set" : "missing"}`);

const cookie = setCookie.match(/acu_session=([^;]+)/)?.[1] || body.sessionId;
const meRes = await fetch(`${BASE}/api/auth/me`, {
    headers: cookie ? { Cookie: `acu_session=${cookie}` } : {},
});
if (meRes.ok) {
    const me = await meRes.json();
    console.log(`OK  /api/auth/me: ${me.name || me.username || "authenticated"}`);
} else {
    console.warn(`WARN /api/auth/me returned ${meRes.status}`);
}

const companyRes = await fetch(`${BASE}/api/company`, {
    headers: cookie ? { Cookie: `acu_session=${cookie}` } : {},
});
if (companyRes.ok) {
    const data = await companyRes.json();
    console.log(`OK  /api/company: active=${data.activeCompanyId}, companies=${data.companies?.length ?? 0}`);
    for (const c of data.companies || []) {
        console.log(`    - ${c.id}: connected=${c.connected}, virtual=${c.virtual ?? false}`);
    }
} else {
    console.warn(`WARN /api/company returned ${companyRes.status}`);
}

console.log("\nPASS: Login verification complete");
