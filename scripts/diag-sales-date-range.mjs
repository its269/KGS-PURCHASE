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

const [[range]] = await pool.query(
    `SELECT MIN(document_date) min_d, MAX(document_date) max_d, COUNT(*) total
     FROM \`${pur}\`.product_periodic_sales`
);
console.log("MySQL sales date range:", range);

const [byYear] = await pool.query(
    `SELECT YEAR(document_date) y, order_type, COUNT(*) c
     FROM \`${pur}\`.product_periodic_sales
     WHERE order_type = 'Invoice'
     GROUP BY YEAR(document_date), order_type
     ORDER BY y DESC`
);
console.log("\nInvoice rows by year:");
console.table(byYear);

const [iloiilo] = await pool.query(
    `SELECT YEAR(document_date) y, order_type, COUNT(*) c, SUM(ABS(qty)) qty
     FROM \`${pur}\`.product_periodic_sales
     WHERE UPPER(branch_name) = 'ILOILO'
     GROUP BY YEAR(document_date), order_type
     ORDER BY y DESC`
);
console.log("\nILOILO by year:");
console.table(iloiilo);

await pool.end();
