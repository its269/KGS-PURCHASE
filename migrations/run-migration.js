/**
 * migrations/run-migration.js
 * Runs 001_db_purchase_product_periodic_sales.sql against the configured MySQL server.
 * Reads env vars from .env.local / .env without dotenv (parse manually).
 *
 * Usage: node migrations/run-migration.js
 */

import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { readFileSync, existsSync } from "fs";
import mysql from "mysql2/promise";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Minimal env loader — reads KEY=VALUE lines, supports quoted values
function loadEnvFile(filePath) {
    if (!existsSync(filePath)) return;
    const lines = readFileSync(filePath, "utf8").split("\n");
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eqIdx = trimmed.indexOf("=");
        if (eqIdx === -1) continue;
        const key = trimmed.slice(0, eqIdx).trim();
        let val = trimmed.slice(eqIdx + 1).trim();
        // Strip surrounding single or double quotes
        if ((val.startsWith("'") && val.endsWith("'")) || (val.startsWith('"') && val.endsWith('"'))) {
            val = val.slice(1, -1);
        }
        if (!process.env[key]) process.env[key] = val;
    }
}

// Load .env.local first (higher priority), then .env as fallback
loadEnvFile(resolve(__dirname, "../.env.local"));
loadEnvFile(resolve(__dirname, "../.env"));

const SQL_FILE = resolve(__dirname, "001_db_purchase_product_periodic_sales.sql");
const SQL_FILE_002 = resolve(__dirname, "002_inventory_items_add_stock_columns.sql");

async function runFile(connection, filePath, dbOverride) {
    const sql = readFileSync(filePath, "utf8");
    await connection.query(sql);
    console.log(`Applied: ${filePath.split(/[\\/]/).pop()}`);
}

async function run() {
    // Connect without specifying a database so we can CREATE DATABASE
    const connection = await mysql.createConnection({
        host: process.env.MYSQL_HOST,
        port: parseInt(process.env.MYSQL_PORT || "3306", 10),
        user: process.env.MYSQL_USER,
        password: process.env.MYSQL_PASSWORD,
        multipleStatements: true,
    });

    console.log(`Connected to MySQL at ${process.env.MYSQL_HOST}:${process.env.MYSQL_PORT || 3306}`);

    try {
        // 001 — create db_purchase.product_periodic_sales
        await runFile(connection, SQL_FILE);
        console.log(`Database : ${process.env.MYSQL_PURCHASE_DATABASE || "db_purchase"}`);
        console.log(`Table    : product_periodic_sales`);

        // 002 — add missing columns to inventory_items (safe, checks information_schema first)
        const inventoryDb = process.env.MYSQL_INVENTORY_DATABASE || "db_kelin_inventory";
        const columnsToAdd = [
            { name: "on_hand", def: "DECIMAL(18, 4) NOT NULL DEFAULT 0" },
            { name: "available", def: "DECIMAL(18, 4) NOT NULL DEFAULT 0" },
            { name: "branch_id", def: "VARCHAR(100) NULL" },
            { name: "site_id", def: "VARCHAR(100) NULL" },
            { name: "last_sync", def: "DATETIME NULL" },
            { name: "type", def: "VARCHAR(50) NULL" },
            { name: "item_type", def: "VARCHAR(50) NULL" },
            { name: "posting_class", def: "VARCHAR(100) NULL" },
            { name: "base_unit", def: "VARCHAR(50) NULL" },
            { name: "item_class", def: "VARCHAR(100) NULL" },
            { name: "default_price", def: "DECIMAL(18, 4) DEFAULT 0" },
            { name: "inventory_name", def: "VARCHAR(255) NULL" }
        ];

        console.log(`Checking columns in ${inventoryDb}.inventory_items...`);
        for (const col of columnsToAdd) {
            const [[row]] = await connection.query(
                `SELECT COUNT(*) AS cnt FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'inventory_items' AND COLUMN_NAME = ?`,
                [inventoryDb, col.name]
            );
            if (row.cnt === 0) {
                try {
                    await connection.query(
                        `ALTER TABLE \`${inventoryDb}\`.\`inventory_items\` ADD COLUMN \`${col.name}\` ${col.def}`
                    );
                    console.log(`  + Added column: ${col.name}`);
                } catch (alterErr) {
                    console.error(`  ! Failed to add column ${col.name}:`, alterErr.message);
                }
            } else {
                console.log(`  ~ Already exists: ${col.name}`);
            }
        }

        // 003 — add UNIQUE KEY on (inventory_id, default_warehouse) so ON DUPLICATE KEY UPDATE works
        const [[{ idxCount }]] = await connection.query(
            `SELECT COUNT(*) AS idxCount FROM information_schema.STATISTICS
             WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'inventory_items' AND INDEX_NAME = 'uq_inv_warehouse'`,
            [inventoryDb]
        );
        if (idxCount === 0) {
            await connection.query(
                `ALTER TABLE \`${inventoryDb}\`.\`inventory_items\`
                 ADD UNIQUE KEY \`uq_inv_warehouse\` (\`inventory_id\`, \`default_warehouse\`)`
            );
            console.log(`  + Added UNIQUE KEY uq_inv_warehouse (inventory_id, default_warehouse)`);
        } else {
            console.log(`  ~ UNIQUE KEY uq_inv_warehouse already exists`);
        }

        // 004 — delete orphan rows (default_warehouse IS NULL) created by old upsertInventoryItems
        const [[{ orphans }]] = await connection.query(
            `SELECT COUNT(*) AS orphans FROM \`${inventoryDb}\`.\`inventory_items\` WHERE default_warehouse IS NULL`
        );
        if (orphans > 0) {
            await connection.query(
                `DELETE FROM \`${inventoryDb}\`.\`inventory_items\` WHERE default_warehouse IS NULL`
            );
            console.log(`  + Deleted ${orphans} orphan row(s) with default_warehouse=NULL`);
        } else {
            console.log(`  ~ No orphan rows found`);
        }

        console.log(`Database : ${inventoryDb}`);
        console.log(`Table    : inventory_items`);

        // 005 — ensure posting_class and tax_category have a safe default ('' not NULL)
        //        so INSERT without those columns doesn't fail in strict mode.
        for (const colName of ["posting_class", "tax_category", "created_by", "image_url"]) {
            const [[row]] = await connection.query(
                `SELECT IS_NULLABLE, COLUMN_DEFAULT FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'inventory_items' AND COLUMN_NAME = ?`,
                [inventoryDb, colName]
            );
            if (row && row.COLUMN_DEFAULT === null && row.IS_NULLABLE === "NO") {
                await connection.query(
                    `ALTER TABLE \`${inventoryDb}\`.\`inventory_items\`
                     ALTER COLUMN \`${colName}\` SET DEFAULT ''`
                );
                console.log(`  + Set DEFAULT '' on column: ${colName}`);
            } else if (row) {
                console.log(`  ~ ${colName}: already has default or is nullable`);
            }
        }

        // 007 — change item_status from ENUM to VARCHAR(50) to accept all Acumatica status values
        const [[{ colType }]] = await connection.query(
            `SELECT COLUMN_TYPE AS colType FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'inventory_items' AND COLUMN_NAME = 'item_status'`,
            [inventoryDb]
        );
        if (colType && colType.toLowerCase().startsWith("enum")) {
            await connection.query(
                `ALTER TABLE \`${inventoryDb}\`.\`inventory_items\`
                 MODIFY COLUMN \`item_status\` VARCHAR(50) NOT NULL DEFAULT 'active'`
            );
            console.log(`  + Changed item_status from ENUM to VARCHAR(50)`);
        } else {
            console.log(`  ~ item_status: already VARCHAR or compatible`);
        }
        await connection.query(`
            CREATE TABLE IF NOT EXISTS \`${inventoryDb}\`.\`branches\` (
                \`id\`          INT UNSIGNED    NOT NULL AUTO_INCREMENT,
                \`branch_id\`   VARCHAR(100)    NOT NULL,
                \`branch_name\` VARCHAR(255)    NOT NULL DEFAULT '',
                \`active\`      TINYINT(1)      NOT NULL DEFAULT 1,
                \`created_at\`  TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (\`id\`),
                UNIQUE KEY \`uq_branch_id\` (\`branch_id\`)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        console.log(`  ~ branches table ready`);
    } catch (err) {
        console.error("Migration failed:", err.message);
        process.exit(1);
    } finally {
        await connection.end();
    }
}

run();
