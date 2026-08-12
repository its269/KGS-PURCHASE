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
    `SELECT COALESCE(NULLIF(TRIM(branch_name),''),'(blank)') branch,
            COUNT(*) n, SUM(ABS(qty)) qty, SUM(ABS(total_amount)) amt
     FROM product_periodic_sales
     WHERE UPPER(REPLACE(TRIM(inventory_id),' ','')) = ?
       AND CAST(document_date AS DATE) BETWEEN '2026-05-01' AND '2026-07-31'
       AND order_type = 'Invoice'
       AND (id LIKE 'SI-ECM%' OR id LIKE 'SI-ECOM%')
     GROUP BY 1
     ORDER BY qty DESC`,
    [inv]
);
console.log("ECM-prefixed invoices by stored branch", rows);

const [[tot]] = await pool.query(
    `SELECT SUM(ABS(qty)) qty, SUM(ABS(total_amount)) amt, COUNT(*) n
     FROM product_periodic_sales
     WHERE UPPER(REPLACE(TRIM(inventory_id),' ','')) = ?
       AND CAST(document_date AS DATE) BETWEEN '2026-05-01' AND '2026-07-31'
       AND order_type = 'Invoice'
       AND (id LIKE 'SI-ECM%' OR id LIKE 'SI-ECOM%')`,
    [inv]
);
console.log("all ECM-prefixed invoices", tot);

// Net if we treat all ECM-prefixed as ECOM (inv - cm)
const [[cm]] = await pool.query(
    `SELECT SUM(ABS(qty)) qty, SUM(ABS(total_amount)) amt
     FROM product_periodic_sales
     WHERE UPPER(REPLACE(TRIM(inventory_id),' ','')) = ?
       AND CAST(document_date AS DATE) BETWEEN '2026-05-01' AND '2026-07-31'
       AND order_type = 'Credit Memo'
       AND (id LIKE 'CM-%')
       AND (id LIKE '%ECM%' OR UPPER(TRIM(branch_name)) LIKE '%ECOM%')`,
    [inv]
);
console.log("related CM", cm);
console.log("ECM inv qty vs report", { ecmInv: tot?.qty, report: 34725, ecomStored: 35184 });

await pool.end();
