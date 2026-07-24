/**
 * Verify PO annotations API (ETA / user status persistence).
 * Usage: node scripts/verify-po-annotations.mjs [baseUrl]
 */
import dotenv from "dotenv";
import fs from "fs";

dotenv.config({ path: fs.existsSync(".env.local") ? ".env.local" : ".env" });

const basePath = (process.env.NEXT_PUBLIC_BASE_PATH || "").replace(/\/$/, "");
const BASE = (process.argv[2] || (basePath ? `http://localhost:3001${basePath}` : "http://localhost:3000")).replace(/\/$/, "");

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

console.log("=== PO annotations verification ===\n");

try {
    const cookie = await login();
    const headers = { Cookie: `acu_session=${cookie}`, "Content-Type": "application/json" };

    const poRes = await fetch(`${BASE}/api/po?page=1&pageSize=1&status=Open`, { headers });
    const poData = await poRes.json();
    const order = poData.orders?.[0];
    if (!order) {
        console.warn("WARN: No open POs to test — skipping annotation write");
        process.exit(0);
    }

    const key = `${order.orderType}-${order.orderNbr}`;
    const testEta = "2026-07-15";
    const testStatus = "In Transit";

    console.log(`Testing PO: ${key}`);

    const saveRes = await fetch(`${BASE}/api/annotations`, {
        method: "POST",
        headers,
        body: JSON.stringify({
            module: "po",
            refId: key,
            fieldKey: "eta",
            fieldValue: testEta,
        }),
    });
    if (!saveRes.ok) throw new Error(`Save ETA failed: ${saveRes.status} ${await saveRes.text()}`);

    const statusRes = await fetch(`${BASE}/api/annotations`, {
        method: "POST",
        headers,
        body: JSON.stringify({
            module: "po",
            refId: key,
            fieldKey: "userStatus",
            fieldValue: testStatus,
        }),
    });
    if (!statusRes.ok) throw new Error(`Save status failed: ${statusRes.status} ${await statusRes.text()}`);
    console.log("OK  Saved ETA and user status");

    const loadRes = await fetch(`${BASE}/api/annotations?module=po`, { headers });
    const saved = await loadRes.json();
    if (!saved[key] || saved[key].eta !== testEta || saved[key].userStatus !== testStatus) {
        throw new Error(`Reload mismatch: ${JSON.stringify(saved[key])}`);
    }
    console.log("OK  Annotations persist after reload");

    const incRes = await fetch(`${BASE}/api/po?page=1&pageSize=5&status=Open`, { headers });
    const incData = await incRes.json();
    console.log(`OK  Incoming PO API: ${incData.orders?.length ?? 0} open orders (page 1)`);

    console.log("\n--- Incoming PO vs Purchase Orders gaps ---");
    console.log("  Purchase Orders: ETA, User Status, annotations, export, analytics sidebar");
    console.log("  Incoming PO: no ETA/status/annotations/export; has Order Type column");
    console.log("  Both share /api/po; MySQL path hardcodes orderType='Normal'");
    console.log("  Decision: consider merging or surfacing ETA on Incoming PO");

    console.log("\nPASS: PO annotations verification complete");
} catch (err) {
    console.error("FAIL:", err.message);
    process.exit(1);
}
