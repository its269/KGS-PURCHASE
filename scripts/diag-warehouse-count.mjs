import mysql from "mysql2/promise";
const p = mysql.createPool({
    host: process.env.MYSQL_HOST,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_INVENTORY_DATABASE || "db_kelin_inventory",
});
const [[w]] = await p.query(
    "SELECT COUNT(*) c FROM inventory_items WHERE default_warehouse != '__catalog__'"
);
const [[s]] = await p.query(
    "SELECT SUM(on_hand) t, COUNT(DISTINCT inventory_id) p FROM inventory_items WHERE default_warehouse != '__catalog__'"
);
console.log("warehouse rows:", w.c, "total on_hand:", s.t, "products:", s.p);
await p.end();
