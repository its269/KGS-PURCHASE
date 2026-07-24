import dotenv from "dotenv";
import mysql from "mysql2/promise";
import fs from "fs";

dotenv.config({ path: fs.existsSync(".env.local") ? ".env.local" : ".env" });

const branch = process.argv[2] || "ILOILO";
const pur = process.env.MYSQL_PURCHASE_DATABASE || "db_purchase";
const pool = mysql.createPool({
    host: process.env.MYSQL_HOST,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
});

const [types] = await pool.query(
    `SELECT order_type, COUNT(*) c, SUM(ABS(qty)) qty
     FROM \`${pur}\`.product_periodic_sales
     WHERE TRIM(UPPER(branch_name)) = TRIM(UPPER(?))
       AND document_date >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)
     GROUP BY order_type`,
    [branch]
);
console.log(`${branch} order types (90d):`, types);

const [gross] = await pool.query(
    `SELECT COUNT(DISTINCT UPPER(TRIM(inventory_id))) items,
            SUM(CASE WHEN order_type IN ('Invoice','Debit Memo') THEN ABS(qty) ELSE 0 END) gross_qty
     FROM \`${pur}\`.product_periodic_sales
     WHERE TRIM(UPPER(branch_name)) = TRIM(UPPER(?))
       AND document_date >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)`,
    [branch]
);
console.log(`${branch} gross:`, gross[0]);

await pool.end();
