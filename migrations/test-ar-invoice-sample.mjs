/**
 * Sample AR Invoice (Type Invoice) from Acumatica and count branch lines.
 */
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

function getF(obj, key) {
    const k = Object.keys(obj || {}).find((i) => i.toLowerCase() === key.toLowerCase());
    if (!k) return "";
    const val = obj[k];
    return typeof val === "object" && val !== null ? val.value ?? "" : val ?? "";
}

const loginRes = await fetch(`${env.ACUMATICA_BASE_URL}/entity/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
        name: env.ACU_USERNAME,
        password: env.ACU_PASSWORD,
        company: env.ACU_COMPANY || "KGSC",
    }),
});
const cookie = loginRes.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");

async function fetchEntity(entity, extraFilter, maxPages = 5) {
    const filter = encodeURIComponent(
        `Date ge datetimeoffset'${startDate}T00:00:00Z' and Date le datetimeoffset'${endDate}T23:59:59Z' and ${extraFilter}`
    );
    let skip = 0;
    const all = [];
    for (let page = 0; page < maxPages; page++) {
        const url = `${ACU_BASE}/${entity}?$expand=Details&$top=50&$skip=${skip}&$filter=${filter}`;
        const t0 = Date.now();
        const res = await fetch(url, { headers: { Cookie: cookie } });
        const data = await res.json();
        if (!res.ok) {
            console.log(`${entity} page ${page + 1} FAIL ${res.status} (${Date.now() - t0}ms):`, JSON.stringify(data).slice(0, 200));
            break;
        }
        const batch = data.value || [];
        all.push(...batch);
        console.log(`${entity} page ${page + 1}: ${batch.length} docs (${Date.now() - t0}ms)`);
        if (batch.length < 50) break;
        skip += 50;
    }
    return all;
}

console.log(`Range ${startDate} to ${endDate}, target branch ${branch}\n`);

const salesInvoices = await fetchEntity("SalesInvoice", "1 eq 1", 3);
const arInvoices = await fetchEntity("Invoice", "Type eq 'Invoice'", 3);

function countBranch(docs, label) {
    let lines = 0;
    let branchLines = 0;
    const branches = new Map();
    for (const inv of docs) {
        let details = inv.Details || [];
        if (details?.value) details = details.value;
        if (!Array.isArray(details)) continue;
        for (const line of details) {
            lines++;
            const b = String(getF(line, "BranchID") || getF(inv, "Branch") || "").trim().toUpperCase();
            branches.set(b, (branches.get(b) || 0) + 1);
            if (b === branch) branchLines++;
        }
    }
    console.log(`\n${label}: ${docs.length} docs, ${lines} lines, ${branch} lines: ${branchLines}`);
    const top = [...branches.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
    console.log("  top branches:", top);
}

countBranch(salesInvoices, "SalesInvoice");
countBranch(arInvoices, "AR Invoice");

await fetch(`${env.ACUMATICA_BASE_URL}/entity/auth/logout`, { method: "POST", headers: { Cookie: cookie } }).catch(() => {});
