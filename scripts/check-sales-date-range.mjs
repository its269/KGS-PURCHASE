import dotenv from "dotenv";
import mysql from "mysql2/promise";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const pool = mysql.createPool({
    host: process.env.MYSQL_HOST,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_PURCHASE_DATABASE || "db_purchase",
});

const [[range]] = await pool.query(
    `SELECT MIN(document_date) AS minDate, MAX(document_date) AS maxDate, COUNT(*) AS row_count
     FROM product_periodic_sales`
);
console.log("Sales date range:", range);

const [recent] = await pool.query(
    `SELECT branch_name, COUNT(*) AS c,
        SUM(CASE WHEN order_type = 'Credit Memo' THEN -ABS(qty) WHEN order_type IN ('Invoice','Debit Memo') THEN ABS(qty) ELSE 0 END) AS netQty
     FROM product_periodic_sales
     WHERE document_date >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)
     GROUP BY branch_name
     ORDER BY netQty DESC
     LIMIT 5`
);
console.log("Top branches with net sales in last 90 days:", recent);

const [mainRecent] = await pool.query(
    `SELECT inventory_id,
        SUM(CASE WHEN order_type = 'Credit Memo' THEN -ABS(qty) WHEN order_type IN ('Invoice','Debit Memo') THEN ABS(qty) ELSE 0 END) AS netQty
     FROM product_periodic_sales
     WHERE document_date >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)
       AND UPPER(branch_name) = 'MAIN'
     GROUP BY inventory_id
     HAVING netQty > 0
     ORDER BY netQty DESC
     LIMIT 5`
);
console.log("MAIN top items last 90 days:", mainRecent);

const [mainLatest] = await pool.query(
    `SELECT document_date, order_type, qty, inventory_id
     FROM product_periodic_sales
     WHERE UPPER(branch_name) = 'MAIN'
     ORDER BY document_date DESC
     LIMIT 5`
);
console.log("MAIN latest sales rows:", mainLatest);

const [[mainCounts]] = await pool.query(
    `SELECT
        SUM(CASE WHEN document_date >= DATE_SUB(CURDATE(), INTERVAL 90 DAY) AND document_date <= CURDATE() THEN 1 ELSE 0 END) AS in90,
        SUM(CASE WHEN document_date > CURDATE() THEN 1 ELSE 0 END) AS future,
        SUM(CASE WHEN document_date IS NULL THEN 1 ELSE 0 END) AS nullDate
     FROM product_periodic_sales
     WHERE UPPER(branch_name) = 'MAIN'`
);
console.log("MAIN date stats:", mainCounts);

const [bacoTop] = await pool.query(
    `SELECT inventory_id,
        SUM(CASE WHEN order_type = 'Credit Memo' THEN -ABS(qty) WHEN order_type IN ('Invoice','Debit Memo') THEN ABS(qty) ELSE 0 END) AS netQty
     FROM product_periodic_sales
     WHERE document_date >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)
       AND UPPER(branch_name) = 'BACOLOD'
     GROUP BY inventory_id
     HAVING netQty > 0
     ORDER BY netQty DESC
     LIMIT 3`
);
console.log("BACOLOD top items:", bacoTop);

const [main90ByType] = await pool.query(
    `SELECT order_type, COUNT(*) AS c, SUM(qty) AS qty
     FROM product_periodic_sales
     WHERE UPPER(branch_name) = 'MAIN'
       AND document_date >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)
       AND document_date <= CURDATE()
     GROUP BY order_type`
);
console.log("MAIN last 90 days by order_type:", main90ByType);

const [[mainInv2025]] = await pool.query(
    `SELECT COUNT(*) AS invoiceRows
     FROM product_periodic_sales
     WHERE UPPER(branch_name) = 'MAIN'
       AND order_type = 'Invoice'
       AND document_date >= '2025-01-01'`
);
console.log("MAIN invoices since 2025:", mainInv2025);

const [[lastSync]] = await pool.query(`SELECT MAX(last_sync) AS lastSync FROM product_periodic_sales`);
console.log("Last sales sync:", lastSync);

const [mainAllTime] = await pool.query(
    `SELECT order_type, COUNT(*) AS c, MIN(document_date) AS minD, MAX(document_date) AS maxD
     FROM product_periodic_sales WHERE UPPER(branch_name) = 'MAIN' GROUP BY order_type`
);
console.log("MAIN all-time by order_type:", mainAllTime);

const [recentInvBranches] = await pool.query(
    `SELECT branch_name, COUNT(*) AS c
     FROM product_periodic_sales
     WHERE order_type = 'Invoice' AND document_date >= '2025-01-01'
     GROUP BY branch_name ORDER BY c DESC LIMIT 8`
);
console.log("Invoice rows by branch since 2025:", recentInvBranches);

await pool.end();
