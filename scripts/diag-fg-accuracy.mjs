/**
 * Diagnose Forecast Last 3 / Last Year accuracy for sample SKU + coverage.
 */
import dotenv from "dotenv";
import fs from "fs";
import mysql from "mysql2/promise";
import { getDefaultForecastPeriods } from "../lib/forecast-generator.js";
import { SQL_GROSS_QTY, SQL_NET_QTY } from "../lib/sales-velocity.js";

dotenv.config({ path: ".env" });
if (fs.existsSync(".env.local")) dotenv.config({ path: ".env.local", override: true });

const unwrap = (v) => {
    let s = String(v ?? "").trim();
    if ((s.startsWith("'") && s.endsWith("'")) || (s.startsWith('"') && s.endsWith('"'))) s = s.slice(1, -1);
    return s;
};

const periods = getDefaultForecastPeriods(new Date("2026-08-11"));
console.log("periods", periods);

const pool = mysql.createPool({
    host: process.env.MYSQL_HOST,
    port: parseInt(process.env.MYSQL_PORT || "3306", 10),
    user: process.env.MYSQL_USER,
    password: unwrap(process.env.MYSQL_PASSWORD),
    database: process.env.MYSQL_PURCHASE_DATABASE || "db_purchase",
    timezone: "+08:00",
});

const inv = "130101101000030";
const sqlNet = SQL_NET_QTY;
const sqlGross = SQL_GROSS_QTY;

async function sum(label, start, end, branchLike = null) {
    const where = [
        `UPPER(REPLACE(TRIM(inventory_id),' ','')) = ?`,
        `DATE(document_date) >= ?`,
        `DATE(document_date) <= ?`,
    ];
    const params = [inv, start, end];
    if (branchLike) {
        where.push(`UPPER(TRIM(branch_name)) LIKE ?`);
        params.push(branchLike);
    }
    const [[r]] = await pool.query(
        `SELECT COUNT(*) n,
                SUM(${sqlGross}) grossQty,
                SUM(${sqlNet}) netQty,
                MIN(DATE(document_date)) dmin,
                MAX(DATE(document_date)) dmax
         FROM product_periodic_sales
         WHERE ${where.join(" AND ")}`,
        params
    );
    console.log(label, r);
}

await sum("L3 ECOM", periods.last3Start, periods.last3End, "%ECOM%");
await sum("L3 ALL", periods.last3Start, periods.last3End, null);
await sum("LY ECOM", periods.lastYearStart, periods.lastYearEnd, "%ECOM%");
await sum("LY ALL", periods.lastYearStart, periods.lastYearEnd, null);

const [cov] = await pool.query(
    `SELECT DATE_FORMAT(document_date,'%Y-%m') ym,
            UPPER(TRIM(branch_name)) branch,
            COUNT(*) n,
            MIN(DATE(document_date)) dmin,
            MAX(DATE(document_date)) dmax,
            SUM(CASE WHEN order_type IN ('Invoice','Debit Memo') THEN 1 ELSE 0 END) invLines
     FROM product_periodic_sales
     WHERE DATE(document_date) BETWEEN ? AND ?
       AND UPPER(TRIM(branch_name)) LIKE '%ECOM%'
     GROUP BY DATE_FORMAT(document_date,'%Y-%m'), UPPER(TRIM(branch_name))
     ORDER BY ym, branch`,
    [periods.lastYearStart < periods.last3Start ? periods.lastYearStart : periods.last3Start, periods.last3End]
);
console.log("ECOM coverage months", cov);

const [julDays] = await pool.query(
    `SELECT DATE(document_date) d, COUNT(*) n
     FROM product_periodic_sales
     WHERE UPPER(REPLACE(TRIM(inventory_id),' ','')) = ?
       AND DATE(document_date) BETWEEN '2026-07-01' AND '2026-07-31'
       AND UPPER(TRIM(branch_name)) LIKE '%ECOM%'
     GROUP BY DATE(document_date)
     ORDER BY d`,
    [inv]
);
console.log("Jul 2026 ECOM SKU days", julDays);

console.log("Acumatica report target L3 ECOM SKU: qty=34725");
await pool.end();
