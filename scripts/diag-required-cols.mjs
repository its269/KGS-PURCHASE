import mysql from "mysql2/promise";
const p = mysql.createPool({
    host: process.env.MYSQL_HOST,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_INVENTORY_DATABASE || "db_kelin_inventory",
});
const [cols] = await p.query(
    `SELECT COLUMN_NAME, IS_NULLABLE, COLUMN_DEFAULT, COLUMN_TYPE
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'inventory_items'
       AND IS_NULLABLE = 'NO' AND COLUMN_DEFAULT IS NULL
     ORDER BY ORDINAL_POSITION`,
    [process.env.MYSQL_INVENTORY_DATABASE || "db_kelin_inventory"]
);
console.log("NOT NULL without default:", cols.map((c) => c.COLUMN_NAME));
await p.end();
