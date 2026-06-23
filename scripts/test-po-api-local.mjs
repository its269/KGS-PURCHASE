import dotenv from "dotenv";
import fs from "fs";

dotenv.config({ path: fs.existsSync(".env.local") ? ".env.local" : ".env" });

const BASE = "http://localhost:3000";
const user = process.env.ACU_USERNAME || process.env.ACUMATICA_USERNAME;
const pass = process.env.ACU_PASSWORD || process.env.ACUMATICA_PASSWORD;

const loginRes = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: user, password: pass, company: process.env.ACU_COMPANY || process.env.ACU_COMPANY }),
});
const sessionId = (loginRes.headers.get("set-cookie") || "").match(/acu_session=([^;]+)/)?.[1];

// Import session store to see credential type
const { getSession } = await import("../lib/session-store.js");
const cred = getSession(sessionId);
console.log("Credential type:", cred?.startsWith("__bearer__") ? "bearer" : cred === "__bypass__" ? "bypass" : "cookie");
console.log("Cred length:", cred?.length);

const { AcumaticaService } = await import("../services/acumatica.js");
try {
    const live = await AcumaticaService.getPurchaseOrders({
        page: 1, pageSize: 50, status: "Open", search: "", startDate: "", cookie: cred,
    });
    const withLines = live.orders.filter(o => o.lines?.length);
    console.log("Acumatica orders:", live.orders.length, "with lines:", withLines.length);
    const target = live.orders.find(o => o.orderNbr === "MNLP260480" || o.orderNbr === "DVOP260057");
    console.log("MNLP260480/DVOP260057:", target ? `${target.orderNbr} lines=${target.lines?.length}` : "not in page");
    if (withLines[0]) console.log("Sample:", withLines[0].orderNbr, withLines[0].lines[0]);
} catch (e) {
    console.error("Acumatica error:", e.message);
}

// Single order fetch
try {
    const map = await AcumaticaService.getPurchaseOrderLinesByNbrs(["MNLP260480", "DVOP260057"], cred);
    console.log("Single fetch lines:", [...map.entries()].map(([k, v]) => `${k}:${v.length}`));
} catch (e) {
    console.error("Single fetch error:", e.message);
}
