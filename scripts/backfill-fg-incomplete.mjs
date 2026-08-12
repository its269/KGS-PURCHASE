/**
 * Re-pull incomplete Forecast sales months (coverage-aware).
 * Re-logins on 401 so long May–Jul / Oct–Dec pulls can finish.
 */
import dotenv from "dotenv";
import fs from "fs";
import mysql from "mysql2/promise";

dotenv.config({ path: ".env" });
if (fs.existsSync(".env.local")) dotenv.config({ path: ".env.local", override: true });
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const unwrap = (v) => {
    let s = String(v ?? "").trim();
    if ((s.startsWith("'") && s.endsWith("'")) || (s.startsWith('"') && s.endsWith('"'))) s = s.slice(1, -1);
    return s;
};

function getF(obj, keyName) {
    if (!obj) return "";
    const k = Object.keys(obj).find((i) => i.toLowerCase() === keyName.toLowerCase());
    if (!k) return "";
    const val = obj[k];
    if (val === null || val === undefined) return "";
    if (Array.isArray(val)) return val;
    if (typeof val === "object") return val.value ?? "";
    return val;
}

function getAny(obj, ...keys) {
    for (const k of keys) {
        const v = getF(obj, k);
        if (v !== "" && v !== null && v !== undefined) return v;
    }
    return "";
}

function extractDetails(inv) {
    let details = inv.Details || inv.details || [];
    if (details && !Array.isArray(details) && details.value) details = details.value;
    return Array.isArray(details) ? details : [];
}

function invoicesToRows(invoices, { idPrefix = "SI", defaultOrderType = "Invoice" } = {}) {
    const rows = [];
    const prefix = String(idPrefix || "SI").toUpperCase();
    for (const inv of invoices) {
        const refNbr = getF(inv, "ReferenceNbr") || getF(inv, "OrderNbr");
        const headerBranch = getAny(inv, "Branch", "BranchID", "SiteID", "LinkBranch");
        const docDate = getAny(inv, "Date", "DocumentDate");
        const orderType = getF(inv, "Type") || defaultOrderType;
        // CM/DM come from Invoice entity — avoid SI-* duplicates of the same memos.
        if (prefix === "SI" && (orderType === "Credit Memo" || orderType === "Debit Memo")) continue;
        const financialPeriod = getF(inv, "PostPeriod");
        const status = String(getF(inv, "Status") || "").trim().toLowerCase();
        if (status && ["balanced", "on hold", "hold", "pending"].includes(status)) continue;

        for (const line of extractDetails(inv)) {
            const invId = getF(line, "InventoryID");
            if (!invId) continue;
            const lineNbr = getF(line, "LineNbr") || getF(line, "LineNumber") || rows.length;
            const branchName = getAny(line, "BranchID", "Branch", "SiteID") || headerBranch;
            rows.push({
                id: `${idPrefix}-${refNbr}-${lineNbr}`,
                branch_name: branchName || null,
                order_type: orderType,
                financial_period: financialPeriod || null,
                document_date: docDate ? String(docDate).split("T")[0] : null,
                description: getAny(line, "TransactionDescription", "Description", "LineDescription") || null,
                qty: parseFloat(getAny(line, "Qty", "Quantity") || 0),
                total_amount: parseFloat(getAny(line, "Amount", "ExtendedPrice") || 0),
                inventory_id: invId,
                last_sync: new Date(),
            });
        }
    }
    return rows;
}

function monthInvoiceCoverageComplete(ym, dmin, dmax, invoiceCount = 1, asOf = new Date()) {
    if (!invoiceCount) return false;
    const [y, m] = String(ym || "").split("-").map(Number);
    if (!y || !m) return false;
    const lastDay = new Date(y, m, 0).getDate();
    const asOfDate = asOf instanceof Date && !Number.isNaN(asOf.getTime()) ? asOf : new Date();
    const expectedMax = (y === asOfDate.getFullYear() && m === asOfDate.getMonth() + 1)
        ? asOfDate.getDate()
        : lastDay;
    const minStr = String(dmin instanceof Date ? dmin.toISOString().slice(0, 10) : dmin || "").slice(0, 10);
    const maxStr = String(dmax instanceof Date ? dmax.toISOString().slice(0, 10) : dmax || "").slice(0, 10);
    const minDay = Number(minStr.slice(8, 10));
    const maxDay = Number(maxStr.slice(8, 10));
    if (!minDay || !maxDay) return false;
    return minDay <= 3 && maxDay >= Math.max(1, expectedMax - 2);
}

function dayWindows(fromDay, toDay, sizeDays = 2) {
    const windows = [];
    let cursor = new Date(`${fromDay}T00:00:00Z`);
    const end = new Date(`${toDay}T00:00:00Z`);
    while (cursor <= end) {
        const winEnd = new Date(cursor);
        winEnd.setUTCDate(winEnd.getUTCDate() + sizeDays - 1);
        if (winEnd > end) winEnd.setTime(end.getTime());
        windows.push({
            start: cursor.toISOString().slice(0, 10),
            end: winEnd.toISOString().slice(0, 10),
        });
        cursor = new Date(winEnd);
        cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    return windows;
}

const base = unwrap(process.env.ACUMATICA_BASE_URL).replace(/\/$/, "");
const entityBase = `${base}/entity/Default/20.200.001`;
const user = unwrap(process.env.ACU_USERNAME || process.env.ACUMATICA_USERNAME);
const pass = unwrap(process.env.ACU_PASSWORD || process.env.ACUMATICA_PASSWORD);
const company = unwrap(process.env.ACU_COMPANY || process.env.ACUMATICA_COMPANY || "KGSC");

const pool = mysql.createPool({
    host: process.env.MYSQL_HOST,
    port: parseInt(process.env.MYSQL_PORT || "3306", 10),
    user: process.env.MYSQL_USER,
    password: unwrap(process.env.MYSQL_PASSWORD),
    database: process.env.MYSQL_PURCHASE_DATABASE || "db_purchase",
    timezone: "+08:00",
});

async function login(retries = 6) {
    let lastErr;
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            const res = await fetch(`${base}/entity/auth/login`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name: user, password: pass, company }),
            });
            if (!res.ok) throw new Error(`login ${res.status}`);
            return (res.headers.getSetCookie?.() || []).map((c) => c.split(";")[0]).join("; ");
        } catch (err) {
            lastErr = err;
            console.warn(`login retry ${attempt}/${retries}:`, err.message);
            await new Promise((r) => setTimeout(r, attempt * 5000));
        }
    }
    throw lastErr;
}

async function fetchEntity(cookieRef, entity, filter, retries = 5) {
    const pageSize = 50;
    const all = [];
    let skip = 0;
    while (true) {
        const url = `${entityBase}/${entity}?$expand=Details&$top=${pageSize}&$skip=${skip}&$filter=${encodeURIComponent(filter)}`;
        let lastErr;
        let batch = null;
        for (let attempt = 1; attempt <= retries; attempt++) {
            try {
                const res = await fetch(url, { headers: { Cookie: cookieRef.cookie } });
                const text = await res.text();
                if (res.status === 401) {
                    console.warn("session expired — re-login");
                    cookieRef.cookie = await login();
                    continue;
                }
                if (!res.ok) throw new Error(`${entity} ${res.status} ${text.slice(0, 180)}`);
                const data = JSON.parse(text);
                batch = data.value || (Array.isArray(data) ? data : []);
                lastErr = null;
                break;
            } catch (err) {
                lastErr = err;
                console.warn(`retry ${attempt}/${retries}:`, err.message);
                await new Promise((r) => setTimeout(r, attempt * 4000));
            }
        }
        if (lastErr) throw lastErr;
        all.push(...batch);
        if (batch.length < pageSize) break;
        skip += pageSize;
    }
    return all;
}

async function upsert(rows) {
    if (!rows.length) return;
    const sql = `INSERT INTO product_periodic_sales
        (id, branch_name, order_type, financial_period, document_date,
         description, qty, total_amount, item_class, inventory_id, posting_class, last_sync)
     VALUES ?
     ON DUPLICATE KEY UPDATE
        branch_name=VALUES(branch_name), order_type=VALUES(order_type),
        financial_period=VALUES(financial_period), document_date=VALUES(document_date),
        description=VALUES(description), qty=VALUES(qty), total_amount=VALUES(total_amount),
        inventory_id=VALUES(inventory_id), last_sync=VALUES(last_sync)`;
    for (let i = 0; i < rows.length; i += 200) {
        const chunk = rows.slice(i, i + 200);
        const values = chunk.map((r) => [
            r.id, r.branch_name, r.order_type, r.financial_period, r.document_date,
            r.description, r.qty, r.total_amount, null, r.inventory_id, null, r.last_sync,
        ]);
        await pool.query(sql, [values]);
    }
}

const monthsArg = process.argv.slice(2);
const defaultMonths = ["2026-07", "2025-11", "2025-12"];
const months = monthsArg.length ? monthsArg : defaultMonths;

async function listIncomplete(candidates) {
    const out = [];
    for (const ym of candidates) {
        const [y, m] = ym.split("-").map(Number);
        const start = `${ym}-01`;
        const end = `${ym}-${String(new Date(y, m, 0).getDate()).padStart(2, "0")}`;
        const [[row]] = await pool.query(
            `SELECT COUNT(*) c,
                    DATE_FORMAT(MIN(CAST(document_date AS DATE)), '%Y-%m-%d') dmin,
                    DATE_FORMAT(MAX(CAST(document_date AS DATE)), '%Y-%m-%d') dmax
             FROM product_periodic_sales
             WHERE CAST(document_date AS DATE) BETWEEN ? AND ?
               AND order_type IN ('Invoice','Debit Memo')`,
            [start, end]
        );
        const complete = monthInvoiceCoverageComplete(ym, row.dmin, row.dmax, Number(row.c) || 0, new Date("2026-08-11"));
        console.log(`coverage ${ym}:`, { c: row.c, dmin: row.dmin, dmax: row.dmax, complete });
        if (!complete) out.push({ ym, start, end });
    }
    return out;
}

const incomplete = await listIncomplete(months);
if (!incomplete.length) {
    console.log("All requested months already have full coverage.");
    await pool.end();
    process.exit(0);
}

const cookieRef = { cookie: await login() };
console.log("Acumatica login ok — pulling", incomplete.map((x) => x.ym).join(", "));

let total = 0;
try {
    for (const { ym, start, end } of incomplete) {
        for (const w of dayWindows(start, end, 2)) {
            const filter =
                `Date ge datetimeoffset'${w.start}T00:00:00Z' and ` +
                `Date le datetimeoffset'${w.end}T23:59:59Z'`;
            process.stdout.write(`>>> ${ym} ${w.start}..${w.end} `);
            const salesInvoices = await fetchEntity(cookieRef, "SalesInvoice", filter);
            let creditMemos = [];
            let debitMemos = [];
            try {
                creditMemos = await fetchEntity(cookieRef, "Invoice", `${filter} and Type eq 'Credit Memo'`);
            } catch (err) {
                console.warn("CM", err.message);
            }
            try {
                debitMemos = await fetchEntity(cookieRef, "Invoice", `${filter} and Type eq 'Debit Memo'`);
            } catch (err) {
                console.warn("DM", err.message);
            }
            const rows = [
                ...invoicesToRows(salesInvoices, { idPrefix: "SI", defaultOrderType: "Invoice" }),
                ...invoicesToRows(creditMemos, { idPrefix: "CM", defaultOrderType: "Credit Memo" }),
                ...invoicesToRows(debitMemos, { idPrefix: "DM", defaultOrderType: "Debit Memo" }),
            ];
            await upsert(rows);
            total += rows.length;
            console.log(`rows=${rows.length}`);
        }
    }
} finally {
    await fetch(`${base}/entity/auth/logout`, {
        method: "POST",
        headers: { Cookie: cookieRef.cookie },
    }).catch(() => {});
}

console.log("DONE lines=", total);
await listIncomplete(incomplete.map((x) => x.ym));
await pool.end();
