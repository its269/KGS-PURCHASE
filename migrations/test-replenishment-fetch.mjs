
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
    console.log("Testing Replenishment Fetch...");
    
    // Login
    const loginRes = await fetch(`${env.ACUMATICA_BASE_URL}/entity/auth/login`, {
        method: "POST",
        headers: { "Accept": "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({ 
            name: env.ACUMATICA_USERNAME, 
            password: env.ACUMATICA_PASSWORD,
            company: env.ACUMATICA_COMPANY
        }),
    });

    if (!loginRes.ok) {
        console.error("Login failed", await loginRes.text());
        return;
    }

    const cookie = loginRes.headers.getSetCookie().map(c => c.split(";")[0]).join("; ");
    console.log("Logged in.");

    // Test with ItemStatus filter
    const url1 = `${ACU_BASE}/StockItem?$top=5&$filter=ItemStatus eq 'Active'`;
    console.log("Fetching with ItemStatus eq 'Active'...");
    const res1 = await fetch(url1, { headers: { Cookie: cookie } });
    const data1 = await res1.json();
    console.log("Active count:", data1.value?.length || 0);

    // Test without filter
    const url2 = `${ACU_BASE}/StockItem?$top=5`;
    console.log("Fetching without filter...");
    const res2 = await fetch(url2, { headers: { Cookie: cookie } });
    const data2 = await res2.json();
    console.log("Total count (top 5):", data2.value?.length || 0);
    if (data2.value?.[0]) {
        console.log("Example Item Status:", data2.value[0].ItemStatus?.value);
    }

    // Logout
    await fetch(`${env.ACUMATICA_BASE_URL}/entity/auth/logout`, { method: "POST", headers: { Cookie: cookie } });
}

main().catch(console.error);
