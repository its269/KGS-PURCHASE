
import fs from "fs";

const env = fs.readFileSync(new URL("../.env", import.meta.url), "utf8")
    .split("\n").reduce((acc, line) => {
        const [k, ...v] = line.split("=");
        if (k && !k.trim().startsWith("#")) acc[k.trim()] = v.join("=").trim().replace(/^['"]|['"]$/g, "");
        return acc;
    }, {});

async function debugPO() {
    const BASE = "http://localhost:3000";
    const loginRes = await fetch(`${BASE}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: env.ACU_USERNAME, password: env.ACU_PASSWORD }),
    });
    const sessionCookie = (loginRes.headers.getSetCookie?.() || [])
        .map(c => c.split(";")[0].trim()).join("; ");

    const ACU_URL = "https://accounting.holocrontrackertrading.com/ERP/entity/Default/20.200.001/PurchaseOrder?$top=1";
    console.log("Fetching one PO to check structure...");
    const res = await fetch(ACU_URL, {
        headers: { "Cookie": sessionCookie }
    });
    if (!res.ok) {
        console.error("Fetch failed:", res.status, await res.text());
        return;
    }
    const data = await res.json();
    console.log(JSON.stringify(data[0] || data.value?.[0], null, 2));
}

debugPO();
