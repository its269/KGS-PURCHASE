import dotenv from "dotenv";
import mysql from "mysql2/promise";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const purchasePool = mysql.createPool({
    host: process.env.MYSQL_HOST,
    port: parseInt(process.env.MYSQL_PORT || "3306", 10),
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_PURCHASE_DATABASE || "db_purchase",
});

const itemId = process.argv[2] || "130701101101292";
const branch = process.argv[3] || "MAIN";

try {
    const [branches] = await purchasePool.query(
        `SELECT branch_name, COUNT(*) AS row_count, SUM(qty) AS qty
         FROM product_periodic_sales
         WHERE UPPER(TRIM(inventory_id)) = UPPER(TRIM(?))
         GROUP BY branch_name`,
        [itemId]
    );
    console.log("By branch_name for", itemId, ":", branches);

    const [dateRange] = await purchasePool.query(
        `SELECT MIN(document_date) AS minDate, MAX(document_date) AS maxDate, COUNT(*) AS row_count, SUM(qty) AS totalQty
         FROM product_periodic_sales
         WHERE UPPER(TRIM(inventory_id)) = UPPER(TRIM(?))
           AND UPPER(branch_name) = UPPER(?)`,
        [itemId, branch]
    );
    console.log("Date range MAIN:", dateRange[0]);

    const [detail] = await purchasePool.query(
        `SELECT id, document_date, qty, total_amount, order_type, financial_period
         FROM product_periodic_sales
         WHERE UPPER(TRIM(inventory_id)) = UPPER(TRIM(?))
           AND UPPER(branch_name) = UPPER(?)
         ORDER BY document_date DESC`,
        [itemId, branch]
    );
    console.log("MAIN rows detail:", detail);

    const [last90] = await purchasePool.query(
        `SELECT SUM(qty) AS qty90, COUNT(*) AS row_count
         FROM product_periodic_sales
         WHERE UPPER(TRIM(inventory_id)) = UPPER(TRIM(?))
           AND UPPER(branch_name) = UPPER(?)
           AND document_date >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)`,
        [itemId, branch]
    );
    console.log("Last 90 days:", last90[0], "=> sells/day:", (Number(last90[0].qty90) || 0) / 90);

    const [allTime] = await purchasePool.query(
        `SELECT SUM(qty) AS qtyAll
         FROM product_periodic_sales
         WHERE UPPER(TRIM(inventory_id)) = UPPER(TRIM(?))
           AND UPPER(branch_name) = UPPER(?)`,
        [itemId, branch]
    );
    console.log("All time (current bug):", allTime[0], "=> sells/day:", (Number(allTime[0].qtyAll) || 0) / 90);

    const [byType] = await purchasePool.query(
        `SELECT order_type, COUNT(*) AS row_count, SUM(qty) AS qty
         FROM product_periodic_sales
         WHERE UPPER(TRIM(inventory_id)) = UPPER(TRIM(?))
           AND UPPER(branch_name) = UPPER(?)
           AND document_date >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)
         GROUP BY order_type`,
        [itemId, branch]
    );
    console.log("Last 90 days by order_type:", byType);

    const [net90] = await purchasePool.query(
        `SELECT SUM(
            CASE
                WHEN order_type = 'Credit Memo' THEN -ABS(qty)
                WHEN order_type IN ('Invoice', 'Debit Memo') THEN ABS(qty)
                ELSE 0
            END
         ) AS netQty
         FROM product_periodic_sales
         WHERE UPPER(TRIM(inventory_id)) = UPPER(TRIM(?))
           AND UPPER(branch_name) = UPPER(?)
           AND document_date >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)`,
        [itemId, branch]
    );
    console.log("Net 90-day qty (invoice - credit):", net90[0], "=> sells/day:", (Number(net90[0].netQty) || 0) / 90);

    const [fixed] = await purchasePool.query(
        `SELECT SUM(
            CASE
                WHEN order_type = 'Credit Memo' THEN -ABS(qty)
                WHEN order_type IN ('Invoice', 'Debit Memo') THEN ABS(qty)
                ELSE 0
            END
         ) AS netQty
         FROM product_periodic_sales
         WHERE UPPER(TRIM(inventory_id)) = UPPER(TRIM(?))
           AND UPPER(branch_name) = UPPER(?)
           AND document_date >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)`,
        [itemId, branch]
    );
    const net = Math.max(0, Number(fixed[0].netQty) || 0);
    console.log("FIXED getPeriodicSalesSummary logic:", net, "=> sells/day:", net / 90);
} finally {
    await purchasePool.end();
}
