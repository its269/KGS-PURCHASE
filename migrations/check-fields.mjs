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

    // Fetch one item
    const r = await fetch(`${ACU_BASE}/StockItem?$top=1`, {
        headers: { "Accept": "application/json", "Cookie": cookies },
    });
    const data = await r.json();
    const item = data.value?.[0] || data?.[0];

    if (item) {
        console.log("\n=== StockItem ===");
        console.log("Fields:", Object.keys(item).sort().join(", "));
        console.log("LastModified:", JSON.stringify(item.LastModified, null, 2));
    }

    // Fetch one invoice
    const r2 = await fetch(`${ACU_BASE}/Invoice?$top=1`, {
        headers: { "Accept": "application/json", "Cookie": cookies },
    });
    const data2 = await r2.json();
    const inv = data2.value?.[0] || data2?.[0];

    if (inv) {
        console.log("\n=== Invoice ===");
        console.log("Fields:", Object.keys(inv).sort().join(", "));
        console.log("LastModified:", JSON.stringify(inv.LastModifiedDateTime, null, 2) || JSON.stringify(inv.LastModified, null, 2));
    }
}

main().catch(err => console.error(err));
