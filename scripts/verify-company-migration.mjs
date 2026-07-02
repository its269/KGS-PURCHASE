/**
 * Verify company_id migration on inventory_items.
 * Usage: node scripts/verify-company-migration.mjs
 */
import dotenv from "dotenv";
import mysql from "mysql2/promise";
import fs from "fs";

dotenv.config({ path: fs.existsSync(".env.local") ? ".env.local" : ".env" });

const inventoryDb = process.env.MYSQL_INVENTORY_DATABASE || "db_kelin_inventory";

const pool = mysql.createPool({
    host: process.env.MYSQL_HOST,
    port: parseInt(process.env.MYSQL_PORT || "3306", 10),
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
});

console.log("=== Company ID migration verification ===\n");

try {
    const [cols] = await pool.query(
        `SELECT COLUMN_NAME FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'inventory_items' AND COLUMN_NAME = 'company_id'`,
        [inventoryDb]
    );
    if (!cols.length) {
        console.error("FAIL: company_id column missing on inventory_items");
        console.error("      Run login + full sync to auto-migrate, or apply migrations/007_company_id.sql");
        process.exit(1);
    }
    console.log("OK  company_id column exists");

    const [pkCols] = await pool.query(
        `SELECT COLUMN_NAME FROM information_schema.KEY_COLUMN_USAGE
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'inventory_items' AND CONSTRAINT_NAME = 'PRIMARY'
         ORDER BY ORDINAL_POSITION`,
        [inventoryDb]
    );
    const pk = pkCols.map((r) => r.COLUMN_NAME);
    console.log(`OK  Primary key: (${pk.join(", ")})`);
    if (!pk.includes("company_id")) {
        console.warn("WARN: company_id not in primary key — run full sync to rebuild PK");
    }

    const [split] = await pool.query(
        `SELECT company_id, branch_id, COUNT(*) AS cnt
         FROM \`${inventoryDb}\`.inventory_items
         WHERE default_warehouse != '__catalog__'
         GROUP BY company_id, branch_id
         ORDER BY company_id, branch_id`
    );
    console.log("\nStock rows by company_id / branch_id:");
    for (const row of split) {
        console.log(`    ${row.company_id} | ${row.branch_id} | ${row.cnt}`);
    }

    const [misclassified] = await pool.query(
        `SELECT COUNT(*) AS cnt FROM \`${inventoryDb}\`.inventory_items
         WHERE company_id = 'main'
           AND default_warehouse != '__catalog__'
           AND UPPER(TRIM(branch_id)) IN ('ECOM', 'ECOMMERCE', 'E-COMMERCE', 'E COMMERCE')`
    );
    const bad = misclassified[0]?.cnt ?? 0;
    if (bad > 0) {
        console.warn(`\nWARN: ${bad} ecommerce branch rows still under company_id='main'`);
        console.warn("      Sign in or run full sync to run cleanupMisclassifiedEcomBranches()");
    } else {
        console.log("\nOK  No misclassified ecommerce rows under main");
    }

    const [ecomCount] = await pool.query(
        `SELECT COUNT(*) AS cnt FROM \`${inventoryDb}\`.inventory_items WHERE company_id = 'ecommerce'`
    );
    console.log(`OK  ecommerce company rows: ${ecomCount[0]?.cnt ?? 0}`);

    console.log("\nPASS: Company migration verification complete");
} catch (err) {
    console.error("FAIL:", err.message);
    process.exit(1);
} finally {
    await pool.end();
}
