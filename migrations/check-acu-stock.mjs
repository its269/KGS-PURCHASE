/**
 * Diagnostic script: Logs into Acumatica and fetches one StockItem
 * with WarehouseDetails to show the raw field names.
 *
 * Usage: node migrations/check-acu-stock.mjs
 */
import fs from "fs";
import https from "https";

// Parse .env manually (no dotenv required)
const envPath = new URL("../.env", import.meta.url);
const envLocalPath = new URL("../.env.local", import.meta.url);
const envFile = fs.existsSync(envLocalPath) ? envLocalPath : envPath;
const env = fs.readFileSync(envFile, "utf8")
    .split("\n")
    .reduce((acc, line) => {
        const [key, ...rest] = line.split("=");
        if (key && !key.trim().startsWith("#")) {
            acc[key.trim()] = rest.join("=").trim().replace(/^['"]|['"]$/g, "");
        }
        return acc;
    }, {});

const ACU_BASE = `${env.ACUMATICA_BASE_URL}/entity/Default/20.200.001`;
const ACU_HOST = env.ACUMATICA_BASE_URL.replace("/ERP", "");

async function apiFetch(url, options = {}) {
    const res = await fetch(url, {
        ...options,
        headers: { "Accept": "application/json", "Content-Type": "application/json", ...(options.headers || {}) },
    });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }
    return { status: res.status, headers: res.headers, data };
}

async function main() {
    // Step 1: Try OAuth2 first, fall back to cookie auth
    console.log("1. Logging in to Acumatica...");
    let cookies = "";
    let bearerToken = "";

    // Try OAuth2 token auth
    try {
        const tokenRes = await fetch(`${ACU_HOST}/identity/connect/token`, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
                grant_type: "password",
                client_id: "frontend",
                client_secret: "",
                username: env.ACU_USERNAME,
                password: env.ACU_PASSWORD,
                scope: "api",
            }).toString(),
        });
        if (tokenRes.ok) {
            const td = await tokenRes.json();
            if (td.access_token) {
                bearerToken = td.access_token;
                console.log("   OAuth2 token auth OK.");
            }
        } else {
            console.log("   OAuth2 failed:", tokenRes.status);
        }
    } catch (e) {
        console.log("   OAuth2 error:", e.message);
    }

    // Fall back to cookie auth if OAuth2 failed
    if (!bearerToken) {
        try { await apiFetch(`${env.ACUMATICA_BASE_URL}/entity/auth/logout`, { method: "POST" }); } catch { }
        const loginRes = await apiFetch(`${env.ACUMATICA_BASE_URL}/entity/auth/login`, {
            method: "POST",
            body: JSON.stringify({ name: env.ACU_USERNAME, password: env.ACU_PASSWORD }),
        });
        if (loginRes.status !== 204 && loginRes.status !== 200) {
            console.error("Cookie login failed:", loginRes.status, JSON.stringify(loginRes.data).slice(0, 200));
            process.exit(1);
        }
        const setCookies = loginRes.headers.getSetCookie?.() || [];
        cookies = setCookies.map(c => c.split(";")[0].trim()).join("; ");
        console.log("   Cookie auth OK. Cookies:", cookies.slice(0, 80) + "...");
    }

    // Helper: build auth headers
    const authHeaders = bearerToken
        ? { "Authorization": `Bearer ${bearerToken}` }
        : { "Cookie": cookies };

    // Step 2: Fetch one item WITH WarehouseDetails
    console.log("\n2. Fetching 1 StockItem with WarehouseDetails...");
    const itemRes = await apiFetch(
        `${ACU_BASE}/StockItem?$expand=WarehouseDetails&$top=1`,
        { headers: authHeaders }
    );

    if (itemRes.status !== 200) {
        console.error("Fetch failed:", itemRes.status, JSON.stringify(itemRes.data).slice(0, 500));
        process.exit(1);
    }

    const items = itemRes.data.value || (Array.isArray(itemRes.data) ? itemRes.data : []);
    if (items.length === 0) {
        console.log("No items returned.");
        process.exit(0);
    }

    const item = items[0];
    const wds = item.WarehouseDetails || [];

    console.log("\n=== StockItem top-level keys ===");
    console.log(Object.keys(item).join(", "));

    console.log(`\n=== WarehouseDetails (${Array.isArray(wds) ? wds.length : "non-array"} rows) ===`);
    if (Array.isArray(wds) && wds.length > 0) {
        console.log("Keys in first WarehouseDetail row:", Object.keys(wds[0]).join(", "));
        console.log("\nFirst WarehouseDetail row (raw):");
        console.log(JSON.stringify(wds[0], null, 2));
    } else {
        console.log("No WarehouseDetails found. Raw WarehouseDetails value:", JSON.stringify(wds));

        // If WarehouseDetails is an object with .value
        if (wds && typeof wds === "object" && wds.value) {
            const arr = wds.value;
            console.log(`Found ${arr.length} rows in .value`);
            if (arr.length > 0) {
                console.log("Keys:", Object.keys(arr[0]).join(", "));
                console.log(JSON.stringify(arr[0], null, 2));
            }
        }
    }

    // Step 3: List all available endpoints in Default schema
    console.log("\n3. Listing all available entities in Default/20.200.001...");
    const schemaRes = await apiFetch(ACU_BASE, { headers: authHeaders });
    if (schemaRes.status === 200) {
        const entities = schemaRes.data.value || (Array.isArray(schemaRes.data) ? schemaRes.data : []);
        const names = entities.map(e => e.name || e.Name || JSON.stringify(e)).sort();
        console.log(`   Total entities: ${names.length}`);
        const stockRelated = names.filter(n => /stock|inv|qty|item|site|warehouse|level|balance|summ/i.test(n));
        console.log("   Stock-related:", stockRelated.join(", ") || "(none found)");
        console.log("   All entities:", names.join(", "));
    } else {
        console.log(`   Schema list status: ${schemaRes.status} — ${JSON.stringify(schemaRes.data).slice(0, 200)}`);
    }

    // Step 4: Check if QtyOnHand is populated for ANY item by scanning more
    console.log("\n4. Scanning first 500 items for any non-zero QtyOnHand...");
    let totalScanned = 0, nonZeroCount = 0;
    for (let skip = 0; skip < 500; skip += 50) {
        const r = await apiFetch(`${ACU_BASE}/StockItem?$expand=WarehouseDetails&$top=50&$skip=${skip}`, { headers: authHeaders });
        const its = r.data.value || [];
        if (its.length === 0) break;
        totalScanned += its.length;
        for (const it of its) {
            const wds = Array.isArray(it.WarehouseDetails) ? it.WarehouseDetails : [];
            for (const w of wds) {
                const qty = w.QtyOnHand?.value ?? w.QtyOnHand ?? 0;
                if (Number(qty) > 0) {
                    nonZeroCount++;
                    if (nonZeroCount <= 5) console.log(`   ${it.InventoryID?.value} / ${w.WarehouseID?.value} = ${qty}`);
                }
            }
        }
        process.stdout.write(`   Scanned ${totalScanned}...\r`);
        if (its.length < 50) break;
    }
    console.log(`\n   Result: ${nonZeroCount} non-zero rows found in ${totalScanned} items.`);

    // Cleanup: log out
    try { await apiFetch(`${env.ACUMATICA_BASE_URL}/entity/auth/logout`, { method: "POST", headers: authHeaders }); } catch { }

    process.exit(0);
}

main().catch(err => {
    console.error("Error:", err.message);
    process.exit(1);
});
