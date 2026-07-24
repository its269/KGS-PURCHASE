/**
 * Test extractWarehouseLevels + MySQL upsert (same path as sync).
 */
import dotenv from "dotenv";
import mysql from "mysql2/promise";
import { extractStockItemCatalog, extractWarehouseLevels } from "../services/acumatica.js";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const ACU_BASE = `${process.env.ACUMATICA_BASE_URL}/entity/Default/20.200.001`;
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const loginRes = await fetch(`${process.env.ACUMATICA_BASE_URL}/entity/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
        name: process.env.ACUMATICA_USERNAME || process.env.ACU_USERNAME,
        password: process.env.ACUMATICA_PASSWORD || process.env.ACU_PASSWORD,
        company: process.env.ACUMATICA_COMPANY || process.env.ACU_COMPANY || "KGSC",
    }),
});
const cookie = loginRes.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");

const res = await fetch(`${ACU_BASE}/StockItem?$expand=WarehouseDetails&$top=5`, {
    headers: { Cookie: cookie, Accept: "application/json" },
});
const items = (await res.json()).value || [];

let levelCount = 0;
const levels = [];
for (const item of items) {
    const catalog = extractStockItemCatalog(item);
    const lv = extractWarehouseLevels(item, catalog || {});
    levelCount += lv.length;
    levels.push(...lv);
}
console.log("Items:", items.length, "Levels extracted:", levelCount);
if (levels[0]) console.log("Sample level:", levels[0]);

if (levels.length > 0) {
    const pool = mysql.createPool({
        host: process.env.MYSQL_HOST,
        user: process.env.MYSQL_USER,
        password: process.env.MYSQL_PASSWORD,
        database: process.env.MYSQL_INVENTORY_DATABASE || "db_kelin_inventory",
    });
    const test = levels.slice(0, 3);
    const now = new Date();
    for (const l of test) {
        await pool.query(
            `INSERT INTO inventory_items
                (inventory_id, company_id, default_warehouse, inventory_name, branch_id, site_id, on_hand, available, last_sync)
             VALUES (?, 'main', ?, ?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE on_hand=VALUES(on_hand), available=VALUES(available), last_sync=VALUES(last_sync)`,
            [l.inventory_id, l.branch_id, l.description || null, l.branch_id, l.site_id, l.on_hand, l.available, now]
        );
    }
    const [[c]] = await pool.query(
        "SELECT COUNT(*) AS c FROM inventory_items WHERE default_warehouse != '__catalog__'"
    );
    console.log("Warehouse rows after test insert:", c.c);
    await pool.end();
}
