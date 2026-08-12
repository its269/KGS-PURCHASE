import dotenv from "dotenv";
import fs from "fs";
import mysql from "mysql2/promise";

dotenv.config({ path: ".env" });
if (fs.existsSync(".env.local")) dotenv.config({ path: ".env.local", override: true });

const unwrap = (v) => {
    let s = String(v ?? "").trim();
    if ((s.startsWith("'") && s.endsWith("'")) || (s.startsWith('"') && s.endsWith('"'))) s = s.slice(1, -1);
    return s;
};

const pool = mysql.createPool({
    host: process.env.MYSQL_HOST,
    user: process.env.MYSQL_USER,
    password: unwrap(process.env.MYSQL_PASSWORD),
    database: process.env.MYSQL_PURCHASE_DATABASE || "db_purchase",
    timezone: "+08:00",
});

const inv = "130101101000030";
const [rows] = await pool.query(
    `SELECT id, branch_name, qty, total_amount, document_date
     FROM product_periodic_sales
     WHERE UPPER(REPLACE(TRIM(inventory_id),' ','')) = ?
       AND CAST(document_date AS DATE) BETWEEN '2026-05-01' AND '2026-07-31'
       AND order_type = 'Credit Memo'
       AND UPPER(TRIM(branch_name)) LIKE '%ECOM%'
     ORDER BY ABS(qty) DESC
     LIMIT 30`,
    [inv]
);
console.log(rows);

const [[split]] = await pool.query(
    `SELECT
        SUM(CASE WHEN id LIKE '%ECM%' THEN ABS(qty) ELSE 0 END) ecmCmQty,
        SUM(CASE WHEN id NOT LIKE '%ECM%' THEN ABS(qty) ELSE 0 END) otherCmQty,
        SUM(ABS(qty)) allCmQty
     FROM product_periodic_sales
     WHERE UPPER(REPLACE(TRIM(inventory_id),' ','')) = ?
       AND CAST(document_date AS DATE) BETWEEN '2026-05-01' AND '2026-07-31'
       AND order_type = 'Credit Memo'
       AND UPPER(TRIM(branch_name)) LIKE '%ECOM%'`,
    [inv]
);
console.log("CM split", split);
console.log("Invoice - ECM CMs", 35184 - Number(split.ecmCmQty));
console.log("Invoice - all ECOM CMs", 35184 - Number(split.allCmQty));
console.log("report", 34725);

await pool.end();
