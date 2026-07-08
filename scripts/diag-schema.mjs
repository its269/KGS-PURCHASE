import mysql from "mysql2/promise";

const pool = mysql.createPool({
    host: process.env.MYSQL_HOST,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_INVENTORY_DATABASE || "db_kelin_inventory",
});

const [whDist] = await pool.query(
    `SELECT default_warehouse, COUNT(*) c FROM inventory_items GROUP BY default_warehouse ORDER BY c DESC LIMIT 10`
);
const [indexes] = await pool.query("SHOW INDEX FROM inventory_items");
console.log("default_warehouse dist:", whDist);
console.log("indexes:", indexes.map((i) => `${i.Key_name}(${i.Column_name})`).join(", "));

await pool.end();
