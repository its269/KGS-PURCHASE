/**
 * Probe available vs on_hand and key mismatches for BACOLOD.
 */
import dotenv from "dotenv";
import mysql from "mysql2/promise";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const pur = process.env.MYSQL_PURCHASE_DATABASE || "db_purchase";
const pool = mysql.createPool({
    host: process.env.MYSQL_HOST,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
});

try {
    const [availDiff] = await pool.query(
        `SELECT COUNT(*) AS n,
                SUM(CASE WHEN available > on_hand THEN 1 ELSE 0 END) AS avail_gt,
                SUM(CASE WHEN available < on_hand THEN 1 ELSE 0 END) AS avail_lt,
                SUM(CASE WHEN available = on_hand THEN 1 ELSE 0 END) AS avail_eq
         FROM \`${pur}\`.forecast_item_stock
         WHERE company_id = 'main' AND UPPER(TRIM(warehouse_id)) = 'BACOLOD'`
    );
    console.log("BACOLOD available vs on_hand:", availDiff[0]);

    const [miss] = await pool.query(
        `SELECT c.inventory_id, c.current_stock, c.description
         FROM \`${pur}\`.replenishment_cache c
         LEFT JOIN \`${pur}\`.forecast_item_stock f
           ON f.company_id = 'main'
          AND UPPER(TRIM(f.warehouse_id)) = 'BACOLOD'
          AND UPPER(TRIM(f.inventory_id)) = UPPER(TRIM(c.inventory_id))
         WHERE c.company_id = 'main' AND UPPER(TRIM(c.branch_id)) = 'BACOLOD'
           AND f.inventory_id IS NULL
           AND COALESCE(c.current_stock, 0) > 0
         LIMIT 10`
    );
    console.log("Cache stock>0 missing forecast (trim join):");
    console.table(miss);

    for (const r of miss) {
        const id = String(r.inventory_id || "");
        const [fis] = await pool.query(
            `SELECT inventory_id, warehouse_id, on_hand, available
             FROM \`${pur}\`.forecast_item_stock
             WHERE company_id = 'main'
               AND UPPER(REPLACE(TRIM(inventory_id), ' ', '')) = UPPER(REPLACE(TRIM(?), ' ', ''))
               AND UPPER(TRIM(warehouse_id)) = 'BACOLOD'`,
            [id]
        );
        console.log("space-strip find for", JSON.stringify(id), fis);
    }
} finally {
    await pool.end();
}
