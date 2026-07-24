import fs from "fs";
import { SALES_LOOKBACK_DAYS } from "../lib/sales-velocity.js";

const envFile = fs.existsSync(new URL("../.env.local", import.meta.url))
    ? new URL("../.env.local", import.meta.url)
    : new URL("../.env", import.meta.url);
const env = fs.readFileSync(envFile, "utf8").split("\n").reduce((acc, line) => {
    const [k, ...v] = line.split("=");
    if (k && !k.trim().startsWith("#")) acc[k.trim()] = v.join("=").trim().replace(/^['"]|['"]$/g, "");
    return acc;
}, {});

const branch = (process.argv[2] || "ILOILO").toUpperCase();
const ACU_BASE = `${env.ACUMATICA_BASE_URL}/entity/Default/20.200.001`;
const end = new Date();
const start = new Date(end);
start.setDate(end.getDate() - SALES_LOOKBACK_DAYS + 1);
const startDate = start.toISOString().split("T")[0];
const endDate = end.toISOString().split("T")[0];
const dateFilter = encodeURIComponent(
    `Date ge datetimeoffset'${startDate}T00:00:00Z' and Date le datetimeoffset'${endDate}T23:59:59Z'`
);

function getF(obj, key) {
    const k = Object.keys(obj || {}).find((i) => i.toLowerCase() === key.toLowerCase());
    if (!k) return "";
    const val = obj[k];
    return typeof val === "object" && val !== null ? val.value ?? "" : val ?? "";
}

const loginRes = await fetch(`${env.ACUMATICA_BASE_URL}/entity/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: env.ACU_USERNAME, password: env.ACU_PASSWORD, company: env.ACU_COMPANY || "KGSC" }),
});
const cookie = loginRes.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");

async function firstPage(entity, extra = "") {
    const filter = extra ? encodeURIComponent(
        `Date ge datetimeoffset'${startDate}T00:00:00Z' and Date le datetimeoffset'${endDate}T23:59:59Z' and ${extra}`
    ) : dateFilter;
    const url = `${ACU_BASE}/${entity}?$expand=Details&$top=50&$filter=${filter}`;
    const t0 = Date.now();
    const res = await fetch(url, { headers: { Cookie: cookie } });
    const data = await res.json();
    console.log(`${entity}${extra ? ` (${extra})` : ""}: ${res.status} in ${Date.now() - t0}ms, docs=${data.value?.length ?? 0}`);
    if (!res.ok) console.log(" ", JSON.stringify(data).slice(0, 250));
    return data.value || [];
}

function branchStats(docs) {
    const branches = new Map();
    for (const inv of docs) {
        let details = inv.Details || [];
        if (details?.value) details = details.value;
        if (!Array.isArray(details)) continue;
        for (const line of details) {
            const b = String(getF(line, "BranchID") || getF(inv, "Branch") || "(blank)").trim().toUpperCase();
            branches.set(b, (branches.get(b) || 0) + 1);
        }
    }
    const target = branches.get(branch) || 0;
    const top = [...branches.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
    console.log(`  ${branch} lines in sample: ${target}`);
    console.log("  top:", top);
}

console.log(`Sample first page (${startDate} to ${endDate})\n`);
const si = await firstPage("SalesInvoice");
branchStats(si);
const inv = await firstPage("Invoice", "Type eq 'Invoice'");
branchStats(inv);
const cm = await firstPage("Invoice", "Type eq 'Credit Memo'");
branchStats(cm);

await fetch(`${env.ACUMATICA_BASE_URL}/entity/auth/logout`, { method: "POST", headers: { Cookie: cookie } }).catch(() => {});
