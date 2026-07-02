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
const branch = process.argv[2] || "ILOILO";

const [byType] = await pool.query(
    `SELECT order_type, COUNT(*) AS cnt, SUM(ABS(qty)) AS gross, SUM(qty) AS signed
     FROM \`${pur}\`.product_periodic_sales
     WHERE document_date >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)
       AND TRIM(UPPER(branch_name)) = TRIM(UPPER(?))
     GROUP BY order_type`,
    [branch]
);
console.log(`ILOILO sales by order_type (90d):`);
for (const r of byType) console.log(`  ${r.order_type}: ${r.cnt} rows, gross=${r.gross}, signed=${r.signed}`);

const [invoiceItems] = await pool.query(
    `SELECT COUNT(DISTINCT inventory_id) items, SUM(ABS(qty)) gross
     FROM \`${pur}\`.product_periodic_sales
     WHERE document_date >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)
       AND TRIM(UPPER(branch_name)) = TRIM(UPPER(?))
       AND order_type IN ('Invoice', 'Debit Memo')`,
    [branch]
);
console.log(`Invoice+Debit items: ${invoiceItems[0].items}, gross qty: ${invoiceItems[0].gross}`);

await pool.end();
