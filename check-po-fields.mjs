import fs from "fs";

const env = fs.readFileSync(".env", "utf8")
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

    // Fetch one PO
    const r = await fetch(`${ACU_BASE}/PurchaseOrder?$top=1`, {
        headers: { "Accept": "application/json", "Cookie": cookies },
    });
    const data = await r.json();
    const po = data.value?.[0] || data?.[0];

    if (po) {
        console.log("\n=== PurchaseOrder ===");
        console.log("Fields:", Object.keys(po).sort().join(", "));
        console.log("Sample Data:", JSON.stringify(po, null, 2));
    } else {
        console.log("No PO found.");
    }
}

main().catch(err => console.error(err));
