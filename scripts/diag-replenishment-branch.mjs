import dotenv from "dotenv";
import mysql from "mysql2/promise";
import fs from "fs";
import { SALES_LOOKBACK_DAYS, averageDailySales, SQL_NET_QTY } from "../lib/sales-velocity.js";

dotenv.config({ path: fs.existsSync(".env.local") ? ".env.local" : ".env" });

const branch = process.argv[2] || "ILOILO";
const inv = process.env.MYSQL_INVENTORY_DATABASE || "db_kelin_inventory";
const pur = process.env.MYSQL_PURCHASE_DATABASE || "db_purchase";
const TARGET = 60;
const pool = mysql.createPool({
    host: process.env.MYSQL_HOST,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
});

const [stock] = await pool.query(
    `SELECT COUNT(DISTINCT TRIM(inventory_id)) c, SUM(on_hand) stock
     FROM \`${inv}\`.inventory_items
     WHERE default_warehouse != '__catalog__' AND UPPER(TRIM(branch_id)) = UPPER(?)
       AND company_id = 'main' AND (item_status IS NULL OR UPPER(TRIM(item_status)) = 'ACTIVE')`,
    [branch]
);

const [sales] = await pool.query(
    `SELECT COUNT(DISTINCT UPPER(TRIM(inventory_id))) items,
            SUM(${SQL_NET_QTY}) net_qty
     FROM \`${pur}\`.product_periodic_sales
     WHERE document_date >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)
       AND TRIM(UPPER(branch_name)) = TRIM(UPPER(?))`,
    [branch]
);

console.log(`Branch: ${branch}`);
console.log(`Stock items (active): ${stock[0].c}, total on hand: ${stock[0].stock}`);
console.log(`Sales items (90d): ${sales[0].items}, net qty: ${sales[0].net_qty}`);

const [joined] = await pool.query(
    `SELECT TRIM(i.inventory_id) id, SUM(i.on_hand) stock,
            COALESCE(s.net_qty, 0) sold90
     FROM \`${inv}\`.inventory_items i
     LEFT JOIN (
       SELECT UPPER(TRIM(inventory_id)) inv, SUM(${SQL_NET_QTY}) net_qty
       FROM \`${pur}\`.product_periodic_sales
       WHERE document_date >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)
         AND TRIM(UPPER(branch_name)) = TRIM(UPPER(?))
       GROUP BY UPPER(TRIM(inventory_id))
     ) s ON UPPER(TRIM(i.inventory_id)) = s.inv
     WHERE i.default_warehouse != '__catalog__'
       AND UPPER(TRIM(i.branch_id)) = UPPER(?)
       AND i.company_id = 'main'
       AND (i.item_status IS NULL OR UPPER(TRIM(i.item_status)) = 'ACTIVE')
     GROUP BY TRIM(i.inventory_id), s.net_qty
     HAVING sold90 > 0`,
    [branch, branch]
);

let wouldShow = 0;
let filteredOut = 0;
for (const row of joined) {
    const ads = averageDailySales(row.sold90, SALES_LOOKBACK_DAYS);
    const target = Math.ceil(ads * TARGET);
    const suggested = Math.max(0, target - Number(row.stock));
    const days = Math.floor(Number(row.stock) / ads);
    const isCritical = days <= 7; // no lead time in diag
    if (suggested > 0 || isCritical) wouldShow++;
    else filteredOut++;
}
console.log(`Items with sales+stock: ${joined.length}`);
console.log(`Would show (suggested>0 or critical): ${wouldShow}`);
console.log(`Filtered out (well stocked): ${filteredOut}`);

const [pos] = await pool.query(
    `SELECT UPPER(TRIM(inventory_id)) id, SUM(${SQL_NET_QTY}) net
     FROM \`${pur}\`.product_periodic_sales
     WHERE document_date >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)
       AND TRIM(UPPER(branch_name)) = TRIM(UPPER(?))
     GROUP BY UPPER(TRIM(inventory_id))
     HAVING net > 0
     ORDER BY net DESC LIMIT 15`,
    [branch]
);
console.log(`Items with positive net sales: ${pos.length}`);
if (pos.length) console.log(pos.slice(0, 5));

const [overlap] = await pool.query(
    `SELECT COUNT(*) c FROM (
       SELECT UPPER(TRIM(inventory_id)) id FROM \`${pur}\`.product_periodic_sales
       WHERE document_date >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)
         AND TRIM(UPPER(branch_name)) = TRIM(UPPER(?))
       GROUP BY UPPER(TRIM(inventory_id)) HAVING SUM(${SQL_NET_QTY}) > 0
     ) s INNER JOIN (
       SELECT DISTINCT UPPER(TRIM(inventory_id)) id FROM \`${inv}\`.inventory_items
       WHERE UPPER(TRIM(branch_id)) = UPPER(?) AND default_warehouse != '__catalog__' AND company_id = 'main'
     ) i ON s.id = i.id`,
    [branch, branch]
);
console.log(`Positive-net sales items with stock at branch: ${overlap[0].c}`);

const [salesOnly] = await pool.query(
    `SELECT COUNT(*) c FROM (
       SELECT UPPER(TRIM(inventory_id)) id FROM \`${pur}\`.product_periodic_sales
       WHERE document_date >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)
         AND TRIM(UPPER(branch_name)) = TRIM(UPPER(?))
       GROUP BY UPPER(TRIM(inventory_id)) HAVING SUM(${SQL_NET_QTY}) > 0
     ) s LEFT JOIN (
       SELECT DISTINCT UPPER(TRIM(inventory_id)) id FROM \`${inv}\`.inventory_items
       WHERE UPPER(TRIM(branch_id)) = UPPER(?) AND default_warehouse != '__catalog__'
     ) i ON s.id = i.id WHERE i.id IS NULL`,
    [branch, branch]
);
console.log(`Positive-net sales items WITHOUT stock row at branch: ${salesOnly[0].c}`);

await pool.end();
