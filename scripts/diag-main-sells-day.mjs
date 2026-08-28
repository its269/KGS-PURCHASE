/**
 * Diagnose MAIN warehouse Sells/Day inflation sources.
 * Usage: node scripts/diag-main-sells-day.mjs [inventoryId]
 */
import dotenv from "dotenv";
import mysql from "mysql2/promise";
import { SQL_NET_QTY, SQL_GROSS_QTY, SALES_LOOKBACK_DAYS } from "../lib/sales-velocity.js";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const itemId = process.argv[2] || "";
const purchasePool = mysql.createPool({
    host: process.env.MYSQL_HOST,
    port: parseInt(process.env.MYSQL_PORT || "3306", 10),
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_PURCHASE_DATABASE || "db_purchase",
});

const lookback = SALES_LOOKBACK_DAYS;

try {
    // Top network movers last 90d (current MAIN formula input)
    const [top] = await purchasePool.query(
        `SELECT UPPER(TRIM(inventory_id)) AS inventory_id,
                SUM(${SQL_NET_QTY}) AS net_qty,
                SUM(${SQL_GROSS_QTY}) AS gross_qty,
                COUNT(*) AS row_count
         FROM product_periodic_sales
         WHERE document_date >= DATE_SUB(CURDATE(), INTERVAL ${lookback} DAY)
           AND document_date <= CURDATE()
           AND UPPER(TRIM(COALESCE(branch_name,''))) NOT LIKE '%DAMAGE%'
           AND UPPER(TRIM(COALESCE(branch_name,''))) NOT LIKE '%DISCOUNTED%'
         GROUP BY UPPER(TRIM(inventory_id))
         HAVING SUM(${SQL_NET_QTY}) > 0
         ORDER BY net_qty DESC
         LIMIT 8`
    );
    console.log(`\n=== Top network net qty (last ${lookback}d) ===`);
    for (const r of top) {
        const net = Math.max(0, Number(r.net_qty) || 0);
        const gross = Math.max(0, Number(r.gross_qty) || 0);
        console.log({
            id: r.inventory_id,
            net,
            gross,
            ads_net: +(net / lookback).toFixed(1),
            ads_gross: +(gross / lookback).toFixed(1),
            rows: r.row_count,
        });
    }

    const focusId = itemId || top[0]?.inventory_id;
    if (!focusId) {
        console.log("No sales rows found");
        process.exit(0);
    }
    console.log(`\n=== Detail for ${focusId} ===`);

    const [byBranch] = await purchasePool.query(
        `SELECT TRIM(branch_name) AS branch_name,
                order_type,
                LEFT(id, 3) AS id_prefix,
                COUNT(*) AS row_count,
                SUM(ABS(qty)) AS abs_qty,
                SUM(${SQL_NET_QTY}) AS net_qty,
                SUM(${SQL_GROSS_QTY}) AS gross_qty
         FROM product_periodic_sales
         WHERE UPPER(TRIM(inventory_id)) = ?
           AND document_date >= DATE_SUB(CURDATE(), INTERVAL ${lookback} DAY)
           AND document_date <= CURDATE()
         GROUP BY TRIM(branch_name), order_type, LEFT(id, 3)
         ORDER BY abs_qty DESC`,
        [focusId]
    );
    console.table(byBranch);

    const [excludeMain] = await purchasePool.query(
        `SELECT
            SUM(${SQL_NET_QTY}) AS net_all,
            SUM(CASE WHEN UPPER(TRIM(branch_name)) = 'MAIN' THEN 0 ELSE (${SQL_NET_QTY}) END) AS net_ex_main,
            SUM(${SQL_GROSS_QTY}) AS gross_all,
            SUM(CASE WHEN UPPER(TRIM(branch_name)) = 'MAIN' THEN 0 ELSE (${SQL_GROSS_QTY}) END) AS gross_ex_main
         FROM product_periodic_sales
         WHERE UPPER(TRIM(inventory_id)) = ?
           AND document_date >= DATE_SUB(CURDATE(), INTERVAL ${lookback} DAY)
           AND document_date <= CURDATE()
           AND UPPER(TRIM(COALESCE(branch_name,''))) NOT LIKE '%DAMAGE%'
           AND UPPER(TRIM(COALESCE(branch_name,''))) NOT LIKE '%DISCOUNTED%'`,
        [focusId]
    );
    const x = excludeMain[0] || {};
    console.log("With vs without MAIN branch invoices:", {
        net_all: Number(x.net_all) || 0,
        net_ex_main: Number(x.net_ex_main) || 0,
        ads_all: +((Math.max(0, Number(x.net_all) || 0)) / lookback).toFixed(1),
        ads_ex_main: +((Math.max(0, Number(x.net_ex_main) || 0)) / lookback).toFixed(1),
    });

    // Duplicate risk: same ref under SI- and another prefix?
    const [dups] = await purchasePool.query(
        `SELECT SUBSTRING_INDEX(SUBSTRING_INDEX(id, '-', 2), '-', -1) AS refish,
                GROUP_CONCAT(DISTINCT LEFT(id, 2)) AS prefixes,
                COUNT(*) AS rows,
                SUM(ABS(qty)) AS abs_qty
         FROM product_periodic_sales
         WHERE UPPER(TRIM(inventory_id)) = ?
           AND document_date >= DATE_SUB(CURDATE(), INTERVAL ${lookback} DAY)
           AND document_date <= CURDATE()
           AND id LIKE '%-%'
         GROUP BY SUBSTRING_INDEX(SUBSTRING_INDEX(id, '-', 2), '-', -1)
         HAVING COUNT(DISTINCT LEFT(id, 2)) > 1
         ORDER BY abs_qty DESC
         LIMIT 10`,
        [focusId]
    );
    console.log("Possible duplicate prefixes for same ref:", dups);

    // Cache row if present
    const [cache] = await purchasePool.query(
        `SELECT inventory_id, qty_sold_90, sales_velocity, sales_scope, updated_at,
                JSON_UNQUOTE(JSON_EXTRACT(ai_insights_json, '$.salesLogicVersion')) AS logic_ver,
                JSON_UNQUOTE(JSON_EXTRACT(ai_insights_json, '$.lookbackDays')) AS lookback
         FROM replenishment_cache
         WHERE company_id = 'main' AND branch_id = 'MAIN'
           AND UPPER(TRIM(inventory_id)) = ?
         LIMIT 1`,
        [focusId]
    );
    console.log("MAIN cache row:", cache[0] || "(none)");
} finally {
    await purchasePool.end();
}
