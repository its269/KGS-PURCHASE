/**
 * Post-sync health checks — sync_logs, row counts, orphans, vendor metrics.
 * Usage: node scripts/verify-sync-health.mjs
 */
import dotenv from "dotenv";
import mysql from "mysql2/promise";
import fs from "fs";

dotenv.config({ path: fs.existsSync(".env.local") ? ".env.local" : ".env" });

const inventoryDb = process.env.MYSQL_INVENTORY_DATABASE || "db_kelin_inventory";
const purchaseDb = process.env.MYSQL_PURCHASE_DATABASE || "db_purchase";

const pool = mysql.createPool({
    host: process.env.MYSQL_HOST,
    port: parseInt(process.env.MYSQL_PORT || "3306", 10),
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
});

console.log("=== Sync health verification ===\n");

try {
    const [logs] = await pool.query(
        `SELECT timestamp, mode, section, status, records_processed, message
         FROM \`${purchaseDb}\`.sync_logs
         ORDER BY timestamp DESC LIMIT 20`
    );
    if (!logs.length) {
        console.warn("WARN: No sync_logs entries — run a sync first");
    } else {
        console.log("Recent sync_logs (last 20):");
        for (const row of logs) {
            const ts = row.timestamp instanceof Date ? row.timestamp.toISOString() : row.timestamp;
            console.log(`  ${ts} | ${row.mode || "-"} | ${row.section} | ${row.status} | ${row.records_processed ?? "-"} | ${(row.message || "").slice(0, 60)}`);
        }
        const latestComplete = logs.find((r) => r.status === "complete" && r.section === "all");
        if (latestComplete) {
            console.log("\nOK  Found recent complete sync");
        } else {
            const errors = logs.filter((r) => r.status === "error");
            if (errors.length) console.warn(`WARN: ${errors.length} error entries in recent logs`);
        }
    }

    const tables = [
        { db: inventoryDb, table: "inventory_items", label: "inventory_items" },
        { db: purchaseDb, table: "product_periodic_sales", label: "product_periodic_sales" },
        { db: purchaseDb, table: "purchase_history", label: "purchase_history" },
        { db: purchaseDb, table: "purchase_order_details", label: "purchase_order_details" },
    ];
    console.log("\nRow counts:");
    for (const { db, table, label } of tables) {
        try {
            const [r] = await pool.query(`SELECT COUNT(*) AS cnt FROM \`${db}\`.\`${table}\``);
            console.log(`  ${label}: ${r[0].cnt}`);
        } catch {
            console.log(`  ${label}: (table missing)`);
        }
    }

    const [orphans] = await pool.query(
        `SELECT COUNT(*) AS cnt FROM \`${purchaseDb}\`.product_periodic_sales s
         LEFT JOIN \`${inventoryDb}\`.inventory_items i
           ON UPPER(TRIM(s.inventory_id)) = UPPER(TRIM(i.inventory_id))
           AND i.default_warehouse = '__catalog__'
         WHERE i.inventory_id IS NULL`
    );
    console.log(`\nOrphaned sales rows (no catalog match): ${orphans[0]?.cnt ?? 0}`);

    try {
        const [vendors] = await pool.query(
            `SELECT COUNT(*) AS total,
                    SUM(CASE WHEN avg_lead_time IS NOT NULL AND avg_lead_time > 0 THEN 1 ELSE 0 END) AS with_lead_time,
                    SUM(CASE WHEN reliability_score IS NOT NULL THEN 1 ELSE 0 END) AS with_reliability
             FROM \`${purchaseDb}\`.vendors`
        );
        const v = vendors[0];
        console.log(`Vendors: ${v.total} total, ${v.with_lead_time} with lead time, ${v.with_reliability} with reliability score`);
    } catch {
        console.log("Vendors table: not found or empty");
    }

    console.log("\nPASS: Sync health verification complete");
} catch (err) {
    console.error("FAIL:", err.message);
    process.exit(1);
} finally {
    await pool.end();
}
