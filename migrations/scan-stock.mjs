/**
 * Quick scan: login once, immediately fetch 100 items, count non-zero QtyOnHand.
 * Usage: node migrations/scan-stock.mjs
 */
import fs from "fs";

const envPath = new URL("../.env", import.meta.url);
const envLocalPath = new URL("../.env.local", import.meta.url);
const envFile = fs.existsSync(envLocalPath) ? envLocalPath : envPath;
const env = fs.readFileSync(envFile, "utf8")
    .split("\n").reduce((acc, line) => {
        const [k, ...v] = line.split("=");
        if (k && !k.trim().startsWith("#")) acc[k.trim()] = v.join("=").trim().replace(/^['"]|['"]$/g, "");
        return acc;
    }, {});

const ACU_BASE = `${env.ACUMATICA_BASE_URL}/entity/Default/20.200.001`;

async function main() {
    // Logout any lingering session
    try { await fetch(`${env.ACUMATICA_BASE_URL}/entity/auth/logout`, { method: "POST" }); } catch { }

    // Login
    const loginRes = await fetch(`${env.ACUMATICA_BASE_URL}/entity/auth/login`, {
        method: "POST",
        headers: { "Accept": "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({ name: env.ACU_USERNAME, password: env.ACU_PASSWORD }),
    });
    if (!loginRes.ok) {
        const t = await loginRes.text();
        console.error("Login failed:", loginRes.status, t.slice(0, 300));
        process.exit(1);
    }
    const cookies = (loginRes.headers.getSetCookie?.() || []).map(c => c.split(";")[0]).join("; ");
    console.log("Logged in OK.");

    // Fetch with expand, small batch — handle both OData {value:[]} and plain array
    const r = await fetch(`${ACU_BASE}/StockItem?$expand=WarehouseDetails&$top=20`, {
        headers: { "Accept": "application/json", "Cookie": cookies },
    });
    const raw = await r.json();
    const items = raw.value || (Array.isArray(raw) ? raw : []);
    console.log(`Fetched ${items.length} items with WarehouseDetails.`);

    let nonZero = 0, totalRows = 0;
    const examples = [];
    for (const item of items) {
        const invId = item.InventoryID?.value || "?";
        const wds = Array.isArray(item.WarehouseDetails) ? item.WarehouseDetails : [];
        for (const w of wds) {
            totalRows++;
            const qty = w.QtyOnHand?.value ?? 0;
            if (Number(qty) > 0) {
                nonZero++;
                if (examples.length < 5) examples.push(`${invId}/${w.WarehouseID?.value}=${qty}`);
            }
        }
    }

    console.log(`Warehouse rows: ${totalRows}, non-zero QtyOnHand: ${nonZero}`);
    if (examples.length) console.log("Examples:", examples.join(", "));
    else console.log("All QtyOnHand values are 0.");

    // Logout
    try { await fetch(`${ACU_HOST}/ERP/entity/auth/logout`, { method: "POST", headers: { "Cookie": cookies } }); } catch { }
}

main().catch(err => { console.error(err.message); process.exit(1); });
