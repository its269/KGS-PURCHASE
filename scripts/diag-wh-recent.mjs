import mysql from "mysql2/promise";
const p = mysql.createPool({
    host: process.env.MYSQL_HOST,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_INVENTORY_DATABASE || "db_kelin_inventory",
});
const [[wh]] = await p.query("SELECT COUNT(*) c FROM inventory_items WHERE default_warehouse != '__catalog__'");
const [recent] = await p.query(
    `SELECT inventory_id, default_warehouse, branch_id, on_hand, last_sync
     FROM inventory_items WHERE default_warehouse != '__catalog__'
     ORDER BY last_sync DESC LIMIT 5`
);
const [[ls]] = await p.query("SELECT MAX(last_sync) ls FROM inventory_items WHERE default_warehouse != '__catalog__'");
console.log({ warehouseRows: wh.c, maxWhSync: ls.ls, recent });
await p.end();
