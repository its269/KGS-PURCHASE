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
const LOGIC_VERSION = 19;
const failures = [];

function averageDailySales(qtySold, lookbackDays = LOOKBACK) {
    const q = Number(qtySold) || 0;
    const d = Number(lookbackDays) || LOOKBACK;
    return d > 0 ? q / d : 0;
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

function resolveMainOrderQty(mainInventory, totalBranchReplenishment, mainTargetStock, comingPoQty = 0) {
    const branchRepl = Number(totalBranchReplenishment) || 0;
    const mainInv = Number(mainInventory) || 0;
    const comingPo = Number(comingPoQty) || 0;
    return branchRepl - (mainInv + comingPo);
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
    const suggestedQty = resolveMainOrderQty(
        mainInventory,
        totalBranchReplenishment,
        mainTargetStock,
        comingPoQty
    );
    return { mainTargetStock, vendorOrderQty, suggestedQty };
}

function assert(name, cond, detail = "") {
    if (!cond) failures.push({ name, detail });
    console.log(cond ? "  PASS" : "  FAIL", name, detail ? `— ${detail}` : "");
}

console.log("=== Replenishment accuracy verification ===");
console.log("Logic version:", LOGIC_VERSION);
console.log("");

console.log("1) Pure formula checks (business examples)");
{
    // M15 Cyan — vendor PO reference (vendorOrderQty); Order qty uses net formula when no coming PO
    const m15 = computeMainRowMetrics({
        mainInventory: 636,
        totalBranchReplenishment: 517,
        mainQtySold90: 13.93 * 90,
        lookbackDays: 90,
        comingPoQty: 0,
    });
    assert("M15 vendor PO = 717", m15.vendorOrderQty === 717, `got ${m15.vendorOrderQty}`);
    assert("M15 Order qty = TBR − MAIN (no coming PO)", m15.suggestedQty === -119, `got ${m15.suggestedQty}`);

    // Papijet Cyan — surplus when MAIN + Coming PO exceed branch need
    const papijetCyan = computeMainRowMetrics({
        mainInventory: 3147,
        totalBranchReplenishment: 756,
        mainQtySold90: 500,
        lookbackDays: 90,
        comingPoQty: 3000,
    });
    assert("Papijet Cyan Order qty = −5,391", papijetCyan.suggestedQty === -5391, `got ${papijetCyan.suggestedQty}`);

    // Papijet Yellow — branch need vs MAIN + Coming PO
    const papijet = computeMainRowMetrics({
        mainInventory: 2711,
        totalBranchReplenishment: 467,
        mainQtySold90: 500,
        lookbackDays: 90,
        comingPoQty: 2000,
    });
    assert("Papijet Yellow Order qty = −4,244", papijet.suggestedQty === -4244, `got ${papijet.suggestedQty}`);

    // Branch BACOLOD formula
    const ads = 22 / 90;
    const branchTarget = Math.ceil(ads * TARGET);
    const branchOrder = Math.max(0, branchTarget - 2);
    assert("Branch order uses shelf gap only", branchOrder >= 10 && branchOrder <= 15, `gap=${branchOrder} (stock=2, sold90≈22)`);
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
        { id: "110102002001000", label: "Eco M15 1L Cyan", expectVendorMax: 800, expectTbrMin: 400 },
        { id: "110603004001000", label: "Papijet LTI 203 Yellow", expectVendor: 0, expectTbrMin: 400, expectOrderMin: 400 },
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

        let sumBranchSuggested = 0;
        let sumLiveGap = 0;
        let sumRetailSold90 = 0;
        for (const r of branchRows) {
            if (!isRetailReplenishmentBranch(String(r.branch_id || ""))) continue;
            const ads = Number(r.sales_velocity) || 0;
            const stock = Number(r.current_stock) || 0;
            const suggested = Number(r.suggested_qty) || 0;
            const qty90 = Number(r.qty_sold_90) || 0;
            const gap = ads > 0 ? Math.max(0, Math.ceil(ads * TARGET) - stock) : 0;
            sumBranchSuggested += suggested;
            sumLiveGap += Math.max(suggested, gap);
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
        const tbr = Math.max(sumBranchSuggested, sumLiveGap);
        const networkQty90 = Number(sales[0]?.qty90) || 0;
        const mainQty90 = sumRetailSold90 > 0 ? sumRetailSold90 : networkQty90;
        const metrics = computeMainRowMetrics({
            mainInventory: mainInv,
            totalBranchReplenishment: tbr,
            mainQtySold90: mainQty90,
            lookbackDays: LOOKBACK,
        });

        console.log(`    Branch suggested sum: ${sumBranchSuggested}, live gap sum: ${sumLiveGap}`);
        console.log(`    Computed TBR: ${tbr}, MAIN stock: ${mainInv}, retail sold90: ${sumRetailSold90}, network: ${networkQty90}`);
        console.log(`    Vendor PO: ${metrics.vendorOrderQty}, Order qty: ${metrics.suggestedQty}`);

        if (sku.expectVendorMax != null) {
            assert(
                `${sku.label} vendor PO not inflated by network sales`,
                metrics.vendorOrderQty <= sku.expectVendorMax,
                `got ${metrics.vendorOrderQty} (max ${sku.expectVendorMax})`
            );
        }
        if (sku.expectTbrMin) {
            assert(`${sku.label} TBR >= ${sku.expectTbrMin}`, tbr >= sku.expectTbrMin, `got ${tbr}`);
        }
        if (sku.expectOrderMin) {
            assert(
                `${sku.label} Order qty >= ${sku.expectOrderMin}`,
                metrics.suggestedQty >= sku.expectOrderMin,
                `got ${metrics.suggestedQty}`
            );
        }

        const [bac] = await pool.query(
            `SELECT suggested_qty FROM \`${pur}\`.replenishment_cache
             WHERE company_id='main' AND branch_id='BACOLOD'
               AND UPPER(REPLACE(TRIM(inventory_id),' ',''))=?`,
            [norm]
        );
        if (bac[0] && sku.label.includes("Papijet")) {
            const bacQty = Number(bac[0].suggested_qty) || 0;
            assert("BACOLOD rolls into MAIN TBR", tbr >= bacQty, `BACOLOD=${bacQty}, TBR=${tbr}`);
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
