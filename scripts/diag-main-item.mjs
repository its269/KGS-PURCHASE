import dotenv from "dotenv";
import mysql from "mysql2/promise";
import { SQL_NET_QTY, SQL_GROSS_QTY } from "../lib/sales-velocity.js";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const id = process.argv[2] || "130202101103800";
const pool = mysql.createPool({
    host: process.env.MYSQL_HOST,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_PURCHASE_DATABASE || "db_purchase",
});

const invDb = process.env.MYSQL_INVENTORY_DATABASE || "db_kelin_inventory";

try {
    const [meta] = await pool.query(
        `SELECT inventory_id, inventory_name, item_class
         FROM \`${invDb}\`.inventory_items
         WHERE UPPER(TRIM(inventory_id)) = ? AND default_warehouse = '__catalog__'
         LIMIT 1`,
        [id]
    );
    console.log("Catalog:", meta[0] || "(not found)");

    const [cache] = await pool.query(
        `SELECT inventory_id, description, sales_velocity, qty_sold_90, sales_scope,
                total_branch_replenishment, branch_order_qty, current_stock, coming_po,
                JSON_UNQUOTE(JSON_EXTRACT(ai_insights_json, '$.salesLogicVersion')) AS logic_ver,
                JSON_UNQUOTE(JSON_EXTRACT(ai_insights_json, '$.lookbackDays')) AS lookback,
                updated_at
         FROM replenishment_cache
         WHERE company_id='main' AND branch_id='MAIN' AND UPPER(TRIM(inventory_id))=?`,
        [id]
    );
    console.log("MAIN cache:", cache[0] || "(none)");

    const [byBranch] = await pool.query(
        `SELECT TRIM(branch_name) AS branch_name,
                order_type,
                LEFT(id, 3) AS id_prefix,
                COUNT(*) AS row_count,
                ROUND(SUM(ABS(qty)),1) AS abs_qty,
                ROUND(SUM(${SQL_NET_QTY}),1) AS net_qty,
                ROUND(SUM(${SQL_GROSS_QTY}),1) AS gross_qty
         FROM product_periodic_sales
         WHERE UPPER(TRIM(inventory_id)) = ?
           AND document_date >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)
           AND document_date <= CURDATE()
         GROUP BY TRIM(branch_name), order_type, LEFT(id, 3)
         ORDER BY abs_qty DESC`,
        [id]
    );
    console.log("\nBy branch/type/prefix (90d):");
    console.table(byBranch);

    const [tot] = await pool.query(
        `SELECT
            ROUND(SUM(${SQL_NET_QTY}),1) AS net_all,
            ROUND(SUM(CASE WHEN UPPER(TRIM(branch_name)) IN ('MAIN') THEN 0 ELSE (${SQL_NET_QTY}) END),1) AS net_retail,
            ROUND(SUM(CASE WHEN UPPER(TRIM(branch_name)) IN ('MAIN','MANILA') THEN 0 ELSE (${SQL_NET_QTY}) END),1) AS net_ex_main_manila,
            ROUND(SUM(${SQL_GROSS_QTY}),1) AS gross_all
         FROM product_periodic_sales
         WHERE UPPER(TRIM(inventory_id)) = ?
           AND document_date >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)
           AND document_date <= CURDATE()`,
        [id]
    );
    const t = tot[0];
    console.log("Totals:", t);
    console.log("ads all:", (Math.max(0, Number(t.net_all)) / 90).toFixed(1));
    console.log("ads retail (ex MAIN):", (Math.max(0, Number(t.net_retail)) / 90).toFixed(1));

    // Invoice types that SQL_NET ignores incorrectly?
    const [weird] = await pool.query(
        `SELECT order_type, LEFT(id,3) AS prefix, COUNT(*) AS n, ROUND(SUM(ABS(qty)),1) AS qty
         FROM product_periodic_sales
         WHERE UPPER(TRIM(inventory_id)) = ?
           AND document_date >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)
           AND document_date <= CURDATE()
         GROUP BY order_type, LEFT(id,3)`,
        [id]
    );
    console.log("Type/prefix mix:", weird);

    // Credit memos not CM-%
    const [badCm] = await pool.query(
        `SELECT id, branch_name, order_type, qty, document_date
         FROM product_periodic_sales
         WHERE UPPER(TRIM(inventory_id)) = ?
           AND document_date >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)
           AND order_type = 'Credit Memo'
           AND id NOT LIKE 'CM-%'
         LIMIT 15`,
        [id]
    );
    console.log("Credit memos NOT CM-% (ignored by net formula):", badCm);

    // SI rows typed as Credit Memo (skipped in sync but maybe old data)
    const [siCm] = await pool.query(
        `SELECT COUNT(*) AS n, ROUND(SUM(ABS(qty)),1) AS qty
         FROM product_periodic_sales
         WHERE UPPER(TRIM(inventory_id)) = ?
           AND document_date >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)
           AND order_type = 'Credit Memo' AND id LIKE 'SI-%'`,
        [id]
    );
    console.log("SI-% Credit Memo rows:", siCm[0]);
} finally {
    await pool.end();
}
