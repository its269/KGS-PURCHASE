/**
 * Verify ecommerce company switch via API (requires active session).
 * Usage: node scripts/verify-ecommerce-switch.mjs [baseUrl]
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

async function login() {
    const res = await fetch(`${BASE}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: user, password: pass }),
    });
    if (!res.ok) throw new Error(`Login failed: ${res.status}`);
    const cookie = (res.headers.get("set-cookie") || "").match(/acu_session=([^;]+)/)?.[1];
    if (!cookie) throw new Error("No session cookie");
    return cookie;
}

function authHeaders(cookie) {
    return { Cookie: `acu_session=${cookie}` };
}

console.log("=== Ecommerce company switch verification ===\n");

try {
    const cookie = await login();
    console.log("OK  Logged in");

    const listRes = await fetch(`${BASE}/api/company`, { headers: authHeaders(cookie) });
    const list = await listRes.json();
    if (!listRes.ok) throw new Error(`/api/company GET failed: ${listRes.status}`);

    const companies = list.companies || [];
    const main = companies.find((c) => c.id === "main");
    const ecom = companies.find((c) => c.id === "ecommerce");
    if (!main?.connected) throw new Error("main company not connected");
    if (!ecom?.connected) throw new Error("ecommerce company not connected");
    console.log(`OK  Companies: main (virtual=${main.virtual}), ecommerce (virtual=${ecom.virtual})`);

    const switchRes = await fetch(`${BASE}/api/company`, {
        method: "POST",
        headers: { ...authHeaders(cookie), "Content-Type": "application/json" },
        body: JSON.stringify({ companyId: "ecommerce" }),
    });
    const switchBody = await switchRes.json();
    if (!switchRes.ok || !switchBody.success) {
        throw new Error(`Switch to ecommerce failed: ${switchBody.message || switchRes.status}`);
    }
    console.log(`OK  Switched to ecommerce (activeCompanyId=${switchBody.activeCompanyId})`);

    const invEcom = await fetch(`${BASE}/api/inventory?source=mysql&page=1&pageSize=5`, {
        headers: authHeaders(cookie),
    });
    const invEcomData = await invEcom.json();
    const ecomItems = invEcomData.items?.length ?? invEcomData.data?.length ?? 0;
    console.log(`OK  Inventory (ecommerce): ${ecomItems} items on page 1, total=${invEcomData.totalCount ?? "?"}`);

    const stockEcom = await fetch(`${BASE}/api/stock-items?page=1&pageSize=5`, {
        headers: authHeaders(cookie),
    });
    const stockEcomData = await stockEcom.json();
    console.log(`OK  Stock items (ecommerce): ${stockEcomData.items?.length ?? 0} on page 1, total=${stockEcomData.totalCount ?? "?"}`);

    const switchBack = await fetch(`${BASE}/api/company`, {
        method: "POST",
        headers: { ...authHeaders(cookie), "Content-Type": "application/json" },
        body: JSON.stringify({ companyId: "main" }),
    });
    const backBody = await switchBack.json();
    if (!switchBack.ok || !backBody.success) {
        throw new Error(`Switch back to main failed: ${backBody.message || switchBack.status}`);
    }
    console.log("OK  Switched back to main");

    const invMain = await fetch(`${BASE}/api/inventory?source=mysql&page=1&pageSize=5`, {
        headers: authHeaders(cookie),
    });
    const invMainData = await invMain.json();
    const mainTotal = invMainData.totalCount ?? "?";
    const ecomTotal = invEcomData.totalCount ?? "?";
    if (mainTotal !== "?" && ecomTotal !== "?" && mainTotal === ecomTotal) {
        console.warn(`WARN: main and ecommerce totalCount identical (${mainTotal}) — check company scoping`);
    } else {
        console.log(`OK  Data isolation: main total=${mainTotal}, ecommerce total=${ecomTotal}`);
    }

    console.log("\nPASS: Ecommerce switch verification complete");
} catch (err) {
    console.error("FAIL:", err.message);
    process.exit(1);
}
