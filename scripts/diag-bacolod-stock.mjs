/**
 * Compare BACOLOD cache Branch stock vs live forecast_item_stock / inventory_items.
 * Usage: node scripts/diag-bacolod-stock.mjs
 */
import dotenv from "dotenv";
import mysql from "mysql2/promise";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const branch = "BACOLOD";
const inv = process.env.MYSQL_INVENTORY_DATABASE || "db_kelin_inventory";
const pur = process.env.MYSQL_PURCHASE_DATABASE || "db_purchase";
const pool = mysql.createPool({
    host: process.env.MYSQL_HOST,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
});

try {
    const [rows] = await pool.query(
        `SELECT inventory_id, description, current_stock, suggested_qty, sales_velocity, qty_sold_90, coming_po, updated_at
         FROM \`${pur}\`.replenishment_cache
         WHERE company_id = 'main' AND UPPER(TRIM(branch_id)) = ?
         ORDER BY suggested_qty DESC
         LIMIT 10`,
        [branch]
    );
    console.log("Top BACOLOD cache rows:");
    console.table(rows);

    let mismatches = 0;
    for (const r of rows) {
        const id = String(r.inventory_id || "").toUpperCase().replace(/\s+/g, "").trim();
        const [fis] = await pool.query(
            `SELECT COALESCE(SUM(GREATEST(0, COALESCE(on_hand, 0))), 0) AS onHand,
                    COALESCE(SUM(GREATEST(0, COALESCE(available, on_hand, 0))), 0) AS available
             FROM \`${pur}\`.forecast_item_stock
             WHERE company_id = 'main'
               AND UPPER(REPLACE(TRIM(inventory_id), ' ', '')) = ?
               AND UPPER(TRIM(warehouse_id)) = ?`,
            [id, branch]
        );
        const [ii] = await pool.query(
            `SELECT COALESCE(SUM(GREATEST(0, COALESCE(on_hand, 0))), 0) AS onHand,
                    COALESCE(SUM(GREATEST(0, COALESCE(available, on_hand, 0))), 0) AS available
             FROM \`${inv}\`.inventory_items
             WHERE company_id = 'main'
               AND default_warehouse != '__catalog__'
               AND UPPER(REPLACE(TRIM(inventory_id), ' ', '')) = ?
               AND (UPPER(TRIM(default_warehouse)) = ? OR UPPER(TRIM(branch_id)) = ?)`,
            [id, branch, branch]
        );
        const cacheStock = Number(r.current_stock) || 0;
        const forecast = Number(fis[0]?.onHand) || 0;
        const forecastAvail = Number(fis[0]?.available) || 0;
        const invStock = Number(ii[0]?.onHand) || 0;
        const diff = cacheStock !== forecast;
        if (diff) mismatches++;
        console.log({
            id,
            cacheStock,
            forecastOnHand: forecast,
            forecastAvailable: forecastAvail,
            inventoryItemsOnHand: invStock,
            cacheVsForecastDiff: cacheStock - forecast,
            ads: Number(r.sales_velocity) || 0,
            suggested: Number(r.suggested_qty) || 0,
        });
    }
    console.log(`\nMismatches cache vs forecast on-hand: ${mismatches}/${rows.length}`);

    // Key normalization probe: how many cache IDs fail forecast lookup with trim-only vs space-strip
    const [probe] = await pool.query(
        `SELECT COUNT(*) AS n
         FROM \`${pur}\`.replenishment_cache c
         LEFT JOIN \`${pur}\`.forecast_item_stock f
           ON f.company_id = 'main'
          AND UPPER(TRIM(f.warehouse_id)) = 'BACOLOD'
          AND UPPER(TRIM(f.inventory_id)) = UPPER(TRIM(c.inventory_id))
         WHERE c.company_id = 'main' AND UPPER(TRIM(c.branch_id)) = 'BACOLOD'
           AND f.inventory_id IS NULL
           AND COALESCE(c.current_stock, 0) > 0`
    );
    const [probe2] = await pool.query(
        `SELECT COUNT(*) AS n
         FROM \`${pur}\`.replenishment_cache c
         LEFT JOIN \`${pur}\`.forecast_item_stock f
           ON f.company_id = 'main'
          AND UPPER(TRIM(f.warehouse_id)) = 'BACOLOD'
          AND UPPER(REPLACE(TRIM(f.inventory_id), ' ', '')) = UPPER(REPLACE(TRIM(c.inventory_id), ' ', ''))
         WHERE c.company_id = 'main' AND UPPER(TRIM(c.branch_id)) = 'BACOLOD'
           AND f.inventory_id IS NULL
           AND COALESCE(c.current_stock, 0) > 0`
    );
    console.log("Cache rows with stock>0 missing forecast join (trim-only):", probe[0]?.n);
    console.log("Cache rows with stock>0 missing forecast join (space-strip):", probe2[0]?.n);
} finally {
    await pool.end();
}
