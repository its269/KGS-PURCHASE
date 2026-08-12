/**
 * Probe CashSale for target SKU May–Jul ECOM (report gap ~503 units).
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
if (!loginRes.ok) throw new Error(`login ${loginRes.status}`);
const cookie = (loginRes.headers.getSetCookie?.() || []).map((c) => c.split(";")[0]).join("; ");
console.log("login ok");

async function sumEntity(entity, start, end) {
    const filter =
        `Date ge datetimeoffset'${start}T00:00:00Z' and Date le datetimeoffset'${end}T23:59:59Z'`;
    let skip = 0;
    let ecomQty = 0;
    let ecomAmt = 0;
    let allQty = 0;
    let docs = 0;
    let hits = 0;
    while (true) {
        const url = `${API}/${entity}?$expand=Details&$top=50&$skip=${skip}&$filter=${encodeURIComponent(filter)}`;
        const res = await fetch(url, { headers: { Cookie: cookie, Accept: "application/json" } });
        const text = await res.text();
        if (!res.ok) throw new Error(`${entity} ${res.status} ${text.slice(0, 200)}`);
        const data = JSON.parse(text);
        const batch = data.value || [];
        docs += batch.length;
        for (const inv of batch) {
            let details = inv.Details || [];
            if (details && !Array.isArray(details) && details.value) details = details.value;
            const headerBranch = getAny(inv, "Branch", "BranchID");
            const status = String(getF(inv, "Status") || "");
            for (const line of details || []) {
                const id = String(getF(line, "InventoryID") || "").replace(/\s+/g, "");
                if (id !== target) continue;
                hits += 1;
                const q = Math.abs(Number(getAny(line, "Qty", "Quantity") || 0));
                const a = Math.abs(Number(getAny(line, "Amount", "ExtendedPrice") || 0));
                const branch = String(getAny(line, "BranchID", "Branch") || headerBranch || "");
                allQty += q;
                if (/ECOM/i.test(branch)) {
                    ecomQty += q;
                    ecomAmt += a;
                }
                if (hits <= 5) {
                    console.log(" sample", { entity, ref: getF(inv, "ReferenceNbr"), status, branch, q, a });
                }
            }
        }
        if (batch.length < 50) break;
        skip += 50;
    }
    return { entity, start, end, docs, hits, allQty, ecomQty, ecomAmt };
}

// Sample one week first (faster), then full if hits found
for (const entity of ["CashSale", "SalesOrder"]) {
    try {
        const week = await sumEntity(entity, "2026-05-01", "2026-05-07");
        console.log(week);
        if (week.hits > 0 || entity === "CashSale") {
            const full = await sumEntity(entity, "2026-05-01", "2026-07-31");
            console.log("FULL", full);
        }
    } catch (e) {
        console.log(entity, "ERR", e.message);
    }
}

await fetch(`${base}/entity/auth/logout`, { method: "POST", headers: { Cookie: cookie } }).catch(() => {});
