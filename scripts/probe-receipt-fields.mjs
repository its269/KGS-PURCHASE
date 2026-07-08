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
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

async function main() {
    const loginRes = await fetch(`${env.ACUMATICA_BASE_URL}/entity/auth/login`, {
        method: "POST",
        headers: { "Accept": "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({ name: env.ACU_USERNAME, password: env.ACU_PASSWORD }),
    });
    const cookies = (loginRes.headers.getSetCookie?.() || []).map(c => c.split(";")[0]).join("; ");

    const poRes = await fetch(`${ACU_BASE}/PurchaseOrder?$top=1&$expand=Details`, {
        headers: { "Accept": "application/json", "Cookie": cookies },
    });
    const poData = await poRes.json();
    const po = poData.value?.[0] || poData?.[0] || (Array.isArray(poData) ? poData[0] : null);
    if (!po) {
        console.log("No PO returned", poRes.status, JSON.stringify(poData).slice(0, 200));
        return;
    }

    const dateFields = Object.keys(po).filter(k => /date|receipt|promis|complet/i.test(k));
    console.log("PO header date-like fields:", dateFields.join(", "));
    for (const f of dateFields) {
        console.log(`  ${f}:`, JSON.stringify(po[f]));
    }

    const prRes = await fetch(`${ACU_BASE}/PurchaseReceipt?$top=3&$expand=Details&$filter=Date ge datetimeoffset'2024-01-01T00:00:00Z'`, {
        headers: { "Accept": "application/json", "Cookie": cookies },
    });
    console.log("\nPurchaseReceipt status:", prRes.status);
    if (prRes.ok) {
        const prData = await prRes.json();
        const receipts = prData.value || (Array.isArray(prData) ? prData : []);
        console.log("Receipt count:", receipts.length);
        for (const pr of receipts.slice(0, 2)) {
            const fields = Object.keys(pr).filter(k => /date|receipt|promis|complet/i.test(k));
            console.log("\nReceipt", pr.ReceiptNbr?.value, "fields:", fields.join(", "));
            for (const f of fields) {
                console.log(`  ${f}:`, JSON.stringify(pr[f]));
            }
            const details = pr.Details?.value || pr.Details || [];
            if (details[0]) {
                const lineFields = Object.keys(details[0]).filter(k => /date|receipt|promis|complet|order/i.test(k));
                console.log("  Detail fields:", lineFields.join(", "));
                for (const f of lineFields) {
                    console.log(`    ${f}:`, JSON.stringify(details[0][f]));
                }
            }
        }
    }
}

main().catch(console.error);
