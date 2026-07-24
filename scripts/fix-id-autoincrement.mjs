import mysql from "mysql2/promise";

const conn = await mysql.createConnection({
    host: process.env.MYSQL_HOST,
    port: parseInt(process.env.MYSQL_PORT || "3306", 10),
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_INVENTORY_DATABASE || "db_kelin_inventory",
});

try {
    const [[{ maxId }]] = await conn.query("SELECT COALESCE(MAX(id), 0) AS maxId FROM inventory_items");
    await conn.query("ALTER TABLE inventory_items ADD KEY idx_inventory_row_id (id)").catch(() => {});
    await conn.query("ALTER TABLE inventory_items MODIFY COLUMN id INT NOT NULL AUTO_INCREMENT");
    await conn.query(`ALTER TABLE inventory_items AUTO_INCREMENT = ${maxId + 1}`);
    console.log("id column restored as AUTO_INCREMENT, next:", maxId + 1);
} catch (e) {
    console.error(e.message);
    process.exit(1);
} finally {
    await conn.end();
}
