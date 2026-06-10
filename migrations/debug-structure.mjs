import fs from "fs";

const env = fs.readFileSync(new URL("../.env", import.meta.url), "utf8")
    .split("\n").reduce((acc, line) => {
        const [k, ...v] = line.split("=");
        if (k && !k.trim().startsWith("#")) acc[k.trim()] = v.join("=").trim().replace(/^['"]|['"]$/g, "");
        return acc;
    }, {});

const ACU_HOST = "https://accounting.holocrontrackertrading.com";
const ACU_BASE = `${ACU_HOST}/ERP/entity/Default/20.200.001`;

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

async function main() {
    // Login
    const loginRes = await fetch(`${ACU_HOST}/ERP/entity/auth/login`, {
        method: "POST",
        headers: { "Accept": "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({ name: env.ACU_USERNAME, password: env.ACU_PASSWORD }),
    });
    const cookies = (loginRes.headers.getSetCookie?.() || []).map(c => c.split(";")[0]).join("; ");
    console.log("Logged in.");

    // PurchaseOrder
    console.log("\n--- Checking PurchaseOrder with Details ---");
    const r3 = await fetch(`${ACU_BASE}/PurchaseOrder?$top=1&$expand=Details`, {
        headers: { "Accept": "application/json", "Cookie": cookies },
    });
    const data3 = await r3.json();
    const po = data3.value?.[0] || data3?.[0];

    if (po) {
        console.log("OrderNbr:", po.OrderNbr?.value || po.OrderNbr);
        const details = po.Details?.value || po.Details || [];
        if (details.length > 0) {
            console.log("PO Detail Sample Fields:", Object.keys(details[0]).sort().join(", "));
            console.log("Sample PO Detail:", JSON.stringify(details[0], null, 2));
        }
    }
}

main().catch(err => console.error(err));
