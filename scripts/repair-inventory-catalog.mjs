/**
 * Restore missing __catalog__ rows from warehouse stock (fixes "5 products in MAIN").
 * Usage: node scripts/repair-inventory-catalog.mjs
 */
import mysql from "mysql2/promise";
import dotenv from "dotenv";
import fs from "fs";

dotenv.config({ path: fs.existsSync(".env.local") ? ".env.local" : ".env" });

const TABLE = "product_inventory_items";
const pool = mysql.createPool({
  host: process.env.MYSQL_HOST,
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_INVENTORY_DATABASE || "db_kelin_inventory",
});

async function repair(companyId) {
  const [result] = await pool.query(
    `INSERT INTO \`${TABLE}\`
        (inventory_id, company_id, default_warehouse, inventory_name, item_class,
         default_price, item_status, base_unit, type, posting_class,
         vendor_id, lead_time_days, safety_stock, moq, last_sync)
     SELECT
        TRIM(w.inventory_id),
        w.company_id,
        '__catalog__',
        MAX(NULLIF(TRIM(w.inventory_name), '')),
        MAX(NULLIF(TRIM(w.item_class), '')),
        MAX(w.default_price),
        MAX(NULLIF(TRIM(w.item_status), '')),
        MAX(NULLIF(TRIM(w.base_unit), '')),
        MAX(NULLIF(TRIM(w.type), '')),
        MAX(NULLIF(TRIM(w.posting_class), '')),
        MAX(NULLIF(TRIM(w.vendor_id), '')),
        MAX(w.lead_time_days),
        MAX(w.safety_stock),
        MAX(w.moq),
        MAX(w.last_sync)
     FROM \`${TABLE}\` w
     WHERE w.company_id = ?
       AND w.default_warehouse != '__catalog__'
       AND TRIM(COALESCE(w.inventory_id, '')) != ''
       AND NOT EXISTS (
            SELECT 1 FROM \`${TABLE}\` c
            WHERE c.company_id = w.company_id
              AND c.default_warehouse = '__catalog__'
              AND TRIM(c.inventory_id) = TRIM(w.inventory_id)
       )
     GROUP BY TRIM(w.inventory_id), w.company_id`,
    [companyId]
  );
  return result.affectedRows || 0;
}

const restoredMain = await repair("main");
const restoredEcom = await repair("ecommerce");
const [[r]] = await pool.query(`
  SELECT
    SUM(default_warehouse='__catalog__') catalog_rows,
    SUM(default_warehouse='MAIN') main_rows,
    COUNT(DISTINCT CASE WHEN default_warehouse!='__catalog__' THEN default_warehouse END) warehouses
  FROM \`${TABLE}\` WHERE company_id='main'`);
console.log({ restoredMain, restoredEcom, after: r });
await pool.end();
