import dotenv from "dotenv";
import mysql from "mysql2/promise";
import fs from "fs";

dotenv.config({ path: fs.existsSync(".env.local") ? ".env.local" : ".env" });
const pur = process.env.MYSQL_PURCHASE_DATABASE || "db_purchase";
const pool = mysql.createPool({
    host: process.env.MYSQL_HOST,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
});

const [all] = await pool.query(
    `SELECT branch_name, COUNT(*) AS cnt, MIN(document_date) AS minD, MAX(document_date) AS maxD
     FROM \`${pur}\`.product_periodic_sales
     GROUP BY branch_name ORDER BY cnt DESC LIMIT 30`
);
console.log("All-time sales by branch_name (top 30):");
for (const r of all) console.log(`  ${r.branch_name}: ${r.cnt} rows (${r.minD} to ${r.maxD})`);

const [recent] = await pool.query(
    `SELECT branch_name, COUNT(*) AS cnt
     FROM \`${pur}\`.product_periodic_sales
     WHERE document_date >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)
     GROUP BY branch_name ORDER BY cnt DESC`
);
console.log("\nLast 90 days sales branches:", recent.length);
for (const r of recent) console.log(`  ${r.branch_name}: ${r.cnt}`);

await pool.end();
