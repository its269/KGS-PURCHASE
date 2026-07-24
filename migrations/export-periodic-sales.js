/**
 * migrations/export-periodic-sales.js
 * Exports all rows from Supabase product_periodic_sales → MySQL db_purchase.product_periodic_sales
 *
 * Usage: node migrations/export-periodic-sales.js
 */

import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";
import mysql from "mysql2/promise";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadEnvFile(filePath) {
    if (!existsSync(filePath)) return;
    for (const line of readFileSync(filePath, "utf8").split("\n")) {
        const t = line.trim();
        if (!t || t.startsWith("#")) continue;
        const eq = t.indexOf("=");
        if (eq === -1) continue;
        const k = t.slice(0, eq).trim();
        let v = t.slice(eq + 1).trim();
        if ((v.startsWith("'") && v.endsWith("'")) || (v.startsWith('"') && v.endsWith('"'))) v = v.slice(1, -1);
        if (!process.env[k]) process.env[k] = v;
    }
}
loadEnvFile(resolve(__dirname, "../.env.local"));
loadEnvFile(resolve(__dirname, "../.env"));

const BATCH_SIZE = 1000;

/* ── Supabase ──────────────────────────────────────────────── */
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SECRET_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY in env.");
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

/* ── MySQL ─────────────────────────────────────────────────── */
const pool = mysql.createPool({
    host: process.env.MYSQL_HOST,
    port: parseInt(process.env.MYSQL_PORT || "3306", 10),
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_PURCHASE_DATABASE || "db_purchase",
    waitForConnections: true,
    connectionLimit: 5,
    // Allow large bulk-insert packets
    multipleStatements: false,
});

const COLS = 12; // number of columns per row

async function upsertBatch(connection, rows) {
    if (!rows.length) return;

    // Build: INSERT INTO ... VALUES (?,?,?,...), (?,?,?,...), ... ON DUPLICATE KEY UPDATE ...
    const placeholders = rows.map(() => `(${Array(COLS).fill("?").join(",")})`).join(",");
    const values = rows.flatMap(r => [
        r.id,
        r.branch_name ?? null,
        r.order_type ?? null,
        r.financial_period ?? null,
        r.document_date ?? null,
        r.description ?? null,
        r.qty ?? null,
        r.total_amount ?? null,
        r.item_class ?? null,
        r.inventory_id ?? null,
        r.posting_class ?? null,
        r.last_sync ? new Date(r.last_sync) : new Date(),
    ]);

    await connection.query(
        `INSERT INTO product_periodic_sales
            (id, branch_name, order_type, financial_period, document_date,
             description, qty, total_amount, item_class, inventory_id,
             posting_class, last_sync)
         VALUES ${placeholders}
         ON DUPLICATE KEY UPDATE
            branch_name      = VALUES(branch_name),
            order_type       = VALUES(order_type),
            financial_period = VALUES(financial_period),
            document_date    = VALUES(document_date),
            description      = VALUES(description),
            qty              = VALUES(qty),
            total_amount     = VALUES(total_amount),
            item_class       = VALUES(item_class),
            inventory_id     = VALUES(inventory_id),
            posting_class    = VALUES(posting_class),
            last_sync        = VALUES(last_sync)`,
        values
    );
}

async function run() {
    console.log("Starting Supabase → MySQL export of product_periodic_sales...\n");

    // Get total count first
    const { count, error: countErr } = await supabase
        .from("product_periodic_sales")
        .select("*", { count: "exact", head: true });

    if (countErr) {
        console.error("Failed to count Supabase rows:", countErr.message);
        process.exit(1);
    }

    console.log(`Total rows in Supabase: ${count}`);

    const connection = await pool.getConnection();
    let exported = 0;
    let from = 0;

    try {
        await connection.beginTransaction();

        while (from < count) {
            const { data, error } = await supabase
                .from("product_periodic_sales")
                .select("*")
                .range(from, from + BATCH_SIZE - 1);

            if (error) {
                throw new Error(`Supabase fetch error at offset ${from}: ${error.message}`);
            }

            if (!data || data.length === 0) break;

            await upsertBatch(connection, data);
            exported += data.length;
            from += BATCH_SIZE;

            const pct = Math.round((exported / count) * 100);
            process.stdout.write(`\r  Exported ${exported} / ${count} rows (${pct}%)`);
        }

        await connection.commit();
        console.log(`\n\nDone. ${exported} rows exported to db_purchase.product_periodic_sales.`);
    } catch (err) {
        await connection.rollback();
        console.error("\nExport failed, transaction rolled back:", err.message);
        process.exit(1);
    } finally {
        connection.release();
        await pool.end();
    }
}

run();
