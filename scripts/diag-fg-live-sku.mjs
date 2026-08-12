/**
 * Live Acumatica SalesInvoice sum for target SKU May–Jul (Released only vs all).
 * Compare to MySQL ECOM gross 35184 / net 34222 / report 34725.
 */
import dotenv from "dotenv";
import fs from "fs";

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
    if (val == null) return "";
    if (Array.isArray(val)) return val;
    if (typeof val === "object") return val.value ?? "";
    return val;
}

function getAny(obj, ...keys) {
    for (const k of keys) {
        const v = getF(obj, k);
        if (v !== "" && v != null) return v;
    }
    return "";
}

const base = unwrap(process.env.ACUMATICA_BASE_URL).replace(/\/$/, "");
const API = `${base}/entity/Default/20.200.001`;
const target = "130101101000030";

const loginRes = await fetch(`${base}/entity/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
        name: unwrap(process.env.ACU_USERNAME || process.env.ACUMATICA_USERNAME),
        password: unwrap(process.env.ACU_PASSWORD || process.env.ACUMATICA_PASSWORD),
        company: unwrap(process.env.ACU_COMPANY || process.env.ACUMATICA_COMPANY || "KGSC"),
    }),
});
if (!loginRes.ok) throw new Error(`login ${loginRes.status} ${await loginRes.text()}`);
let cookie = (loginRes.headers.getSetCookie?.() || []).map((c) => c.split(";")[0]).join("; ");

function dayWindows(fromDay, toDay, size = 7) {
    const out = [];
    let c = new Date(`${fromDay}T00:00:00Z`);
    const end = new Date(`${toDay}T00:00:00Z`);
    while (c <= end) {
        const e = new Date(c);
        e.setUTCDate(e.getUTCDate() + size - 1);
        if (e > end) e.setTime(end.getTime());
        out.push({ start: c.toISOString().slice(0, 10), end: e.toISOString().slice(0, 10) });
        c = new Date(e);
        c.setUTCDate(c.getUTCDate() + 1);
    }
    return out;
}

async function fetchPages(entity, filter) {
    const all = [];
    let skip = 0;
    for (;;) {
        const url = `${API}/${entity}?$expand=Details&$top=50&$skip=${skip}&$filter=${encodeURIComponent(filter)}`;
        let res = await fetch(url, { headers: { Cookie: cookie, Accept: "application/json" } });
        if (res.status === 401) {
            const relog = await fetch(`${base}/entity/auth/login`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    name: unwrap(process.env.ACU_USERNAME || process.env.ACUMATICA_USERNAME),
                    password: unwrap(process.env.ACU_PASSWORD || process.env.ACUMATICA_PASSWORD),
                    company: unwrap(process.env.ACU_COMPANY || process.env.ACUMATICA_COMPANY || "KGSC"),
                }),
            });
            cookie = (relog.headers.getSetCookie?.() || []).map((c) => c.split(";")[0]).join("; ");
            res = await fetch(url, { headers: { Cookie: cookie, Accept: "application/json" } });
        }
        const text = await res.text();
        if (!res.ok) throw new Error(`${entity} ${res.status} ${text.slice(0, 160)}`);
        const batch = JSON.parse(text).value || [];
        all.push(...batch);
        if (batch.length < 50) break;
        skip += 50;
    }
    return all;
}

const totals = {
    ecomInvQty: 0,
    ecomInvAmt: 0,
    ecomReleasedQty: 0,
    ecomReleasedAmt: 0,
    ecomCmQty: 0,
    ecomCmAmt: 0,
    byStatus: new Map(),
};

for (const w of dayWindows("2026-05-01", "2026-07-31", 5)) {
    process.stdout.write(`>>> ${w.start}..${w.end} `);
    const filter =
        `Date ge datetimeoffset'${w.start}T00:00:00Z' and Date le datetimeoffset'${w.end}T23:59:59Z'`;
    const invoices = await fetchPages("SalesInvoice", filter);
    let hits = 0;
    for (const inv of invoices) {
        const status = String(getF(inv, "Status") || "").trim() || "(blank)";
        let details = inv.Details || [];
        if (details && !Array.isArray(details) && details.value) details = details.value;
        const headerBranch = getAny(inv, "Branch", "BranchID");
        for (const line of details || []) {
            const id = String(getF(line, "InventoryID") || "").replace(/\s+/g, "");
            if (id !== target) continue;
            const branch = String(getAny(line, "BranchID", "Branch", "WarehouseID", "SiteID") || headerBranch || "");
            if (!/ECOM/i.test(branch)) continue;
            const q = Math.abs(Number(getAny(line, "Qty", "Quantity") || 0));
            const a = Math.abs(Number(getAny(line, "Amount", "ExtendedPrice") || 0));
            hits += 1;
            totals.ecomInvQty += q;
            totals.ecomInvAmt += a;
            totals.byStatus.set(status, (totals.byStatus.get(status) || 0) + q);
            if (/^released$/i.test(status) || status === "(blank)") {
                totals.ecomReleasedQty += q;
                totals.ecomReleasedAmt += a;
            }
        }
    }
    try {
        const cms = await fetchPages("Invoice", `${filter} and Type eq 'Credit Memo'`);
        for (const inv of cms) {
            const status = String(getF(inv, "Status") || "").trim();
            if (status && !/^released$/i.test(status)) continue;
            let details = inv.Details || [];
            if (details && !Array.isArray(details) && details.value) details = details.value;
            const headerBranch = getAny(inv, "Branch", "BranchID");
            for (const line of details || []) {
                const id = String(getF(line, "InventoryID") || "").replace(/\s+/g, "");
                if (id !== target) continue;
                const branch = String(getAny(line, "BranchID", "Branch") || headerBranch || "");
                if (!/ECOM/i.test(branch)) continue;
                totals.ecomCmQty += Math.abs(Number(getAny(line, "Qty", "Quantity") || 0));
                totals.ecomCmAmt += Math.abs(Number(getAny(line, "Amount", "ExtendedPrice") || 0));
            }
        }
    } catch (e) {
        console.warn("CM", e.message);
    }
    console.log(`hits=${hits} invQty=${totals.ecomInvQty}`);
}

console.log({
    ...totals,
    byStatus: Object.fromEntries(totals.byStatus),
    netReleased: totals.ecomReleasedQty - totals.ecomCmQty,
    netAll: totals.ecomInvQty - totals.ecomCmQty,
    report: 34725,
});

await fetch(`${base}/entity/auth/logout`, { method: "POST", headers: { Cookie: cookie } }).catch(() => {});
