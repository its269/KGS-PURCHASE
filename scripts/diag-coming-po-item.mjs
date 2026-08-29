import dotenv from "dotenv";
import mysql from "mysql2/promise";
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });
const pur = process.env.MYSQL_PURCHASE_DATABASE || "db_purchase";
const pool = mysql.createPool({
    host: process.env.MYSQL_HOST,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
});

const id = "130701301101306";
const [pos] = await pool.query(
    `SELECT h.order_nbr, h.status, d.warehouse_id, d.branch_id,
            d.qty, d.received_qty,
            GREATEST(d.qty - COALESCE(d.received_qty,0),0) AS open_qty
     FROM \`${pur}\`.purchase_order_details d
     INNER JOIN \`${pur}\`.purchase_history h
       ON h.order_nbr COLLATE utf8mb4_unicode_ci = d.order_nbr
     WHERE UPPER(REPLACE(TRIM(d.inventory_id),' ','')) = ?
       AND UPPER(TRIM(h.status)) IN ('OPEN','BALANCED','PENDING APPROVAL','PENDING PRINTING','PENDING EMAIL')
       AND GREATEST(d.qty - COALESCE(d.received_qty,0),0) > 0
     ORDER BY open_qty DESC`,
    [id]
);
console.log("Open PO lines for", id);
console.table(pos);
const bacolod = pos.filter((p) => String(p.warehouse_id || p.branch_id || "").toUpperCase().includes("BACOLOD"));
console.log(
    "BACOLOD-dest open qty sum:",
    bacolod.reduce((s, p) => s + Number(p.open_qty), 0)
);
console.log(
    "All open qty sum:",
    pos.reduce((s, p) => s + Number(p.open_qty), 0)
);
await pool.end();
