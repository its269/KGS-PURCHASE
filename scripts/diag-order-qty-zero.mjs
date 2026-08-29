/**
 * Verify Order Qty for BACOLOD Papijet + a few MAIN SKUs.
 */
import dotenv from "dotenv";
import mysql from "mysql2/promise";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const pur = process.env.MYSQL_PURCHASE_DATABASE || "db_purchase";
const TARGET = 60;
const LOOKBACK = 90;
const pool = mysql.createPool({
    host: process.env.MYSQL_HOST,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
});

function calc({ stock, coming, ads }) {
    const available = stock + coming;
    const target = ads > 0 ? Math.ceil(ads * TARGET) : 0;
    const orderQty = ads > 0 ? Math.max(0, target - available) : 0;
    const daysLeft = ads > 0 ? Math.floor(available / ads) : null;
    return { available, target, orderQty, daysLeft };
}

try {
    const [rows] = await pool.query(
        `SELECT inventory_id, description, current_stock, coming_po, sales_velocity, qty_sold_90, suggested_qty
         FROM \`${pur}\`.replenishment_cache
         WHERE company_id = 'main'
           AND UPPER(TRIM(branch_id)) = 'BACOLOD'
           AND (description LIKE '%Papijet%' OR description LIKE '%papijet%' OR inventory_id LIKE '%PAPI%')
         ORDER BY description
         LIMIT 20`
    );
    console.log("=== BACOLOD Papijet cache vs formula ===");
    for (const r of rows) {
        const id = String(r.inventory_id || "").toUpperCase().replace(/\s+/g, "").trim();
        const [fis] = await pool.query(
            `SELECT COALESCE(SUM(GREATEST(0, on_hand)), 0) AS onHand
             FROM \`${pur}\`.forecast_item_stock
             WHERE company_id = 'main'
               AND UPPER(TRIM(warehouse_id)) = 'BACOLOD'
               AND UPPER(REPLACE(TRIM(inventory_id), ' ', '')) = ?`,
            [id]
        );
        const stock = Number(fis[0]?.onHand) || 0;
        const coming = Number(r.coming_po) || 0;
        const ads = Number(r.sales_velocity) || 0;
        const qty90 = Number(r.qty_sold_90) || 0;
        const adsFromQty = qty90 > 0 ? qty90 / LOOKBACK : 0;
        const live = calc({ stock, coming, ads: ads || adsFromQty });
        console.log({
            id,
            desc: String(r.description || "").slice(0, 40),
            cacheStock: Number(r.current_stock) || 0,
            liveStock: stock,
            ads: ads || adsFromQty,
            qty90,
            cacheSuggested: Number(r.suggested_qty) || 0,
            liveOrderQty: live.orderQty,
            target: live.target,
            daysLeft: live.daysLeft,
            reason:
                live.orderQty === 0
                    ? ads || adsFromQty
                        ? `stock ${stock} >= 60-day target ${live.target}`
                        : "no sales velocity"
                    : `need ${live.orderQty} to reach target ${live.target}`,
        });
    }

    // How many BACOLOD items have suggested 0 vs >0
    const [stats] = await pool.query(
        `SELECT
            SUM(CASE WHEN COALESCE(suggested_qty,0) = 0 THEN 1 ELSE 0 END) AS zero_qty,
            SUM(CASE WHEN COALESCE(suggested_qty,0) > 0 THEN 1 ELSE 0 END) AS need_qty,
            COUNT(*) AS total
         FROM \`${pur}\`.replenishment_cache
         WHERE company_id = 'main' AND UPPER(TRIM(branch_id)) = 'BACOLOD'`
    );
    console.log("\nBACOLOD suggested_qty mix:", stats[0]);

    // Sample of zero-qty items that still have sales — confirm formula
    const [zeros] = await pool.query(
        `SELECT inventory_id, description, current_stock, sales_velocity, qty_sold_90, suggested_qty
         FROM \`${pur}\`.replenishment_cache
         WHERE company_id = 'main' AND UPPER(TRIM(branch_id)) = 'BACOLOD'
           AND COALESCE(suggested_qty,0) = 0
           AND COALESCE(sales_velocity,0) > 0
         ORDER BY sales_velocity DESC
         LIMIT 8`
    );
    console.log("\nTop zero-order items that still sell (should be well-stocked):");
    for (const r of zeros) {
        const ads = Number(r.sales_velocity) || 0;
        const stock = Number(r.current_stock) || 0;
        const live = calc({ stock, coming: 0, ads });
        console.log({
            id: r.inventory_id,
            stock,
            ads,
            target: live.target,
            daysLeft: live.daysLeft,
            ok: stock >= live.target,
        });
    }
} finally {
    await pool.end();
}
