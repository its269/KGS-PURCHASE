/**
 * Find missing ~503 ECOM units: other branches at ~₱35 retail, blank branch, etc.
 */
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
    port: parseInt(process.env.MYSQL_PORT || "3306", 10),
    user: process.env.MYSQL_USER,
    password: unwrap(process.env.MYSQL_PASSWORD),
    database: process.env.MYSQL_PURCHASE_DATABASE || "db_purchase",
    timezone: "+08:00",
});

const inv = "130101101000030";

const [byBranch] = await pool.query(
    `SELECT COALESCE(NULLIF(TRIM(branch_name),''),'(blank)') branch,
            order_type,
            COUNT(*) n,
            SUM(ABS(qty)) qty,
            SUM(ABS(total_amount)) amt,
            ROUND(SUM(ABS(total_amount))/NULLIF(SUM(ABS(qty)),0), 2) unit
     FROM product_periodic_sales
     WHERE UPPER(REPLACE(TRIM(inventory_id),' ','')) = ?
       AND CAST(document_date AS DATE) BETWEEN '2026-05-01' AND '2026-07-31'
     GROUP BY COALESCE(NULLIF(TRIM(branch_name),''),'(blank)'), order_type
     ORDER BY qty DESC`,
    [inv]
);
console.log("by branch/type", byBranch);

// Retail-priced (~30-40) non-ECOM invoices — possible mis-tagged ECOM
const [[retailOther]] = await pool.query(
    `SELECT SUM(ABS(qty)) qty, SUM(ABS(total_amount)) amt, COUNT(*) n
     FROM product_periodic_sales
     WHERE UPPER(REPLACE(TRIM(inventory_id),' ','')) = ?
       AND CAST(document_date AS DATE) BETWEEN '2026-05-01' AND '2026-07-31'
       AND order_type IN ('Invoice','Debit Memo')
       AND UPPER(TRIM(COALESCE(branch_name,''))) NOT LIKE '%ECOM%'
       AND ABS(total_amount)/NULLIF(ABS(qty),0) BETWEEN 30 AND 40`,
    [inv]
);
console.log("retail-priced non-ECOM invoices", retailOther);

const [[blank]] = await pool.query(
    `SELECT SUM(ABS(qty)) qty, SUM(ABS(total_amount)) amt, COUNT(*) n
     FROM product_periodic_sales
     WHERE UPPER(REPLACE(TRIM(inventory_id),' ','')) = ?
       AND CAST(document_date AS DATE) BETWEEN '2026-05-01' AND '2026-07-31'
       AND order_type IN ('Invoice','Debit Memo')
       AND (branch_name IS NULL OR TRIM(branch_name)='')`,
    [inv]
);
console.log("blank branch invoices", blank);

// If we add retail non-ECOM to ECOM net
const ecomNet = 34222;
const report = 34725;
console.log("gap", report - ecomNet, "retailOther qty", retailOther?.qty);

await pool.end();
