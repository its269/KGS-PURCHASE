/**
 * Verify MAIN inventory + Coming PO for sample SKUs shown as 0 in Replenishment.
 * Usage: node scripts/diag-main-stock-po.mjs
 */
import dotenv from "dotenv";
import mysql from "mysql2/promise";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const pur = process.env.MYSQL_PURCHASE_DATABASE || "db_purchase";
const inv = process.env.MYSQL_INVENTORY_DATABASE || "db_kelin_inventory";
const ids = [
    "2000000SCMDP01",
    "200000MHPWSB01",
    "2000000SCMDP04",
    "200000WP9X901",
    "200000000UCF29",
].map((id) => id.toUpperCase().replace(/\s+/g, "").trim());

const pool = mysql.createPool({
    host: process.env.MYSQL_HOST,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
});

const mainWarehouses = ["MAIN", "MAIN WH11"];

try {
    for (const id of ids) {
        const [fis] = await pool.query(
            `SELECT warehouse_id, branch_id, on_hand, available, last_sync
             FROM \`${pur}\`.forecast_item_stock
             WHERE company_id = 'main'
               AND UPPER(REPLACE(TRIM(inventory_id), ' ', '')) = ?
               AND UPPER(TRIM(warehouse_id)) IN (?, ?)
             ORDER BY warehouse_id`,
            [id, ...mainWarehouses]
        );
        const [fisAny] = await pool.query(
            `SELECT warehouse_id, on_hand, available
             FROM \`${pur}\`.forecast_item_stock
             WHERE company_id = 'main'
               AND UPPER(REPLACE(TRIM(inventory_id), ' ', '')) = ?
               AND COALESCE(on_hand, 0) > 0
             ORDER BY on_hand DESC
             LIMIT 8`,
            [id]
        );
        const [ii] = await pool.query(
            `SELECT default_warehouse, branch_id, on_hand, available
             FROM \`${inv}\`.inventory_items
             WHERE company_id = 'main'
               AND default_warehouse != '__catalog__'
               AND UPPER(REPLACE(TRIM(inventory_id), ' ', '')) = ?
               AND (UPPER(TRIM(default_warehouse)) IN (?, ?)
                 OR UPPER(TRIM(branch_id)) IN (?, ?))`,
            [id, ...mainWarehouses, ...mainWarehouses]
        );
        const [pos] = await pool.query(
            `SELECT h.order_nbr, h.status,
                    d.warehouse_id, d.branch_id AS line_branch,
                    d.qty, d.received_qty,
                    GREATEST(d.qty - COALESCE(d.received_qty, 0), 0) AS open_qty
             FROM \`${pur}\`.purchase_order_details d
             INNER JOIN \`${pur}\`.purchase_history h
               ON h.order_nbr COLLATE utf8mb4_unicode_ci = d.order_nbr
             WHERE UPPER(REPLACE(TRIM(d.inventory_id), ' ', '')) = ?
               AND UPPER(TRIM(h.status)) IN ('OPEN','BALANCED','PENDING APPROVAL','PENDING PRINTING','PENDING EMAIL')
               AND GREATEST(d.qty - COALESCE(d.received_qty, 0), 0) > 0
             ORDER BY h.order_nbr
             LIMIT 20`,
            [id]
        );
        const [cache] = await pool.query(
            `SELECT current_stock, main_inventory, coming_po, total_branch_replenishment, suggested_qty
             FROM \`${pur}\`.replenishment_cache
             WHERE company_id = 'main' AND UPPER(TRIM(branch_id)) = 'MAIN'
               AND UPPER(REPLACE(TRIM(inventory_id), ' ', '')) = ?`,
            [id]
        );

        console.log(`\n=== ${id} ===`);
        console.log("forecast MAIN/MAIN WH11:", fis);
        console.log("forecast any warehouse with stock:", fisAny);
        console.log("inventory_items MAIN:", ii);
        console.log("open PO lines (any dest):", pos);
        console.log("MAIN replenishment_cache:", cache);
    }
} finally {
    await pool.end();
}
