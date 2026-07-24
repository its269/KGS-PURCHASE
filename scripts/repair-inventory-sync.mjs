/**
 * Repair inventory warehouse levels from Acumatica (no purge).
 * Usage: node scripts/repair-inventory-sync.mjs
 */
import dotenv from "dotenv";
import mysql from "mysql2/promise";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const ACU_BASE = `${process.env.ACUMATICA_BASE_URL}/entity/Default/20.200.001`;

const getF = (obj, keyName) => {
    if (!obj) return "";
    const k = Object.keys(obj).find((i) => i.toLowerCase() === keyName.toLowerCase());
    if (!k) return "";
    const val = obj[k];
    if (val === null || val === undefined) return "";
    if (typeof val === "object") return val.value ?? "";
    return val;
};

const getAny = (obj, ...keys) => {
    for (const k of keys) {
        const v = getF(obj, k);
        if (v !== "" && v !== null && v !== undefined) return v;
    }
    return "";
};

function extractLevels(item, catalog) {
    const invId = String(getF(item, "InventoryID")).trim();
    if (!invId) return [];
    let wds = item.WarehouseDetails || [];
    if (wds && !Array.isArray(wds) && wds.value) wds = wds.value;
    if (!Array.isArray(wds)) wds = [];
    const levels = [];
    for (const wh of wds) {
        const siteId = String(getAny(wh, "SiteID", "Branch", "BranchID", "WarehouseID") || "").trim();
        if (!siteId) continue;
        const onHand = parseFloat(getAny(wh, "QtyOnHand", "OnHand", "Qty") || 0);
        let available = parseFloat(getAny(wh, "QtyAvailable", "Available") || 0);
        if (Number.isNaN(available)) available = onHand;
        levels.push({
            inventory_id: invId,
            branch_id: siteId,
            site_id: siteId,
            on_hand: Number.isNaN(onHand) ? 0 : onHand,
            available: Number.isNaN(available) ? 0 : available,
            description: catalog.description,
            item_class: catalog.item_class,
            default_price: catalog.default_price,
            item_status: catalog.item_status,
        });
    }
    return levels;
}

const pool = mysql.createPool({
    host: process.env.MYSQL_HOST,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_INVENTORY_DATABASE || "db_kelin_inventory",
});

const loginRes = await fetch(`${process.env.ACUMATICA_BASE_URL}/entity/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
        name: process.env.ACUMATICA_USERNAME || process.env.ACU_USERNAME,
        password: process.env.ACUMATICA_PASSWORD || process.env.ACU_PASSWORD,
        company: process.env.ACUMATICA_COMPANY || process.env.ACU_COMPANY || "KGSC",
    }),
});
if (!loginRes.ok) throw new Error(`Login failed: ${loginRes.status}`);
const cookie = loginRes.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");

const ECOM = new Set(["ECOM", "ECOMMERCE", "E-COMMERCE", "E COMMERCE"]);
const now = new Date();
let skip = 0;
const top = 50;
let itemsProcessed = 0;
let levelsUpserted = 0;
const levelBuffer = [];

async function flushLevels(buffer) {
    if (!buffer.length) return;
    const placeholders = buffer.map(() => "(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").join(",");
    const values = buffer.flatMap((l) => [
        l.inventory_id,
        l.companyId,
        l.branch_id,
        l.description || null,
        l.item_class || null,
        l.default_price || 0,
        l.item_status || "Active",
        l.base_unit || "",
        l.item_type || "",
        l.posting_class || "",
        l.branch_id,
        l.site_id,
        l.on_hand,
        l.available,
        now,
    ]);
    await pool.query(
        `INSERT INTO inventory_items
            (inventory_id, company_id, default_warehouse, inventory_name, item_class,
             default_price, item_status, base_unit, type, posting_class,
             branch_id, site_id, on_hand, available, last_sync)
         VALUES ${placeholders}
         ON DUPLICATE KEY UPDATE
            on_hand = VALUES(on_hand),
            available = VALUES(available),
            branch_id = VALUES(branch_id),
            site_id = VALUES(site_id),
            inventory_name = COALESCE(VALUES(inventory_name), inventory_name),
            last_sync = VALUES(last_sync)`,
        values
    );
    levelsUpserted += buffer.length;
    buffer.length = 0;
}

while (true) {
    const url = `${ACU_BASE}/StockItem?$expand=WarehouseDetails&$top=${top}&$skip=${skip}`;
    const res = await fetch(url, { headers: { Cookie: cookie, Accept: "application/json" } });
    const data = await res.json();
    const items = data.value || (Array.isArray(data) ? data : []);
    if (!items.length) {
        if (skip === 0) {
            console.error("No StockItem rows from Acumatica.", res.status, data.message || data.error || Object.keys(data).slice(0, 8));
        }
        break;
    }

    for (const item of items) {
        const catalog = {
            description: getF(item, "Description"),
            item_class: getF(item, "ItemClass"),
            default_price: parseFloat(getF(item, "DefaultPrice") || 0),
            item_status: getF(item, "ItemStatus") || "Active",
            item_type: getF(item, "ItemType") || "",
            base_unit: getF(item, "BaseUnit") || "",
            posting_class: getF(item, "PostingClass") || "",
        };
        const levels = extractLevels(item, catalog);
        for (const l of levels) {
            const companyId = ECOM.has(l.branch_id.toUpperCase()) ? "ecommerce" : "main";
            levelBuffer.push({ ...l, companyId, item_type: l.item_type || "" });
            if (levelBuffer.length >= 200) await flushLevels(levelBuffer);
        }
        itemsProcessed++;
    }

    await flushLevels(levelBuffer);

    process.stdout.write(`\rProcessed ${itemsProcessed} items, ${levelsUpserted} warehouse rows...`);
    skip += items.length;
    if (items.length < top) break;
}

const [[{ c }]] = await pool.query(
    "SELECT COUNT(*) AS c FROM inventory_items WHERE default_warehouse != '__catalog__'"
);
console.log(`\nDone. Warehouse rows in DB: ${c}`);
await pool.end();
