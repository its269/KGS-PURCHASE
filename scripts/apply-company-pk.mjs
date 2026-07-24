/**
 * Apply company_id primary key migration (same logic as sync auto-migration).
 * Usage: node scripts/apply-company-pk.mjs
 */
import dotenv from "dotenv";
import mysql from "mysql2/promise";
import fs from "fs";

dotenv.config({ path: fs.existsSync(".env.local") ? ".env.local" : ".env" });

const inventoryDb = process.env.MYSQL_INVENTORY_DATABASE || "db_kelin_inventory";

const conn = await mysql.createConnection({
    host: process.env.MYSQL_HOST,
    port: parseInt(process.env.MYSQL_PORT || "3306", 10),
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
});

console.log("=== Apply company_id PK migration ===\n");

try {
    const [[pkCheck]] = await conn.query(
        `SELECT COUNT(*) as cnt FROM information_schema.KEY_COLUMN_USAGE
         WHERE TABLE_SCHEMA=? AND TABLE_NAME='inventory_items' AND CONSTRAINT_NAME='PRIMARY' AND COLUMN_NAME='company_id'`,
        [inventoryDb]
    );
    if (pkCheck.cnt > 0) {
        console.log("OK  Primary key already includes company_id");
        process.exit(0);
    }

    const [pkCols] = await conn.query(
        `SELECT COLUMN_NAME FROM information_schema.KEY_COLUMN_USAGE
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'inventory_items' AND CONSTRAINT_NAME = 'PRIMARY'
         ORDER BY ORDINAL_POSITION`,
        [inventoryDb]
    );
    console.log(`Current PK: (${pkCols.map((r) => r.COLUMN_NAME).join(", ")})`);

    await conn.query(`ALTER TABLE \`${inventoryDb}\`.\`inventory_items\` DROP PRIMARY KEY`);
    await conn.query(
        `ALTER TABLE \`${inventoryDb}\`.\`inventory_items\` ADD PRIMARY KEY (inventory_id, default_warehouse, company_id)`
    );
    console.log("OK  Primary key updated to (inventory_id, default_warehouse, company_id)");
} catch (err) {
    console.error("FAIL:", err.message);
    process.exit(1);
} finally {
    await conn.end();
}
