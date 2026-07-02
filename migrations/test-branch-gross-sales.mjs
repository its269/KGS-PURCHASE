/**
 * Time Acumatica branch-filtered sales fetch (replenishment path).
 * Usage: node migrations/test-branch-gross-sales.mjs [branch]
 */
import fs from "fs";
import { SALES_LOOKBACK_DAYS } from "../lib/sales-velocity.js";

function getF(obj, keyName) {
    if (!obj) return "";
    const k = Object.keys(obj).find((i) => i.toLowerCase() === keyName.toLowerCase());
    if (!k) return "";
    const val = obj[k];
    if (val === null || val === undefined) return "";
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

function aggregateGross(invoices, branch, startDate, endDate) {
    const totals = new Map();
    for (const inv of invoices) {
        const dateStr = getAny(inv, "Date", "DocumentDate");
        if (!dateStr) continue;
        const docDate = new Date(dateStr).toISOString().split("T")[0];
        if (startDate && docDate < startDate) continue;
        if (endDate && docDate > endDate) continue;
        if ((getF(inv, "Type") || "Invoice") === "Credit Memo") continue;
        const headerBranch = getAny(inv, "Branch", "BranchID", "SiteID");
        let details = inv.Details || [];
        if (details && !Array.isArray(details) && details.value) details = details.value;
        if (!Array.isArray(details)) details = [];
        for (const line of details) {
            const invId = String(getAny(line, "InventoryID")).trim();
            if (!invId) continue;
            const lineBranch = String(getAny(line, "BranchID", "Branch", "SiteID") || headerBranch || "").trim();
            if (branch && lineBranch.toUpperCase() !== branch.toUpperCase()) continue;
            const key = invId.toUpperCase();
            const qty = Math.abs(Number(getAny(line, "Qty", "Quantity") || 0));
            const prev = totals.get(key) || 0;
            totals.set(key, prev + qty);
        }
    }
    return totals;
}

const envPath = new URL("../.env", import.meta.url);
const envLocalPath = new URL("../.env.local", import.meta.url);
const envFile = fs.existsSync(envLocalPath) ? envLocalPath : envPath;
const env = fs.readFileSync(envFile, "utf8")
    .split("\n")
    .reduce((acc, line) => {
        const [k, ...v] = line.split("=");
        if (k && !k.trim().startsWith("#")) acc[k.trim()] = v.join("=").trim().replace(/^['"]|['"]$/g, "");
        return acc;
    }, {});

const branch = process.argv[2] || "ILOILO";
const ACU_BASE = `${env.ACUMATICA_BASE_URL}/entity/Default/20.200.001`;

function toISODate(d) {
    return d.toISOString().split("T")[0];
}

async function fetchDocs(cookie, entity, startDate, endDate, branchName, extraFilter = "") {
    const filterParts = [
        `Date ge datetimeoffset'${startDate}T00:00:00Z'`,
        `Date le datetimeoffset'${endDate}T23:59:59Z'`,
    ];
    if (branchName) filterParts.push(`Branch eq '${branchName.replace(/'/g, "''")}'`);
    if (extraFilter) filterParts.push(extraFilter);

    const encoded = encodeURIComponent(filterParts.join(" and "));
    const pageSize = 100;
    const all = [];
    let skip = 0;
    let pages = 0;

    while (true) {
        const url = `${ACU_BASE}/${entity}?$expand=Details&$top=${pageSize}&$skip=${skip}&$filter=${encoded}&$orderby=Date desc`;
        const t0 = Date.now();
        const res = await fetch(url, { headers: { Cookie: cookie, Accept: "application/json" } });
        if (!res.ok) {
            const text = await res.text();
            throw new Error(`${entity} ${res.status}: ${text.slice(0, 300)}`);
        }
        const data = await res.json();
        const batch = data.value || [];
        all.push(...batch);
        pages++;
        console.log(`  ${entity} page ${pages}: ${batch.length} docs (${Date.now() - t0}ms)`);
        if (batch.length < pageSize) break;
        skip += pageSize;
    }
    return all;
}

const end = new Date();
const start = new Date(end);
start.setDate(end.getDate() - SALES_LOOKBACK_DAYS + 1);
const startDate = toISODate(start);
const endDate = toISODate(end);

console.log(`Branch: ${branch}, range: ${startDate} to ${endDate}\n`);

const loginRes = await fetch(`${env.ACUMATICA_BASE_URL}/entity/auth/login`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({
        name: env.ACUMATICA_USERNAME || env.ACU_USERNAME,
        password: env.ACUMATICA_PASSWORD || env.ACU_PASSWORD,
        company: env.ACUMATICA_COMPANY || env.ACU_COMPANY || "KGSC",
    }),
});

if (!loginRes.ok) {
    console.error("Login failed", await loginRes.text());
    process.exit(1);
}

const cookie = loginRes.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
console.log("Logged in.\n");

const t0 = Date.now();
const [salesInvoices, debitMemos] = await Promise.all([
    fetchDocs(cookie, "SalesInvoice", startDate, endDate, branch),
    fetchDocs(cookie, "Invoice", startDate, endDate, branch, "Type eq 'Debit Memo'"),
]);
console.log(`\nFetched ${salesInvoices.length} SalesInvoice + ${debitMemos.length} DebitMemo in ${Date.now() - t0}ms`);

const map = aggregateGross([...salesInvoices, ...debitMemos], branch, startDate, endDate);
let positive = 0;
for (const v of map.values()) if (v > 0) positive++;

const top = [...map.entries()]
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);

console.log(`\nGross products: ${map.size}, with qty>0: ${positive}`);
console.log("Top:", top.map(([id, qty90]) => ({ id, qty90 })));

await fetch(`${env.ACUMATICA_BASE_URL}/entity/auth/logout`, { method: "POST", headers: { Cookie: cookie } }).catch(() => {});
