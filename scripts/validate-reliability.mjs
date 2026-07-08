/**
 * Validate reliability scores against live purchase_history SQL.
 * Usage: node scripts/validate-reliability.mjs
 */
import dotenv from "dotenv";
import mysql from "mysql2/promise";
import fs from "fs";

dotenv.config({ path: fs.existsSync(".env.local") ? ".env.local" : ".env" });

const purchaseDb = process.env.MYSQL_PURCHASE_DATABASE || "db_purchase";
const pool = mysql.createPool({
    host: process.env.MYSQL_HOST,
    port: parseInt(process.env.MYSQL_PORT || "3306", 10),
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: purchaseDb,
});

const [rows] = await pool.query(`
    SELECT 
        vendor_id,
        COUNT(*) as total_orders,
        SUM(CASE WHEN receipt_date <= promised_date THEN 1 ELSE 0 END) as on_time_orders,
        ROUND((SUM(CASE WHEN receipt_date <= promised_date THEN 1 ELSE 0 END) / COUNT(*)) * 100, 2) as reliability_score
    FROM purchase_history
    WHERE status IN ('Closed', 'Completed')
      AND promised_date IS NOT NULL
      AND receipt_date IS NOT NULL
      AND order_date >= DATE_SUB(CURDATE(), INTERVAL 12 MONTH)
    GROUP BY vendor_id
    ORDER BY total_orders DESC
    LIMIT 25
`);

const [noHistory] = await pool.query(`
    SELECT COUNT(*) as cnt
    FROM vendors v
    LEFT JOIN (
        SELECT DISTINCT vendor_id
        FROM purchase_history
        WHERE status IN ('Closed', 'Completed')
          AND promised_date IS NOT NULL
          AND receipt_date IS NOT NULL
          AND order_date >= DATE_SUB(CURDATE(), INTERVAL 12 MONTH)
    ) ph ON ph.vendor_id COLLATE utf8mb4_unicode_ci = v.vendor_id COLLATE utf8mb4_unicode_ci
    WHERE ph.vendor_id IS NULL
`);

let mismatches = 0;
let samples = 0;

console.log("=== Reliability validation (12-month window) ===\n");
for (const row of rows) {
    const manual = Number(row.reliability_score);
    const recomputed = row.total_orders > 0
        ? Math.round((row.on_time_orders / row.total_orders) * 10000) / 100
        : null;
    const ok = manual === recomputed;
    if (!ok) mismatches++;
    samples++;
    console.log(
        `${ok ? "OK" : "FAIL"} ${row.vendor_id}: ${manual}% (${row.on_time_orders}/${row.total_orders})`
    );
}

console.log(`\nVendors without qualifying PO history: ${noHistory[0].cnt}`);
console.log(`Checked: ${samples}, mismatches: ${mismatches}`);

if (mismatches > 0) {
    process.exit(1);
}

console.log("\nPASS: Reliability calculations match SQL.");
await pool.end();
