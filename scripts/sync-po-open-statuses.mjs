/**
 * Global: pull Acumatica Open PO numbers and align MySQL statuses for ALL vendors.
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

async function fetchOpenOrderNbrs(cookie, startDate = "2024-01-01") {
    const open = new Set();
    let skip = 0;
    const top = 100;
    const filter = `Status eq 'Open' and Date ge datetimeoffset'${startDate}T00:00:00Z'`;

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
            const nbr = String(getF(row, "OrderNbr") || "").trim();
            if (nbr) open.add(nbr);
        }
        console.log(`Scanned ${skip + rows.length} Open POs → unique: ${open.size}`);
        if (rows.length < top) break;
        skip += rows.length;
        if (skip > 50000) break;
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
    console.log("Fetching Open POs from Acumatica (ALL vendors)…");
    const openIds = await fetchOpenOrderNbrs(cookie, "2024-01-01");
    console.log("Acumatica Open count (global):", openIds.length);

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

    const phAll = openIds.map(() => "?").join(",");
    const [closeRes] = await pool.query(
        `UPDATE purchase_history
         SET status = 'Closed'
         WHERE status = 'Open'
           AND receipt_date IS NOT NULL
           AND order_nbr NOT IN (${phAll})
           AND DATE(order_date) >= '2024-01-01'`,
        openIds
    );
    const closed = Number(closeRes?.affectedRows) || 0;

    console.log(`Aligned statuses (global): opened=${opened}, closed(false-reopens)=${closed}`);

    // Global proof: Open POs by vendor (top 15) — not Softie-only
    const [byVendor] = await pool.query(
        `SELECT COALESCE(NULLIF(TRIM(vendor_name), ''), vendor_id, '(unknown)') AS vendor,
                COUNT(*) AS open_count
         FROM purchase_history
         WHERE status = 'Open'
           AND DATE(order_date) >= '2024-01-01'
         GROUP BY COALESCE(NULLIF(TRIM(vendor_name), ''), vendor_id, '(unknown)')
         ORDER BY open_count DESC
         LIMIT 15`
    );
    console.log("Local Open POs by vendor (top 15):");
    console.table(byVendor);

    const [[localOpen]] = await pool.query(
        `SELECT COUNT(*) AS cnt FROM purchase_history
         WHERE status = 'Open' AND DATE(order_date) >= '2024-01-01'`
    );
    console.log(
        `Local Open (2024+): ${localOpen.cnt} | Acumatica Open set: ${openIds.length}`
    );

    // Softie is only a sanity check among all vendors
    const manager = ["MPO260504", "MPO260431", "DVOP260049", "MPO260273"];
    const [sofie] = await pool.query(
        `SELECT order_nbr FROM purchase_history
         WHERE order_nbr IN (?,?,?,?) AND status = 'Open'`,
        manager
    );
    console.log(
        sofie.length === 4
            ? "Sanity Softie Open: 4/4 present"
            : `Sanity Softie Open: ${sofie.length}/4 — ${sofie.map((r) => r.order_nbr).join(", ")}`
    );
} finally {
    await pool.end();
}
