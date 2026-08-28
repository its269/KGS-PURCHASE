/**
 * Diagnose MAIN Total Branch Repl vs per-branch live need.
 * Usage: node scripts/diag-main-branch-repl.mjs [inventoryId]
 */
import dotenv from "dotenv";
import mysql from "mysql2/promise";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const id = (process.argv[2] || "130202101103800").toUpperCase();
const TARGET = 60;
const pool = mysql.createPool({
    host: process.env.MYSQL_HOST,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_PURCHASE_DATABASE || "db_purchase",
});
const invDb = process.env.MYSQL_INVENTORY_DATABASE || "db_kelin_inventory";

try {
    const [cacheRows] = await pool.query(
        `SELECT branch_id, sales_velocity, qty_sold_90, suggested_qty, current_stock, coming_po,
                total_branch_replenishment, updated_at,
                JSON_UNQUOTE(JSON_EXTRACT(ai_insights_json, '$.salesLogicVersion')) AS logic_ver
         FROM replenishment_cache
         WHERE company_id = 'main' AND UPPER(TRIM(inventory_id)) = ?
         ORDER BY branch_id`,
        [id]
    );
    console.log("Cache rows for", id);
    console.table(cacheRows);

    const main = cacheRows.find((r) => String(r.branch_id).toUpperCase() === "MAIN");
    const branches = cacheRows.filter((r) => String(r.branch_id).toUpperCase() !== "MAIN");

    let liveSum = 0;
    console.log("\nLive recompute per branch (ads*60 - stock - comingPO):");
    for (const b of branches) {
        const ads = Number(b.sales_velocity) || 0;
        const cachedStock = Number(b.current_stock) || 0;
        const cachedComing = Number(b.coming_po) || 0;
        const cachedSuggested = Number(b.suggested_qty) || 0;

        // Live on-hand from forecast_item_stock if present
        let liveStock = cachedStock;
        try {
            const [oh] = await pool.query(
                `SELECT COALESCE(SUM(GREATEST(0, COALESCE(on_hand, 0))), 0) AS onHand
                 FROM \`${invDb}\`.forecast_item_stock
                 WHERE UPPER(REPLACE(TRIM(inventory_id),' ','')) = ?
                   AND UPPER(TRIM(warehouse_id)) = ?
                   AND warehouse_id != '__catalog__'`,
                [id, String(b.branch_id).trim().toUpperCase()]
            );
            if (oh[0]) liveStock = Number(oh[0].onHand) || 0;
        } catch {
            /* table/col may differ */
        }

        const target = ads > 0 ? Math.ceil(ads * TARGET) : 0;
        const liveNeed = ads > 0 ? Math.max(0, target - liveStock - cachedComing) : 0;
        liveSum += liveNeed;
        console.log({
            branch: b.branch_id,
            ads,
            target,
            cachedStock,
            liveStock,
            cachedComing,
            cachedSuggested,
            liveNeed,
        });
    }

    console.log("\nSummary:", {
        mainCachedTotalBranchRepl: Number(main?.total_branch_replenishment) || 0,
        sumCachedSuggested: branches.reduce((s, b) => s + (Number(b.suggested_qty) || 0), 0),
        liveSumNeed: liveSum,
        mainLogicVer: main?.logic_ver,
        mainUpdated: main?.updated_at,
    });
} finally {
    await pool.end();
}
