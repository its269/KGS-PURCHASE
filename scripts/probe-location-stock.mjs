/**
 * Probe Acumatica for location-level stock (DAMAGE / DISCOUNTED).
 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
import dotenv from "dotenv";
import fs from "fs";

dotenv.config({ path: fs.existsSync(".env.local") ? ".env.local" : ".env" });

const base = process.env.ACUMATICA_BASE_URL;
const loginRes = await fetch(`${base}/entity/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
        name: process.env.ACUMATICA_USERNAME || process.env.ACU_USERNAME,
        password: process.env.ACUMATICA_PASSWORD || process.env.ACU_PASSWORD,
        company: process.env.ACUMATICA_COMPANY,
    }),
});
if (!loginRes.ok) {
    console.error("login", loginRes.status, await loginRes.text());
    process.exit(1);
}
const cookie =
    (loginRes.headers.getSetCookie?.() || []).map((c) => c.split(";")[0]).join("; ") ||
    loginRes.headers.get("set-cookie");
const acu = `${base}/entity/Default/20.200.001`;

const ids = ["110306005001000", "110106005001000"];

async function get(path) {
    const res = await fetch(`${acu}${path}`, {
        headers: { Cookie: cookie, Accept: "application/json" },
    });
    const text = await res.text();
    console.log(`\nGET ${path}\n  status=${res.status} len=${text.length}`);
    try {
        return JSON.parse(text);
    } catch {
        console.log(text.slice(0, 800));
        return null;
    }
}

async function put(path, body) {
    const res = await fetch(`${acu}${path}`, {
        method: "PUT",
        headers: {
            Cookie: cookie,
            Accept: "application/json",
            "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
    });
    const text = await res.text();
    console.log(`\nPUT ${path}\n  status=${res.status} len=${text.length}`);
    try {
        return JSON.parse(text);
    } catch {
        console.log(text.slice(0, 800));
        return null;
    }
}

for (const id of ids) {
    const filter = encodeURIComponent(`InventoryID eq '${id}'`);
    const data = await get(`/StockItem?$expand=WarehouseDetails&$top=1&$filter=${filter}`);
    console.log("StockItem response keys:", data && Object.keys(data));
    console.log("value length:", data?.value?.length, "has InventoryID:", !!data?.InventoryID);
    const item = data?.value?.[0] || (data?.InventoryID ? data : null);
    if (!item) {
        // try substringof
        const data2 = await get(
            `/StockItem?$expand=WarehouseDetails&$top=5&$filter=${encodeURIComponent(`substringof('${id}', InventoryID)`)}`
        );
        console.log("substringof count:", data2?.value?.length);
        for (const it of data2?.value || []) {
            console.log(" found", it.InventoryID?.value);
        }
    } else {
        let wds = item.WarehouseDetails || [];
        if (wds?.value) wds = wds.value;
        console.log(`StockItem ${item.InventoryID?.value} WarehouseDetails:`, (wds || []).length);
        console.log("WarehouseDetails keys sample:", Object.keys(wds[0] || {}));
        for (const wh of wds || []) {
            const site = wh.SiteID?.value || wh.WarehouseID?.value;
            console.log(
                `  wh=${site} onHand=${wh.QtyOnHand?.value} avail=${wh.QtyAvailable?.value}`
            );
        }
    }

    const summary = await put(`/InventorySummaryInquiry?$expand=Results`, {
        InventoryID: { value: id },
    });
    if (summary) {
        console.log("Summary top keys:", Object.keys(summary));
        let results = summary.Results || [];
        if (results?.value) results = results.value;
        console.log(`Results count: ${Array.isArray(results) ? results.length : typeof results}`);
        for (const row of (results || []).slice(0, 30)) {
            console.log(
                " ",
                JSON.stringify({
                    Warehouse: row.WarehouseID?.value ?? row.SiteID?.value,
                    Location: row.LocationID?.value ?? row.Location?.value,
                    OnHand: row.QtyOnHand?.value ?? row.BaseQty?.value,
                    Available: row.QtyAvailable?.value ?? row.Available?.value,
                    AvailableForShipping: row.QtyAvailableForShipping?.value,
                })
            );
        }
        if (results?.[0]) console.log("Result row keys:", Object.keys(results[0]));
        else console.log("Summary sample:", JSON.stringify(summary).slice(0, 1500));
    }
}
