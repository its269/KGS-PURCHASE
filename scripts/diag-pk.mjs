import mysql from "mysql2/promise";

const pool = mysql.createPool({
    host: process.env.MYSQL_HOST,
    port: parseInt(process.env.MYSQL_PORT || "3306", 10),
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_INVENTORY_DATABASE || "db_kelin_inventory",
});

const [idx] = await pool.query("SHOW INDEX FROM inventory_items WHERE Key_name = 'PRIMARY'");
console.log("PRIMARY KEY columns:", idx.map((r) => r.Column_name));

const [dup] = await pool.query(
    `SELECT inventory_id, COUNT(*) c, GROUP_CONCAT(default_warehouse) whs
     FROM inventory_items GROUP BY inventory_id HAVING c > 1 LIMIT 5`
);
console.log("multi-row inventory_ids:", dup);

await pool.end();
