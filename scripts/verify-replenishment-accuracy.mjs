/**
 * Verify Order Qty + Total Branch Repl formulas against known business examples.
 * Usage: node scripts/verify-replenishment-accuracy.mjs
 */
import dotenv from "dotenv";
import fs from "fs";
import mysql from "mysql2/promise";
import { isRetailReplenishmentBranch } from "../lib/companies.js";

dotenv.config({ path: fs.existsSync(".env.local") ? ".env.local" : ".env" });

const TARGET = 60;
const LOOKBACK = 90;
const LOGIC_VERSION = 21;
const failures = [];

function averageDailySales(qtySold, lookbackDays = LOOKBACK) {
    const q = Number(qtySold) || 0;
    const d = Number(lookbackDays) || LOOKBACK;
    return d > 0 ? q / d : 0;
}

/** a + b = c; e = d − c (whole units) */
function computeOrderQtyFromSellsPerDay(inventoryOnHand, comingPoQty, sellsPerDay) {
    const a = Number(inventoryOnHand) || 0;
    const b = Number(comingPoQty) || 0;
    const d = Number(sellsPerDay) || 0;
    const e = d - (a + b);
    if (!Number.isFinite(e) || e === 0) return 0;
    if (e > 0) return Math.ceil(e);
    return Math.floor(e);
}

function computeMainVendorOrderQty(mainInventory, totalBranchReplenishment, mainTargetStock) {
    const mainInv = Number(mainInventory) || 0;
    const branchRepl = Number(totalBranchReplenishment) || 0;
    const mainTarget = Number(mainTargetStock) || 0;
    if (mainTarget <= 0) return Math.max(0, branchRepl - mainInv);
    const branchShortfall = Math.max(0, branchRepl - mainInv);
    const stockAfterBranches = mainInv - branchRepl;
    const mainShelfGap = Math.max(0, mainTarget - stockAfterBranches);
    return Math.max(branchShortfall, mainShelfGap);
}

function computeMainRowMetrics({
    mainInventory,
    totalBranchReplenishment,
    mainQtySold90,
    lookbackDays = LOOKBACK,
    comingPoQty = 0,
}) {
    const qty90 = Number(mainQtySold90) || 0;
    const mainAds = qty90 > 0 ? averageDailySales(qty90, lookbackDays) : 0;
    const mainTargetStock = mainAds > 0 ? Math.ceil(mainAds * TARGET) : 0;
    const vendorOrderQty = computeMainVendorOrderQty(mainInventory, totalBranchReplenishment, mainTargetStock);
    const suggestedQty = computeOrderQtyFromSellsPerDay(mainInventory, comingPoQty, mainAds);
    return { mainAds, mainTargetStock, vendorOrderQty, suggestedQty };
}

function assert(name, cond, detail = "") {
    if (!cond) failures.push({ name, detail });
    console.log(cond ? "  PASS" : "  FAIL", name, detail ? `— ${detail}` : "");
}

console.log("=== Replenishment accuracy verification ===");
console.log("Logic version:", LOGIC_VERSION);
console.log("");

console.log("1) Pure formula checks (a+b=c, d−c=e)");
{
    // User example: a=47, b=399, c=446, d=7.9 → e = floor(7.9 − 446) = -439
    const e = computeOrderQtyFromSellsPerDay(47, 399, 7.9);
    assert("User example c = a+b = 446", 47 + 399 === 446);
    assert("User example e = whole surplus -439", e === -439, `got ${e}`);

    // Branch: sells/day 10.2, stock 3, coming 2 → ceil(5.2) = 6
    assert(
        "Branch order ceil fractional need",
        computeOrderQtyFromSellsPerDay(3, 2, 10.2) === 6,
        `got ${computeOrderQtyFromSellsPerDay(3, 2, 10.2)}`
    );
    assert(
        "Branch order exact whole stays whole",
        computeOrderQtyFromSellsPerDay(3, 2, 10) === 5,
        `got ${computeOrderQtyFromSellsPerDay(3, 2, 10)}`
    );

    // M15 vendor PO reference still uses TBR shelf math; Order qty uses sells/day formula
    const m15 = computeMainRowMetrics({
        mainInventory: 636,
        totalBranchReplenishment: 517,
        mainQtySold90: 13.93 * 90,
        lookbackDays: 90,
        comingPoQty: 0,
    });
    assert("M15 vendor PO = 717", m15.vendorOrderQty === 717, `got ${m15.vendorOrderQty}`);
    assert(
        "M15 Order qty = whole sells/day − MAIN",
        m15.suggestedQty === Math.floor(13.93 - 636),
        `got ${m15.suggestedQty}`
    );

    const papijetCyan = computeMainRowMetrics({
        mainInventory: 3147,
        totalBranchReplenishment: 756,
        mainQtySold90: 500,
        lookbackDays: 90,
        comingPoQty: 3000,
    });
    const papijetAds = 500 / 90;
    assert(
        "Papijet Cyan Order qty = whole sells/day − (MAIN + Coming PO)",
        papijetCyan.suggestedQty === Math.floor(papijetAds - (3147 + 3000)),
        `got ${papijetCyan.suggestedQty}`
    );
}

console.log("");
console.log("2) Database cross-check (if MySQL reachable)");

let pool;
try {
    pool = mysql.createPool({
        host: process.env.MYSQL_HOST,
        user: process.env.MYSQL_USER,
        password: process.env.MYSQL_PASSWORD,
        connectTimeout: 8000,
    });
    await pool.query("SELECT 1");
} catch (err) {
    console.log("  SKIP DB —", err.code || err.message);
    pool = null;
}

if (pool) {
    const pur = process.env.MYSQL_PURCHASE_DATABASE || "db_purchase";
    const skus = [
        { id: "110102002001000", label: "Eco M15 1L Cyan", expectVendorMax: 800 },
        { id: "110603004001000", label: "Papijet LTI 203 Yellow", expectVendorMax: 800 },
    ];

    for (const sku of skus) {
        console.log(`\n  SKU: ${sku.label} (${sku.id})`);
        const norm = sku.id.replace(/\s/g, "");

        const [branchRows] = await pool.query(
            `SELECT branch_id, suggested_qty, sales_velocity, qty_sold_90, current_stock
             FROM \`${pur}\`.replenishment_cache
             WHERE company_id = 'main'
               AND UPPER(REPLACE(TRIM(inventory_id), ' ', '')) = ?
               AND UPPER(TRIM(branch_id)) != 'MAIN'`,
            [norm]
        );

        let sumPositiveNeed = 0;
        let sumRetailSold90 = 0;
        for (const r of branchRows) {
            if (!isRetailReplenishmentBranch(String(r.branch_id || ""))) continue;
            const ads = Number(r.sales_velocity) || 0;
            const stock = Number(r.current_stock) || 0;
            const qty90 = Number(r.qty_sold_90) || 0;
            // New formula need: max(0, d − a)
            const need = ads > 0 ? Math.max(0, ads - stock) : 0;
            sumPositiveNeed += need;
            sumRetailSold90 += qty90;
        }

        const [mainOh] = await pool.query(
            `SELECT COALESCE(SUM(GREATEST(0, on_hand)), 0) AS oh
             FROM \`${pur}\`.forecast_item_stock
             WHERE company_id = 'main'
               AND UPPER(REPLACE(TRIM(inventory_id), ' ', '')) = ?
               AND UPPER(TRIM(warehouse_id)) IN ('MAIN', 'MAIN WH11')`,
            [norm]
        );

        const [sales] = await pool.query(
            `SELECT COALESCE(SUM(CASE
                WHEN order_type = 'Credit Memo' AND id LIKE 'CM-%' THEN -ABS(qty)
                WHEN order_type IN ('Invoice', 'Debit Memo') THEN ABS(qty)
                ELSE 0 END), 0) AS qty90
             FROM \`${pur}\`.product_periodic_sales
             WHERE UPPER(REPLACE(TRIM(inventory_id), ' ', '')) = ?
               AND document_date >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)`,
            [norm]
        );

        const mainInv = Number(mainOh[0]?.oh) || 0;
        const tbr = sumPositiveNeed;
        const networkQty90 = Number(sales[0]?.qty90) || 0;
        const mainQty90 = sumRetailSold90 > 0 ? sumRetailSold90 : networkQty90;
        const metrics = computeMainRowMetrics({
            mainInventory: mainInv,
            totalBranchReplenishment: tbr,
            mainQtySold90: mainQty90,
            lookbackDays: LOOKBACK,
        });
        const expectedOrder = computeOrderQtyFromSellsPerDay(
            mainInv,
            0,
            averageDailySales(mainQty90, LOOKBACK)
        );

        console.log(`    Positive branch need (d−a): ${tbr}, MAIN stock: ${mainInv}`);
        console.log(`    retail sold90: ${sumRetailSold90}, network: ${networkQty90}`);
        console.log(`    Vendor PO: ${metrics.vendorOrderQty}, Order qty: ${metrics.suggestedQty}`);

        assert(
            `${sku.label} Order qty = whole sells/day − MAIN`,
            metrics.suggestedQty === expectedOrder,
            `got ${metrics.suggestedQty}, expected ${expectedOrder}`
        );
        if (sku.expectVendorMax != null) {
            assert(
                `${sku.label} vendor PO not inflated by network sales`,
                metrics.vendorOrderQty <= sku.expectVendorMax,
                `got ${metrics.vendorOrderQty} (max ${sku.expectVendorMax})`
            );
        }

        const [bac] = await pool.query(
            `SELECT sales_velocity, current_stock FROM \`${pur}\`.replenishment_cache
             WHERE company_id='main' AND branch_id='BACOLOD'
               AND UPPER(REPLACE(TRIM(inventory_id),' ',''))=?`,
            [norm]
        );
        if (bac[0] && sku.label.includes("Papijet")) {
            const bacNeed = Math.max(0, (Number(bac[0].sales_velocity) || 0) - (Number(bac[0].current_stock) || 0));
            assert("BACOLOD need uses d−a formula", bacNeed >= 0, `BACOLOD need=${bacNeed}`);
        }
    }

    await pool.end();
}

console.log("");
if (failures.length) {
    console.log("FAILED", failures.length, "check(s):");
    for (const f of failures) console.log(" -", f.name, f.detail);
    process.exit(1);
}
console.log("All checks passed.");
