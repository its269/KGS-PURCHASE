import dotenv from "dotenv";
import { AcumaticaService } from "../services/acumatica.js";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const branch = process.argv[2] || "ILOILO";
const base = process.env.ACUMATICA_BASE_URL;

async function login() {
    const res = await fetch(`${base}/entity/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            name: process.env.ACUMATICA_USERNAME || process.env.ACU_USERNAME,
            password: process.env.ACUMATICA_PASSWORD || process.env.ACU_PASSWORD,
            company: process.env.ACUMATICA_COMPANY || "KGSC",
        }),
    });
    if (!res.ok) throw new Error(`Login failed: ${res.status}`);
    return res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
}

const cookie = await login();
console.log(`Fetching Acumatica gross sales for ${branch}...`);
const map = await AcumaticaService.fetchBranchGrossSalesSummary({ cookie, branch });
const top = [...map.entries()].filter(([, v]) => v.qty_sold > 0).sort((a, b) => b[1].qty_sold - a[1].qty_sold).slice(0, 5);
console.log(`Products with gross sales: ${map.size}`);
console.log("Top 5:", top.map(([id, v]) => ({ id, qty: v.qty_sold })));
