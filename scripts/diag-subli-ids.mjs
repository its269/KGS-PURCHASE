import dotenv from "dotenv";
import mysql from "mysql2/promise";
import fs from "fs";

dotenv.config({ path: ".env" });
if (fs.existsSync(".env.local")) dotenv.config({ path: ".env.local", override: true });

const unwrap = (v) => {
    let s = String(v ?? "").trim();
    if ((s.startsWith("'") && s.endsWith("'")) || (s.startsWith('"') && s.endsWith('"'))) s = s.slice(1, -1);
    return s;
};

const pur = process.env.MYSQL_PURCHASE_DATABASE || "db_purchase";
const inv = process.env.MYSQL_INVENTORY_DATABASE || "db_kelin_inventory";
const pool = mysql.createPool({
    host: process.env.MYSQL_HOST,
    user: process.env.MYSQL_USER,
    password: unwrap(process.env.MYSQL_PASSWORD),
});

const ids = ["150602100100051", "130601103100091"];

const [stock] = await pool.query(
    `SELECT inventory_id, item_name, warehouse_id, company_id, on_hand, available, item_class, default_price
     FROM \`${pur}\`.forecast_item_stock
     WHERE UPPER(REPLACE(TRIM(inventory_id),' ','')) IN (?,?)
     ORDER BY inventory_id, warehouse_id`,
    ids
);
console.log("forecast_item_stock:");
console.table(stock);

const [ii] = await pool.query(
    `SELECT inventory_id, inventory_name, item_class, default_warehouse, branch_id, company_id, available, on_hand
     FROM \`${inv}\`.inventory_items
     WHERE UPPER(REPLACE(TRIM(inventory_id),' ','')) IN (?,?)
     LIMIT 40`,
    ids
);
console.log("inventory_items:");
console.table(ii);

const [nameHits] = await pool.query(
    `SELECT DISTINCT inventory_id, item_name, company_id
     FROM \`${pur}\`.forecast_item_stock
     WHERE item_name LIKE '%Subli-Mate S100 Sublimation Paper 0.914%'
        OR item_name LIKE '%Subli-Mate S100 Sublimation Pap%'
     ORDER BY inventory_id`
);
console.log("stock name hits:");
console.table(nameHits);

const [pos] = await pool.query(
    `SELECT h.order_nbr, h.status, d.inventory_id, d.qty, d.received_qty, d.line_completed,
            d.warehouse_id, d.branch_id, h.order_date
     FROM \`${pur}\`.purchase_order_details d
     INNER JOIN \`${pur}\`.purchase_history h
       ON h.order_nbr COLLATE utf8mb4_unicode_ci = d.order_nbr
     WHERE UPPER(REPLACE(TRIM(d.inventory_id),' ','')) IN (?,?)
        OR h.order_nbr IN ('ECMP260179','ECMP260183')
     ORDER BY h.order_nbr, d.inventory_id`,
    ids
);
console.log("PO lines for both IDs + ECMP260179/183:");
console.table(pos);

const [hdr] = await pool.query(
    `SELECT order_nbr, status, order_date, last_sync
     FROM \`${pur}\`.purchase_history
     WHERE order_nbr IN ('ECMP260179','ECMP260183')`
);
console.log("PO headers:");
console.table(hdr);

await pool.end();
