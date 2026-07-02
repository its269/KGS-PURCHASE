import dotenv from "dotenv";
import mysql from "mysql2/promise";
import fs from "fs";

dotenv.config({ path: fs.existsSync(".env.local") ? ".env.local" : ".env" });

const inv = process.env.MYSQL_INVENTORY_DATABASE || "db_kelin_inventory";
const pur = process.env.MYSQL_PURCHASE_DATABASE || "db_purchase";
const pool = mysql.createPool({
    host: process.env.MYSQL_HOST,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
});

const [invBranches] = await pool.query(
    `SELECT branch_id, COUNT(*) c FROM \`${inv}\`.inventory_items
     WHERE default_warehouse != '__catalog__' AND branch_id IS NOT NULL
     GROUP BY branch_id ORDER BY branch_id`
);
const [salesBranches] = await pool.query(
    `SELECT branch_name, COUNT(*) c,
            COUNT(DISTINCT inventory_id) items,
            SUM(CASE WHEN order_type='Credit Memo' THEN -ABS(qty) WHEN order_type IN ('Invoice','Debit Memo') THEN ABS(qty) ELSE 0 END) net_qty
     FROM \`${pur}\`.product_periodic_sales
     WHERE document_date >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)
     GROUP BY branch_name ORDER BY branch_name`
);

console.log("\nBranches WITH 90d sales:\n");
for (const s of salesBranches) {
    if (Number(s.net_qty) > 0) console.log(`  ${s.branch_name}: ${s.items} items, net ${s.net_qty}`);
}

const salesMap = new Map(salesBranches.map((r) => [(r.branch_name || "").toUpperCase(), r]));
console.log("Branch alignment (inventory stock vs 90d sales):\n");
for (const row of invBranches) {
    const id = row.branch_id;
    const sales = salesMap.get(id.toUpperCase());
    const stockItems = row.c;
    const salesRows = sales?.c ?? 0;
    const netQty = sales?.net_qty ?? 0;
    const flag = !sales ? "NO SALES MATCH" : salesRows === 0 ? "EMPTY" : "";
    if (!sales || Number(netQty) === 0) {
        console.log(`  ${id.padEnd(16)} stock_rows=${stockItems} sales_rows=${salesRows} net90=${netQty} ${flag}`);
    }
}
await pool.end();
