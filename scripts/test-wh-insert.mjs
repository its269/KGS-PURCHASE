import mysql from "mysql2/promise";

const db = process.env.MYSQL_INVENTORY_DATABASE || "db_kelin_inventory";
console.log("DB:", db, process.env.MYSQL_HOST);

const pool = mysql.createPool({
    host: process.env.MYSQL_HOST,
    port: parseInt(process.env.MYSQL_PORT || "3306", 10),
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: db,
});

const now = new Date();
try {
    const [r] = await pool.query(
        `INSERT INTO inventory_items
            (inventory_id, company_id, default_warehouse, inventory_name, item_class,
             default_price, item_status, base_unit, type, posting_class,
             branch_id, site_id, on_hand, available, last_sync)
         VALUES ('__TEST__', 'main', 'MAIN', 'test', '', 0, 'Active', '', '', '',
                 'MAIN', 'MAIN', 1, 1, ?)
         ON DUPLICATE KEY UPDATE on_hand=VALUES(on_hand)`,
        [now]
    );
    console.log("insert result:", r);
} catch (e) {
    console.error("insert error:", e.message, e.code);
}

const [[c]] = await pool.query(
    "SELECT COUNT(*) c FROM inventory_items WHERE default_warehouse != '__catalog__'"
);
console.log("warehouse count:", c.c);

const [desc] = await pool.query("DESCRIBE inventory_items");
console.log("columns:", desc.map((d) => d.Field).join(", "));

await pool.query("DELETE FROM inventory_items WHERE inventory_id='__TEST__'");
await pool.end();
