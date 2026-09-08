/**
 * Global: pull Acumatica Open PO numbers (2026+) and align MySQL statuses.
 * Fixes false reopens from the old receipt_date heuristic.
 *
 * Usage: node scripts/sync-po-open-statuses.mjs
 */
import dotenv from "dotenv";
import fs from "fs";
import mysql from "mysql2/promise";

dotenv.config({ path: fs.existsSync(".env.local") ? ".env.local" : ".env" });
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const getF = (obj, keyName) => {
    if (!obj) return "";
    const k = Object.keys(obj).find((i) => i.toLowerCase() === keyName.toLowerCase());
    if (!k) return "";
    const val = obj[k];
    if (val === null || val === undefined) return "";
    if (typeof val === "object") return val.value ?? "";
    return val;
};

const base = String(process.env.ACUMATICA_BASE_URL || "").replace(/\/$/, "");
const loginUrl = `${base}/entity/auth/login`;
const ACU = `${base}/entity/Default/20.200.001`;

async function login() {
    const attempts = [
        {
            name: process.env.ACUMATICA_USERNAME,
            password: process.env.ACUMATICA_PASSWORD,
            company: process.env.ACUMATICA_COMPANY,
        },
        {
            name: process.env.ACU_USERNAME,
            password: process.env.ACU_PASSWORD,
            company: process.env.ACUMATICA_COMPANY,
        },
    ].filter((a) => a.name && a.password);

    for (const body of attempts) {
        const res = await fetch(loginUrl, {
            method: "POST",
            headers: { Accept: "application/json", "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });
        if (res.ok) {
            const setCookie = typeof res.headers.getSetCookie === "function"
                ? res.headers.getSetCookie()
                : [];
            const cookie = setCookie.length
                ? setCookie.join("; ")
                : res.headers.get("set-cookie") || "";
            if (cookie) return cookie;
        }
        console.warn("Login attempt failed:", body.name, res.status);
    }
    throw new Error("Acumatica login failed");
}

async function fetchOpenOrderNbrs(cookie, startDate = "2026-01-01") {
    const open = new Set();
    let skip = 0;
    const top = 50;
    // Same filter shape as Incoming PO sync (Acumatica rejects some $select/$filter combos)
    const filter = `Date ge datetimeoffset'${startDate}T00:00:00Z' and Status ne 'Cancelled'`;

    while (true) {
        const url = `${ACU}/PurchaseOrder?$top=${top}&$skip=${skip}&$filter=${encodeURIComponent(filter)}`;
        const res = await fetch(url, {
            headers: { Accept: "application/json", Cookie: cookie },
        });
        if (!res.ok) {
            const text = await res.text();
            throw new Error(`PO fetch failed ${res.status}: ${text.slice(0, 300)}`);
        }
        const data = await res.json();
        const rows = data.value || (Array.isArray(data) ? data : []);
        if (!rows.length) break;
        for (const row of rows) {
            const status = String(getF(row, "Status") || "").trim();
            const nbr = String(getF(row, "OrderNbr") || "").trim();
            if (nbr && status === "Open") open.add(nbr);
        }
        console.log(`Scanned ${skip + rows.length} POs → Open so far: ${open.size}`);
        if (rows.length < top) break;
        skip += rows.length;
        if (skip > 20000) break;
    }
    return [...open];
}

const pool = mysql.createPool({
    host: process.env.MYSQL_HOST,
    port: +process.env.MYSQL_PORT || 3306,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_PURCHASE_DATABASE || "db_purchase",
});

try {
    console.log("Logging in to Acumatica…");
    const cookie = await login();
    console.log("Fetching Open POs from Acumatica…");
    const openIds = await fetchOpenOrderNbrs(cookie);
    console.log("Acumatica Open count (2026+):", openIds.length);

    // Ensure ERP Open → local Open
    let opened = 0;
    for (let i = 0; i < openIds.length; i += 200) {
        const chunk = openIds.slice(i, i + 200);
        const ph = chunk.map(() => "?").join(",");
        const [res] = await pool.query(
            `UPDATE purchase_history SET status = 'Open' WHERE order_nbr IN (${ph}) AND status <> 'Open'`,
            chunk
        );
        opened += Number(res?.affectedRows) || 0;
    }

    // Revert false reopens (Open + receipt_date but not Open in ERP)
    const phAll = openIds.map(() => "?").join(",");
    const [closeRes] = await pool.query(
        `UPDATE purchase_history
         SET status = 'Closed'
         WHERE status = 'Open'
           AND receipt_date IS NOT NULL
           AND order_nbr NOT IN (${phAll})`,
        openIds
    );
    const closed = Number(closeRes?.affectedRows) || 0;

    console.log(`Aligned statuses: opened=${opened}, closed(false-reopens)=${closed}`);

    // Verify Sofie
    const manager = ["MPO260504", "MPO260431", "DVOP260049", "MPO260273"];
    const [sofie] = await pool.query(
        `SELECT order_nbr, status FROM purchase_history
         WHERE (vendor_id = 'VM000055' OR vendor_name LIKE '%sofie%')
           AND status = 'Open'
           AND DATE(order_date) >= '2026-01-01' AND DATE(order_date) <= '2026-09-08'
         ORDER BY order_date DESC`
    );
    console.log("Open Sofie in range after align:", sofie.map((r) => r.order_nbr));
    const missing = manager.filter((n) => !sofie.some((r) => r.order_nbr === n));
    const extra = sofie.filter((r) => !manager.includes(r.order_nbr)).map((r) => r.order_nbr);
    console.log(missing.length ? `MISSING manager: ${missing}` : "PASS: manager 4 present");
    console.log(extra.length ? `EXTRA beyond manager: ${extra}` : "PASS: exactly manager 4 (or subset)");

    // Also show which manager IDs Acumatica considers Open
    const acuSofie = openIds.filter((n) => manager.includes(n));
    console.log("Manager IDs in Acumatica Open set:", acuSofie);
} finally {
    await pool.end();
}
