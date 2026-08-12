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
    `SELECT
        CASE
          WHEN id LIKE 'CM-%' THEN 'CM-prefix'
          WHEN id LIKE 'SI-%' THEN 'SI-prefix'
          ELSE 'other'
        END AS kind,
        order_type,
        COUNT(*) n,
        SUM(ABS(qty)) qty,
        SUM(ABS(total_amount)) amt
     FROM product_periodic_sales
     WHERE UPPER(REPLACE(TRIM(inventory_id),' ','')) = ?
       AND CAST(document_date AS DATE) BETWEEN '2026-05-01' AND '2026-07-31'
       AND UPPER(TRIM(branch_name)) LIKE '%ECOM%'
     GROUP BY kind, order_type
     ORDER BY kind, order_type`,
    [inv]
);
console.log(rows);

const [[net]] = await pool.query(
    `SELECT
        SUM(CASE WHEN order_type IN ('Invoice','Debit Memo') AND id LIKE 'SI-%' THEN ABS(qty) ELSE 0 END) invQty,
        SUM(CASE WHEN order_type = 'Credit Memo' AND id LIKE 'CM-%' THEN ABS(qty) ELSE 0 END) cmOnlyQty,
        SUM(CASE WHEN order_type = 'Credit Memo' AND id LIKE 'SI-%' THEN ABS(qty) ELSE 0 END) siAsCmQty,
        SUM(CASE WHEN order_type IN ('Invoice','Debit Memo') AND id LIKE 'SI-%' THEN ABS(qty)
                 WHEN order_type = 'Credit Memo' AND id LIKE 'CM-%' THEN -ABS(qty)
                 ELSE 0 END) fixedNet,
        SUM(CASE WHEN order_type IN ('Invoice','Debit Memo') AND id LIKE 'SI-%' THEN ABS(total_amount)
                 WHEN order_type = 'Credit Memo' AND id LIKE 'CM-%' THEN -ABS(total_amount)
                 ELSE 0 END) fixedAmt
     FROM product_periodic_sales
     WHERE UPPER(REPLACE(TRIM(inventory_id),' ','')) = ?
       AND CAST(document_date AS DATE) BETWEEN '2026-05-01' AND '2026-07-31'
       AND UPPER(TRIM(branch_name)) LIKE '%ECOM%'`,
    [inv]
);
console.log(net);
console.log("report", { qty: 34725, amt: 1213531.74 });

await pool.end();
