/**
 * Dig into SKU 130101101000030 L3 ECOM vs Acumatica report 34725.
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
const [byType] = await pool.query(
    `SELECT order_type,
            COUNT(*) n,
            SUM(ABS(qty)) qtyAbs,
            SUM(ABS(total_amount)) amtAbs,
            MIN(CAST(document_date AS DATE)) dmin,
            MAX(CAST(document_date AS DATE)) dmax
     FROM product_periodic_sales
     WHERE UPPER(REPLACE(TRIM(inventory_id),' ','')) = ?
       AND CAST(document_date AS DATE) BETWEEN '2026-05-01' AND '2026-07-31'
       AND UPPER(TRIM(branch_name)) LIKE '%ECOM%'
     GROUP BY order_type`,
    [inv]
);
console.log("by order_type", byType);

const [[net]] = await pool.query(
    `SELECT
        SUM(CASE WHEN order_type IN ('Invoice','Debit Memo') THEN ABS(qty) ELSE 0 END) gross,
        SUM(CASE WHEN order_type='Credit Memo' THEN ABS(qty) ELSE 0 END) cmQty,
        SUM(CASE WHEN order_type='Credit Memo' THEN -ABS(qty) WHEN order_type IN ('Invoice','Debit Memo') THEN ABS(qty) ELSE 0 END) net,
        SUM(CASE WHEN order_type='Credit Memo' THEN -ABS(total_amount) WHEN order_type IN ('Invoice','Debit Memo') THEN ABS(total_amount) ELSE 0 END) netAmt
     FROM product_periodic_sales
     WHERE UPPER(REPLACE(TRIM(inventory_id),' ','')) = ?
       AND CAST(document_date AS DATE) BETWEEN '2026-05-01' AND '2026-07-31'
       AND UPPER(TRIM(branch_name)) LIKE '%ECOM%'`,
    [inv]
);
console.log("totals", net);
console.log("report", { qty: 34725, amt: 1213531.74 });
console.log("gaps", {
    qtyVsNet: 34725 - Number(net.net),
    qtyVsGross: 34725 - Number(net.gross),
    amtVsNet: 1213531.74 - Number(net.netAmt),
});

// unit price check
console.log("avg unit net", Number(net.netAmt) / Number(net.net));
console.log("report unit", 1213531.74 / 34725);

await pool.end();
