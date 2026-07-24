process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
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
if (!loginRes.ok) throw new Error(`login ${loginRes.status}`);
const cookie = loginRes.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");

const acuBase = `${base}/entity/Default/20.200.001`;
const url = `${acuBase}/StockItem?$expand=WarehouseDetails&$top=5&$filter=substringof('130421440330127', InventoryID)`;
const res = await fetch(url, { headers: { Cookie: cookie, Accept: "application/json" } });
const data = await res.json();
const items = data.value || [];
console.log("items:", items.length);
for (const item of items) {
    let wds = item.WarehouseDetails || [];
    if (wds?.value) wds = wds.value;
    console.log("ID", item.InventoryID?.value || item.InventoryID, "warehouses:", wds.length);
    for (const wh of (wds || []).slice(0, 8)) {
        const site = wh.SiteID?.value || wh.Branch?.value || wh.WarehouseID?.value;
        const oh = wh.QtyOnHand?.value ?? wh.OnHand?.value;
        console.log(" ", site, "onHand", oh);
    }
}

const countUrl = `${acuBase}/StockItem?$expand=WarehouseDetails&$top=1&$count=true`;
const countRes = await fetch(countUrl, { headers: { Cookie: cookie, Accept: "application/json" } });
const countData = await countRes.json();
console.log("total stock items:", countData["@odata.count"], "returned:", (countData.value || []).length);
