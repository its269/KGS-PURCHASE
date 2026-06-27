import dotenv from "dotenv";
import mysql from "mysql2/promise";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const pool = mysql.createPool({
    host: process.env.MYSQL_HOST,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_INVENTORY_DATABASE || "db_kelin_inventory",
});

const [[cat]] = await pool.query(
    "SELECT COUNT(*) AS c FROM inventory_items WHERE default_warehouse = '__catalog__'"
);
const [[wh]] = await pool.query(
    "SELECT COUNT(*) AS c FROM inventory_items WHERE default_warehouse != '__catalog__'"
);
const [[ls]] = await pool.query(
    "SELECT MAX(last_sync) AS ls FROM inventory_items"
);
const [sample] = await pool.query(
    `SELECT inventory_id, default_warehouse, branch_id, on_hand, last_sync
     FROM inventory_items WHERE default_warehouse != '__catalog__' LIMIT 3`
);

console.log({ catalogRows: cat.c, warehouseRows: wh.c, lastSync: ls.ls, warehouseSample: sample });
await pool.end();
