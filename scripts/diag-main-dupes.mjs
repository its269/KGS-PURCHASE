import dotenv from "dotenv";
import mysql from "mysql2/promise";
import { SQL_NET_QTY } from "../lib/sales-velocity.js";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const id = "130202101103800";
const pool = mysql.createPool({
    host: process.env.MYSQL_HOST,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_PURCHASE_DATABASE || "db_purchase",
});

try {
    // Duplicate inventory lines same id?
    const [dupIds] = await pool.query(
        `SELECT id, COUNT(*) AS n, SUM(ABS(qty)) AS qty
         FROM product_periodic_sales
         WHERE UPPER(TRIM(inventory_id)) = ?
           AND document_date >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)
         GROUP BY id
         HAVING COUNT(*) > 1
         LIMIT 10`,
        [id]
    );
    console.log("Duplicate primary ids:", dupIds);

    // Same ref under SI twice with different line suffixes counted ok; check same ref+line
    const [dupRef] = await pool.query(
        `SELECT
            SUBSTRING_INDEX(id, '-', 2) AS doc_key,
            COUNT(*) AS n,
            SUM(ABS(qty)) AS qty,
            GROUP_CONCAT(DISTINCT order_type) AS types,
            GROUP_CONCAT(DISTINCT LEFT(id,3)) AS prefixes
         FROM product_periodic_sales
         WHERE UPPER(TRIM(inventory_id)) = ?
           AND document_date >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)
           AND order_type = 'Invoice'
         GROUP BY SUBSTRING_INDEX(id, '-', 2)
         HAVING COUNT(*) > 1
         ORDER BY qty DESC
         LIMIT 10`,
        [id]
    );
    console.log("Invoice docs with multiple lines (normal if multi-line):", dupRef.slice(0, 5));

    // Compare released-style: only positive invoice qty with amount > 0
    const [clean] = await pool.query(
        `SELECT
            ROUND(SUM(CASE WHEN order_type='Invoice' AND total_amount > 0 THEN ABS(qty) ELSE 0 END),1) AS inv_pos_amt,
            ROUND(SUM(CASE WHEN order_type='Invoice' THEN ABS(qty) ELSE 0 END),1) AS inv_all,
            ROUND(SUM(${SQL_NET_QTY}),1) AS net,
            ROUND(SUM(CASE WHEN order_type='Credit Memo' AND id LIKE 'CM-%' THEN ABS(qty) ELSE 0 END),1) AS cm_only,
            COUNT(DISTINCT DATE(document_date)) AS sale_days
         FROM product_periodic_sales
         WHERE UPPER(TRIM(inventory_id)) = ?
           AND document_date >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)`,
        [id]
    );
    console.log("Clean checks:", clean[0]);
    const saleDays = Number(clean[0].sale_days) || 90;
    const net = Math.max(0, Number(clean[0].net) || 0);
    console.log({
        ads_div_90: +(net / 90).toFixed(1),
        ads_div_active_sale_days: +(net / saleDays).toFixed(1),
        note: "If manager expects active-day average, ads would be higher not lower",
    });

    // How many retail branches actually have this in cache with sales?
    const [br] = await pool.query(
        `SELECT COUNT(DISTINCT branch_id) AS branches_with_sales
         FROM replenishment_cache
         WHERE company_id='main' AND UPPER(TRIM(inventory_id))=?
           AND UPPER(TRIM(branch_id))!='MAIN' AND COALESCE(qty_sold_90,0)>0`,
        [id]
    );
    console.log(br[0]);
} finally {
    await pool.end();
}
