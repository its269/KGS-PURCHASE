import dotenv from "dotenv";
import mysql from "mysql2/promise";
import fs from "fs";

dotenv.config({ path: ".env" });
if (fs.existsSync(".env.local")) dotenv.config({ path: ".env.local", override: true });

const unwrap = (v) => {
    let s = String(v ?? "").trim();
    if ((s.startsWith("'") && s.endsWith("'")) || (s.startsWith('"') && s.endsWith('"'))) s = s.slice(1, -1);
    return s;
};

const pool = mysql.createPool({
    host: process.env.MYSQL_HOST,
    port: parseInt(process.env.MYSQL_PORT || "3306", 10),
    user: process.env.MYSQL_USER,
    password: unwrap(process.env.MYSQL_PASSWORD),
    database: process.env.MYSQL_PURCHASE_DATABASE || "db_purchase",
});

const [[col]] = await pool.query(
    `SELECT DATA_TYPE, COLUMN_TYPE FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'product_periodic_sales' AND COLUMN_NAME = 'document_date'`,
    [process.env.MYSQL_PURCHASE_DATABASE || "db_purchase"]
);
console.log("document_date column", col);

const [months] = await pool.query(
    `SELECT DATE_FORMAT(document_date, '%Y-%m') ym,
            SUM(order_type IN ('Invoice','Debit Memo')) inv,
            SUM(order_type = 'Credit Memo') cm,
            SUM(CASE WHEN order_type IN ('Invoice','Debit Memo') THEN ABS(qty) ELSE 0 END) inv_qty,
            SUM(CASE WHEN order_type = 'Credit Memo' THEN ABS(qty) ELSE 0 END) cm_qty
     FROM product_periodic_sales
     WHERE document_date >= '2025-10-01' AND document_date <= '2026-08-31'
     GROUP BY ym
     ORDER BY ym`
);
console.log("months Oct 2025–Aug 2026:");
console.table(months);

const [ecom] = await pool.query(
    `SELECT DATE_FORMAT(document_date, '%Y-%m') ym,
            SUM(order_type IN ('Invoice','Debit Memo')) inv,
            SUM(order_type = 'Credit Memo') cm,
            SUM(CASE WHEN order_type IN ('Invoice','Debit Memo') THEN ABS(qty) ELSE 0 END) inv_qty,
            SUM(CASE WHEN order_type = 'Credit Memo' THEN ABS(qty) ELSE 0 END) cm_qty
     FROM product_periodic_sales
     WHERE document_date >= '2025-10-01' AND document_date <= '2026-08-31'
       AND UPPER(TRIM(branch_name)) = 'ECOMMERCE'
     GROUP BY ym
     ORDER BY ym`
);
console.log("ECOMMERCE months:");
console.table(ecom);

await pool.end();
