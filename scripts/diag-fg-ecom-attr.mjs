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

const INV = "130601103100091";

const [may] = await pool.query(
    `SELECT branch_name, order_type, COUNT(*) c, SUM(ABS(qty)) qty
     FROM product_periodic_sales
     WHERE UPPER(REPLACE(TRIM(inventory_id),' ','')) = ?
       AND document_date >= '2026-05-01' AND document_date <= '2026-05-31'
     GROUP BY branch_name, order_type
     ORDER BY qty DESC`,
    [INV]
);
console.log("Subli-Mate May 2026 by branch:");
console.table(may);

const [blank] = await pool.query(
    `SELECT DATE_FORMAT(document_date,'%Y-%m') ym, COUNT(*) c, SUM(ABS(qty)) qty
     FROM product_periodic_sales
     WHERE order_type IN ('Invoice','Debit Memo')
       AND (branch_name IS NULL OR TRIM(branch_name) = '')
       AND document_date >= '2025-10-01' AND document_date <= '2026-08-31'
     GROUP BY ym ORDER BY ym`
);
console.log("blank-branch invoices:");
console.table(blank);

const [mainMay] = await pool.query(
    `SELECT COUNT(*) c, SUM(ABS(qty)) qty
     FROM product_periodic_sales
     WHERE order_type IN ('Invoice','Debit Memo')
       AND UPPER(TRIM(branch_name)) = 'MAIN'
       AND document_date >= '2026-05-01' AND document_date <= '2026-05-31'`
);
console.log("MAIN invoices May 2026:", mainMay[0]);

await pool.end();
