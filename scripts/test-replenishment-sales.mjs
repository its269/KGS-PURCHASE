/**
 * Quick check: live Acumatica sales for a branch (same path as Replenishment API).
 * Usage: node scripts/test-replenishment-sales.mjs [branch]
 */
import dotenv from "dotenv";
import { AcumaticaService } from "../services/acumatica.js";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const branch = process.argv[2] || "MAIN";
const base = process.env.ACUMATICA_BASE_URL;

async function login() {
    const res = await fetch(`${base}/entity/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            name: process.env.ACUMATICA_USERNAME || process.env.ACU_USERNAME,
            password: process.env.ACUMATICA_PASSWORD || process.env.ACU_PASSWORD,
            company: process.env.ACUMATICA_COMPANY || process.env.ACU_COMPANY || "KGSC",
        }),
    });
    if (!res.ok) throw new Error(`Login failed: ${res.status}`);
    return res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
}

const cookie = await login();
console.log(`Fetching 90-day net sales for branch: ${branch}`);

const map = await AcumaticaService.fetchBranchSalesSummary({ cookie, branch });
const top = [...map.entries()]
    .filter(([, v]) => v.qty_sold > 0)
    .sort((a, b) => b[1].qty_sold - a[1].qty_sold)
    .slice(0, 8)
    .map(([id, v]) => ({
        id,
        net90: v.qty_sold,
        sellsPerDay: (v.qty_sold / 90).toFixed(2),
    }));

console.log(`Products with net sales: ${map.size}`);
console.log("Top items:", top);

await fetch(`${base}/entity/auth/logout`, { method: "POST", headers: { Cookie: cookie } }).catch(() => {});
