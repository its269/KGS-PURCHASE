/**
 * Fix inventory_items schema so catalog + per-branch warehouse rows can coexist.
 * - Drops inventory_id-only unique index that blocks warehouse rows
 * - Migrates PK to (inventory_id, default_warehouse, company_id)
 * - Resets stock fields on catalog rows
 *
 * Usage: node --env-file=.env.local scripts/migrate-inventory-schema.mjs
 */
import mysql from "mysql2/promise";

const inventoryDb = process.env.MYSQL_INVENTORY_DATABASE || "db_kelin_inventory";

const conn = await mysql.createConnection({
    host: process.env.MYSQL_HOST,
    port: parseInt(process.env.MYSQL_PORT || "3306", 10),
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: inventoryDb,
});

async function indexExists(name) {
    const [[row]] = await conn.query(
        `SELECT COUNT(*) AS c FROM information_schema.STATISTICS
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'inventory_items' AND INDEX_NAME = ?`,
        [inventoryDb, name]
    );
    return row.c > 0;
}

async function pkIncludes(col) {
    const [[row]] = await conn.query(
        `SELECT COUNT(*) AS c FROM information_schema.KEY_COLUMN_USAGE
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'inventory_items'
           AND CONSTRAINT_NAME = 'PRIMARY' AND COLUMN_NAME = ?`,
        [inventoryDb, col]
    );
    return row.c > 0;
}

try {
    console.log("=== inventory_items schema migration ===\n");

    // 1. Normalize catalog rows — stock belongs on warehouse rows only
    const [catReset] = await conn.query(
        `UPDATE inventory_items
         SET branch_id = NULL, site_id = NULL, on_hand = 0, available = 0,
             default_warehouse = '__catalog__'
         WHERE default_warehouse = '__catalog__'
            OR default_warehouse IS NULL
            OR TRIM(default_warehouse) = ''`
    );
    console.log(`Reset stock fields on ${catReset.affectedRows} catalog row(s).`);

    // 2. Drop inventory_id-only unique indexes that prevent multi-row per item
    for (const idx of ["uq_inventory_items_inventory_id", "inventory_id"]) {
        if (await indexExists(idx)) {
            await conn.query(`ALTER TABLE inventory_items DROP INDEX \`${idx}\``);
            console.log(`Dropped index: ${idx}`);
        }
    }

    // 3. Rebuild warehouse unique key to include company_id
    if (await indexExists("uq_inv_warehouse")) {
        await conn.query(`ALTER TABLE inventory_items DROP INDEX uq_inv_warehouse`);
        console.log("Dropped old uq_inv_warehouse");
    }
    await conn.query(
        `ALTER TABLE inventory_items
         ADD UNIQUE KEY uq_inv_warehouse (inventory_id, default_warehouse, company_id)`
    );
    console.log("Added uq_inv_warehouse (inventory_id, default_warehouse, company_id)");

    // 4. Migrate primary key off auto-increment id
    if (!(await pkIncludes("inventory_id"))) {
        const [[idCol]] = await conn.query(
            `SELECT EXTRA FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'inventory_items' AND COLUMN_NAME = 'id'`,
            [inventoryDb]
        );
        if (idCol?.EXTRA?.includes("auto_increment")) {
            await conn.query(`ALTER TABLE inventory_items MODIFY COLUMN id INT NOT NULL`);
            console.log("Removed AUTO_INCREMENT from id");
        }
        await conn.query(`ALTER TABLE inventory_items DROP PRIMARY KEY`);
        await conn.query(
            `ALTER TABLE inventory_items ADD PRIMARY KEY (inventory_id, default_warehouse, company_id)`
        );
        console.log("Primary key -> (inventory_id, default_warehouse, company_id)");
        const [[{ maxId }]] = await conn.query("SELECT COALESCE(MAX(id), 0) AS maxId FROM inventory_items");
        await conn.query(`ALTER TABLE inventory_items ADD KEY idx_inventory_row_id (id)`).catch(() => {});
        await conn.query(`ALTER TABLE inventory_items MODIFY COLUMN id INT NOT NULL AUTO_INCREMENT`);
        await conn.query(`ALTER TABLE inventory_items AUTO_INCREMENT = ${maxId + 1}`);
        console.log("Restored AUTO_INCREMENT on id");
    } else {
        console.log("Primary key already includes inventory_id");
    }

    const [[{ cat }]] = await conn.query(
        `SELECT COUNT(*) AS cat FROM inventory_items WHERE default_warehouse = '__catalog__'`
    );
    const [[{ wh }]] = await conn.query(
        `SELECT COUNT(*) AS wh FROM inventory_items WHERE default_warehouse != '__catalog__'`
    );
    console.log(`\nDone. catalog=${cat}, warehouse=${wh}`);
} catch (err) {
    console.error("Migration failed:", err.message);
    process.exit(1);
} finally {
    await conn.end();
}
