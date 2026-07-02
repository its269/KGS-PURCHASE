import dotenv from "dotenv";
import mysql from "mysql2/promise";
import fs from "fs";
import { SQL_NET_QTY } from "../lib/sales-velocity.js";

dotenv.config({ path: fs.existsSync(".env.local") ? ".env.local" : ".env" });
const pur = process.env.MYSQL_PURCHASE_DATABASE || "db_purchase";
const pool = mysql.createPool({
    host: process.env.MYSQL_HOST,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
});

for (const branch of ["ILOILO", "CEBU", "BACOLOD"]) {
    console.log(`\n=== ${branch} ===`);
    const [r] = await pool.query(
        `SELECT order_type, MIN(document_date) minD, MAX(document_date) maxD, COUNT(*) c
         FROM \`${pur}\`.product_periodic_sales
         WHERE TRIM(UPPER(branch_name)) = TRIM(UPPER(?))
         GROUP BY order_type`,
        [branch]
    );
    for (const x of r) {
        console.log(`  ${x.order_type}: ${x.c} rows (${String(x.minD).slice(0, 10)} to ${String(x.maxD).slice(0, 10)})`);
    }
    const [inv90] = await pool.query(
        `SELECT COUNT(*) c FROM \`${pur}\`.product_periodic_sales
         WHERE TRIM(UPPER(branch_name)) = TRIM(UPPER(?))
           AND order_type IN ('Invoice','Debit Memo')
           AND document_date >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)`,
        [branch]
    );
    console.log(`  Invoices in last 90d: ${inv90[0].c}`);
}

await pool.end();
