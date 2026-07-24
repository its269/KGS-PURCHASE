/** SalesInvoice only with branch filter — timing test */
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

const branch = process.argv[2] || "ILOILO";
const ACU_BASE = `${env.ACUMATICA_BASE_URL}/entity/Default/20.200.001`;
const end = new Date();
const start = new Date(end);
start.setDate(end.getDate() - SALES_LOOKBACK_DAYS + 1);
const startDate = start.toISOString().split("T")[0];
const endDate = end.toISOString().split("T")[0];

const loginRes = await fetch(`${env.ACUMATICA_BASE_URL}/entity/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
        name: env.ACU_USERNAME || env.ACUMATICA_USERNAME,
        password: env.ACU_PASSWORD || env.ACUMATICA_PASSWORD,
        company: env.ACU_COMPANY || env.ACUMATICA_COMPANY || "KGSC",
    }),
});
const cookie = loginRes.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");

const filter = encodeURIComponent(
    `Date ge datetimeoffset'${startDate}T00:00:00Z' and Date le datetimeoffset'${endDate}T23:59:59Z' and Branch eq '${branch}'`
);
const t0 = Date.now();
let skip = 0;
let total = 0;
let pages = 0;
while (true) {
    const url = `${ACU_BASE}/SalesInvoice?$expand=Details&$top=100&$skip=${skip}&$filter=${filter}`;
    const res = await fetch(url, { headers: { Cookie: cookie } });
    const data = await res.json();
    if (!res.ok) {
        console.error("FAIL", res.status, JSON.stringify(data).slice(0, 400));
        break;
    }
    const batch = data.value || [];
    total += batch.length;
    pages++;
    console.log(`page ${pages}: ${batch.length} (${Date.now() - t0}ms total)`);
    if (batch.length < 100) break;
    skip += 100;
}
console.log(`Done: ${total} invoices in ${pages} pages, ${Date.now() - t0}ms`);
