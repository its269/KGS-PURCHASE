import { filterReplenishmentBranchList, isExcludedBranchAlias, resolveCompanyIdForBranch, isEcomBranchAlias } from "@/lib/companies";
import { MySqlService } from "@/services/mysql";
import {
    buildReplenishmentInsight,
    buildBranchBrief,
    TARGET_DAYS_OF_COVER,
    SAFETY_BUFFER_DAYS,
} from "@/lib/replenishment-insights";
import { SALES_LOOKBACK_DAYS, averageDailySales } from "@/lib/sales-velocity";
import { normalizeInvKey } from "@/lib/forecast-generator";

/** Bump when sales velocity logic changes so stale replenishment_cache rows are recomputed. */
export const REPLENISHMENT_SALES_LOGIC_VERSION = 15;

/**
 * MAIN vendor PO quantity: ship branch transfers from on-hand MAIN stock first,
 * then order enough so MAIN still reaches its own 60-day shelf target.
 * Example: target 836, on-hand 636, branches need 517 → 836 − (636 − 517) = 717.
 */
export function computeMainVendorOrderQty(mainInventory, totalBranchReplenishment, mainTargetStock) {
    const mainInv = Number(mainInventory) || 0;
    const branchRepl = Number(totalBranchReplenishment) || 0;
    const mainTarget = Number(mainTargetStock) || 0;
    if (mainTarget <= 0) {
        return Math.max(0, branchRepl - mainInv);
    }
    const branchShortfall = Math.max(0, branchRepl - mainInv);
    const stockAfterBranches = mainInv - branchRepl;
    const mainShelfGap = Math.max(0, mainTarget - stockAfterBranches);
    return Math.max(branchShortfall, mainShelfGap);
}

export function buildRecommendation(item, branch, vendorMap, leadTimeMap, recId, lookbackDays = SALES_LOOKBACK_DAYS, comingPO = 0) {
    const itemId = (item.inventoryId || "").toUpperCase().trim();
    const currentStock = Number(item.totalOnHand) || 0;
    const comingPoQty = Number(comingPO) || 0;
    const available = currentStock + comingPoQty;
    const qtySold = Number(item.totalQtySold) || 0;
    const ads = averageDailySales(qtySold, lookbackDays);
    const vendorId = vendorMap.get(itemId) || null;
    const leadTime = vendorId ? (leadTimeMap[vendorId]?.days || 0) : 0;
    const hasSalesHistory = ads > 0;

    let daysRemaining = null;
    let targetStock = 0;
    let suggestedQty = 0;
    let priority = "Low";

    if (hasSalesHistory) {
        daysRemaining = Math.floor(available / ads);
        targetStock = Math.ceil(ads * TARGET_DAYS_OF_COVER);
        // Transfer need from MAIN is based on on-hand vs 60-day target.
        // Coming PO stays visible separately — do not zero Order qty when large open
        // vendor POs exist but shelf stock is still below target.
        suggestedQty = Math.max(0, targetStock - currentStock);
        const isCritical = daysRemaining <= (leadTime + SAFETY_BUFFER_DAYS);
        priority = isCritical ? "High" : daysRemaining < 30 ? "Medium" : "Low";
    }

    const aiInsights = buildReplenishmentInsight({
        itemId: item.inventoryId,
        description: item.description,
        currentStock,
        suggestedQty,
        priorityLevel: priority,
        branchId: branch,
        ads,
        daysRemaining: daysRemaining ?? 0,
        leadTimeDays: leadTime,
        vendorId,
        hasSalesHistory,
        qtySold90: qtySold,
        targetStock,
        salesScope: item.salesScope,
        lookbackDays,
    });

    return {
        recommendationId: `REC-${recId}`,
        itemId: item.inventoryId,
        description: item.description,
        itemClass: item.itemClass || item.ItemClass || "",
        currentStock,
        comingPO: comingPoQty,
        suggestedQty,
        priorityLevel: priority,
        branchId: branch,
        restockSource: aiInsights.restockSource,
        generatedDate: new Date().toISOString(),
        aiInsights,
        stockSource: item.stockSource || "mysql",
        leadTimeDays: leadTime,
        vendorId,
        qtySold90: qtySold,
        lookbackDays,
        salesLogicVersion: REPLENISHMENT_SALES_LOGIC_VERSION,
    };
}

export function buildMainRecommendation({
    item,
    branchOrderQty,
    comingPO,
    vendorMap,
    leadTimeMap,
    recId,
    lookbackDays = SALES_LOOKBACK_DAYS,
    branchesNeeding = 0,
}) {
    const itemId = (item.inventoryId || "").toUpperCase().trim();
    const mainInventory = Number(item.totalOnHand) || 0;
    const qtySold = Number(item.totalQtySold) || 0;
    const ads = averageDailySales(qtySold, lookbackDays);
    const vendorId = vendorMap.get(itemId) || null;
    const leadTime = vendorId ? (leadTimeMap[vendorId]?.days || 0) : 0;
    const totalBranchReplenishment = Number(branchOrderQty) || 0;
    const comingPoQty = Number(comingPO) || 0;
    const branchCount = Number(branchesNeeding) || 0;

    const mainTargetStock = ads > 0 ? Math.ceil(ads * TARGET_DAYS_OF_COVER) : 0;
    const vendorShortfall = Math.max(0, totalBranchReplenishment - mainInventory);
    const mainShelfGap = computeMainVendorOrderQty(mainInventory, 0, mainTargetStock);
    const orderQty = computeMainVendorOrderQty(mainInventory, totalBranchReplenishment, mainTargetStock);
    const daysRemaining = ads > 0 ? Math.floor((mainInventory + comingPoQty) / ads) : null;
    const isCritical = orderQty > 0 && (
        vendorShortfall > 0 ||
        (ads > 0 && daysRemaining !== null && daysRemaining <= (leadTime + SAFETY_BUFFER_DAYS))
    );
    const priority = isCritical ? "High" : orderQty > 0 ? (vendorShortfall > 0 ? "Medium" : "Low") : "Low";

    const aiInsights = buildReplenishmentInsight({
        itemId: item.inventoryId,
        description: item.description,
        currentStock: mainInventory,
        suggestedQty: orderQty,
        priorityLevel: priority,
        branchId: "MAIN",
        ads,
        daysRemaining: daysRemaining ?? 0,
        leadTimeDays: leadTime,
        vendorId,
        hasSalesHistory: ads > 0,
        qtySold90: qtySold,
        targetStock: mainTargetStock,
        salesScope: item.salesScope || "network",
        lookbackDays,
            mainWarehouseContext: {
                branchOrderQty: totalBranchReplenishment,
                comingPO: comingPoQty,
                totalBranchReplenishment,
                branchesNeeding: branchCount,
                vendorShortfall,
                mainTargetStock,
                mainShelfGap,
            },
    });

    return {
        recommendationId: `REC-${recId}`,
        itemId: item.inventoryId,
        description: item.description,
        itemClass: item.itemClass || item.ItemClass || "",
        currentStock: mainInventory,
        mainInventory,
        branchOrderQty: totalBranchReplenishment,
        branchesNeeding: branchCount,
        comingPO: comingPoQty,
        totalBranchReplenishment,
        suggestedQty: orderQty,
        priorityLevel: priority,
        branchId: "MAIN",
        restockSource: aiInsights.restockSource,
        generatedDate: new Date().toISOString(),
        aiInsights,
        stockSource: item.stockSource || "mysql",
        leadTimeDays: leadTime,
        vendorId,
        qtySold90: qtySold,
        lookbackDays,
        isMainWarehouseView: true,
        salesLogicVersion: REPLENISHMENT_SALES_LOGIC_VERSION,
    };
}

/**
 * Overlay live Qty On Hand + Coming PO onto recommendations.
 * Cache rows can be stale; stock must match Acumatica-synced forecast_item_stock.
 *
 * Inventory IDs are normalized (spaces stripped) so cache keys like 2000SBMHR8002
 * match forecast rows like "2000SBMHR800 2".
 */
/**
 * Resolve MAIN Total Branch Repl demand maps.
 * Always merge live SQL + replenishment_cache rollups (max per item) so a
 * partial/empty live map cannot zero out items that still have branch gaps.
 */
async function resolveMainBranchDemand(companyId) {
    // Single merged rollup: live sales+stock, cache recompute, branch suggested_qty sum.
    return MySqlService.getAccurateRetailBranchDemandRollup(companyId);
}

export async function applyLiveComingPo(recommendations, branch) {
    const dest = String(branch || "MAIN").trim().toUpperCase() || "MAIN";
    const isMain = dest === "MAIN";
    const companyId = resolveCompanyIdForBranch("main", dest);

    if (!isMain) {
        const [comingPoMap, onHandMap] = await Promise.all([
            MySqlService.getOpenPoQtyByItem({ warehouseId: dest }),
            MySqlService.getBranchOnHandMap({ branch: dest, companyId }),
        ]);

        return (recommendations || []).map((rec) => {
            const key = normalizeInvKey(rec.itemId);
            // Live forecast map is authoritative — do not fall back to stale cache stock.
            const comingPoQty = Number(comingPoMap.get(key)) || 0;
            const currentStock = Number(onHandMap.get(key)) || 0;
            const lookbackDays = Number(rec.lookbackDays) || SALES_LOOKBACK_DAYS;
            const qtySold90 = Number(rec.qtySold90) || 0;
            const adsFromQty = qtySold90 > 0 ? averageDailySales(qtySold90, lookbackDays) : 0;
            const ads = Number(rec.aiInsights?.salesVelocity) || adsFromQty || 0;
            const leadTime = Number(rec.leadTimeDays ?? rec.aiInsights?.leadTimeDays) || 0;
            const vendorId = rec.vendorId || null;
            const targetStock = ads > 0 ? Math.ceil(ads * TARGET_DAYS_OF_COVER) : 0;
            const available = currentStock + comingPoQty;
            // Order qty = gap to 60-day target using on-hand only (Coming PO is informational).
            const suggestedQty = ads > 0 ? Math.max(0, targetStock - currentStock) : 0;
            const daysRemaining = ads > 0 ? Math.floor(available / ads) : null;
            const hasSalesHistory = ads > 0;
            let priority = "Low";
            if (hasSalesHistory) {
                const isCritical = daysRemaining !== null && daysRemaining <= (leadTime + SAFETY_BUFFER_DAYS);
                priority = isCritical ? "High" : daysRemaining < 30 ? "Medium" : "Low";
            }

            const aiInsights = buildReplenishmentInsight({
                itemId: rec.itemId,
                description: rec.description,
                currentStock,
                suggestedQty,
                priorityLevel: priority,
                branchId: dest,
                ads,
                daysRemaining: daysRemaining ?? 0,
                leadTimeDays: leadTime,
                vendorId,
                hasSalesHistory,
                qtySold90,
                targetStock,
                salesScope: rec.salesScope || rec.aiInsights?.salesScope || "branch",
                lookbackDays,
            });

            return {
                ...rec,
                currentStock,
                comingPO: comingPoQty,
                suggestedQty,
                priorityLevel: priority,
                restockSource: aiInsights.restockSource,
                stockSource: "forecast_item_stock",
                aiInsights: {
                    ...aiInsights,
                    salesVelocity: ads,
                    daysRemaining: daysRemaining ?? aiInsights.daysRemaining,
                    leadTimeDays: leadTime,
                },
            };
        });
    }

    // Accurate retail demand via bulk SQL (not stale cache ads). Avoids N-branch sales maps.
    // Order qty uses live MAIN on-hand minus that demand total (Coming PO is informational).
    const [comingPoMap, onHandMap, demand] = await Promise.all([
        MySqlService.getOpenPoQtyByItem({ warehouseId: dest }),
        MySqlService.getBranchOnHandMap({ branch: dest, companyId }),
        resolveMainBranchDemand(companyId),
    ]);

    return (recommendations || []).map((rec) => {
        const key = normalizeInvKey(rec.itemId);
        const comingPoQty = Number(comingPoMap.get(key)) || 0;
        // Live MAIN stock is authoritative.
        const mainInventory = Number(onHandMap.get(key)) || 0;
        const rolledDemand = Number(demand.qtyByItem.get(key)) || 0;
        const cachedDemand = Math.max(
            Number(rec.totalBranchReplenishment) || 0,
            Number(rec.branchOrderQty) || 0
        );
        // Demand map is authoritative; never drop a positive MAIN cache value if rollup missed a key.
        const totalBranchReplenishment = Math.max(rolledDemand, cachedDemand);
        const branchesNeeding = Number(demand.branchesNeedingByItem.get(key)) || 0;
        const adsFromDemand = Number(demand.salesByItem.get(key)?.ads) || 0;
        const lookbackDays = Number(rec.lookbackDays) || SALES_LOOKBACK_DAYS;
        const qtySold90 =
            Number(demand.salesByItem.get(key)?.qty_sold) ||
            Number(rec.qtySold90) ||
            0;
        const adsFromQty = qtySold90 > 0 ? averageDailySales(qtySold90, lookbackDays) : 0;
        const ads = adsFromDemand || Number(rec.aiInsights?.salesVelocity) || adsFromQty || 0;
        const mainTargetStock = ads > 0 ? Math.ceil(ads * TARGET_DAYS_OF_COVER) : 0;
        const vendorShortfall = Math.max(0, totalBranchReplenishment - mainInventory);
        const mainShelfGap = computeMainVendorOrderQty(mainInventory, 0, mainTargetStock);
        const suggestedQty = computeMainVendorOrderQty(
            mainInventory,
            totalBranchReplenishment,
            mainTargetStock
        );
        const leadTime = Number(rec.leadTimeDays ?? rec.aiInsights?.leadTimeDays) || 0;
        const vendorId = rec.vendorId || null;
        const daysRemaining = ads > 0 ? Math.floor((mainInventory + comingPoQty) / ads) : null;
        const isCritical = suggestedQty > 0 && (
            vendorShortfall > 0 ||
            (ads > 0 && daysRemaining !== null && daysRemaining <= (leadTime + SAFETY_BUFFER_DAYS))
        );
        const priority = isCritical ? "High" : suggestedQty > 0 ? (vendorShortfall > 0 ? "Medium" : "Low") : "Low";
        const aiInsights = buildReplenishmentInsight({
            itemId: rec.itemId,
            description: rec.description,
            currentStock: mainInventory,
            suggestedQty,
            priorityLevel: priority,
            branchId: "MAIN",
            ads,
            daysRemaining: daysRemaining ?? 0,
            leadTimeDays: leadTime,
            vendorId,
            hasSalesHistory: ads > 0,
            qtySold90,
            targetStock: mainTargetStock,
            salesScope: rec.salesScope || rec.aiInsights?.salesScope || "network",
            lookbackDays,
            mainWarehouseContext: {
                branchOrderQty: totalBranchReplenishment,
                comingPO: comingPoQty,
                totalBranchReplenishment,
                branchesNeeding,
                vendorShortfall,
                mainTargetStock,
                mainShelfGap,
            },
        });
        return {
            ...rec,
            comingPO: comingPoQty,
            suggestedQty,
            currentStock: mainInventory,
            mainInventory,
            totalBranchReplenishment,
            branchOrderQty: totalBranchReplenishment,
            branchesNeeding,
            priorityLevel: priority,
            stockSource: "forecast_item_stock",
            isMainWarehouseView: true,
            aiInsights: {
                ...aiInsights,
                salesVelocity: ads,
                daysRemaining: daysRemaining ?? aiInsights.daysRemaining,
                leadTimeDays: leadTime,
            },
        };
    });
}

async function fetchBranchSalesMap(branch, companyId) {
    const result = await MySqlService.getAccurateReplenishmentSalesMap({ branch, companyId });
    return {
        map: result.map,
        salesScope: result.salesScope || (branch ? "branch" : "network"),
        lookbackDays: result.lookbackDays || SALES_LOOKBACK_DAYS,
        salesMode: result.salesMode || "gross",
    };
}

async function computeBranchRecommendations(branchId, companyId, vendorMap, leadTimeMap, startRecId = 2000) {
    const effectiveCompanyId = resolveCompanyIdForBranch(companyId, branchId);
    const [{ map: salesMap, salesScope, lookbackDays }, comingPoMap] = await Promise.all([
        fetchBranchSalesMap(branchId, effectiveCompanyId),
        MySqlService.getOpenPoQtyByItem({ warehouseId: branchId }),
    ]);
    const items = await MySqlService.getReplenishmentItems({
        branch: branchId,
        companyId: effectiveCompanyId,
        salesMap,
    });

    const recommendations = [];
    let recId = startRecId;
    for (const item of items) {
        item.salesScope = salesScope;
        const key = (item.inventoryId || "").toUpperCase().trim();
        const rec = buildRecommendation(
            item,
            branchId,
            vendorMap,
            leadTimeMap,
            recId++,
            lookbackDays,
            comingPoMap.get(key) || 0
        );
        rec.salesScope = item.salesScope || salesScope;
        recommendations.push(rec);
    }
    return recommendations;
}

async function aggregateBranchOrderQty(companyId) {
    const branchList = filterReplenishmentBranchList(
        await MySqlService.getReplenishmentBranches(companyId)
    );
    const retailBranches = branchList
        .map((b) => b.SiteID || b.branch_id || "")
        .filter((id) => id && String(id).trim().toUpperCase() !== "MAIN" && !isExcludedBranchAlias(id));

    // Bulk accurate demand (live sales + stock). Do not sum stale cache ads.
    const { qtyByItem, salesByItem, branchesNeedingByItem } =
        await resolveMainBranchDemand(companyId);

    return { qtyByItem, salesByItem, branchesNeedingByItem, retailBranches };
}

export async function computeReplenishmentForBranch(branch, companyId = "main") {
    const isMainWarehouse = String(branch).trim().toUpperCase() === "MAIN";
    const effectiveCompanyId = resolveCompanyIdForBranch(companyId, branch);

    // Parallelize independent lookups for cold starts
    const [vendorMap, leadTimeMap, salesBundle] = await Promise.all([
        MySqlService.getItemVendorMap(),
        MySqlService.getEffectiveVendorLeadTimes(),
        fetchBranchSalesMap(isMainWarehouse ? "" : branch, effectiveCompanyId),
    ]);

    let recommendations = [];
    let salesScope = salesBundle.salesScope || (isMainWarehouse ? "network" : "branch");
    let lookbackDays = salesBundle.lookbackDays || SALES_LOOKBACK_DAYS;
    let salesMode = salesBundle.salesMode || "gross";
    const salesMap = salesBundle.map;

    if (isMainWarehouse) {
        // MAIN Sells / day = sum of retail-branch velocities (same branches as Total Branch Repl),
        // not a separate network invoice rollup that can disagree with branch planning.
        const [{ qtyByItem: branchQtyMap, salesByItem, branchesNeedingByItem }, comingPoMap, items] = await Promise.all([
            aggregateBranchOrderQty(companyId),
            MySqlService.getOpenPoQtyByItem({ warehouseId: "MAIN" }),
            MySqlService.getReplenishmentItems({ branch, companyId: effectiveCompanyId, salesMap }),
        ]);

        lookbackDays = SALES_LOOKBACK_DAYS;
        salesScope = "network";
        salesMode = "live-branch-demand";

        const withMainSales = (item) => {
            const key = (item.inventoryId || "").toUpperCase().replace(/\s+/g, "").trim();
            const rolled = salesByItem.get(key);
            if (!rolled) {
                return { ...item, salesScope: "network" };
            }
            const rolledAds = Number(rolled.ads) || 0;
            const qtySold =
                rolledAds > 0
                    ? rolledAds * lookbackDays
                    : Number(rolled.qty_sold) || Number(item.totalQtySold) || 0;
            return {
                ...item,
                totalQtySold: qtySold,
                salesScope: "network",
            };
        };

        let recId = 2000;
        for (const item of items) {
            const key = (item.inventoryId || "").toUpperCase().replace(/\s+/g, "").trim();
            const branchOrderQty = branchQtyMap.get(key) || 0;
            const rec = buildMainRecommendation({
                item: withMainSales(item),
                branchOrderQty,
                comingPO: comingPoMap.get(key) || 0,
                vendorMap,
                leadTimeMap,
                recId: recId++,
                lookbackDays,
                branchesNeeding: branchesNeedingByItem.get(key) || 0,
            });
            if (rec) recommendations.push(rec);
        }

        const missingKeys = [...branchQtyMap.keys()].filter(
            (key) => !recommendations.some((r) => (r.itemId || "").toUpperCase().replace(/\s+/g, "").trim() === key)
        );
        if (missingKeys.length > 0) {
            const catalogRows = await MySqlService.getCatalogItemsByIds(missingKeys, companyId);
            const catalogByKey = new Map(
                catalogRows.map((c) => [(c.inventoryId || "").toUpperCase().replace(/\s+/g, "").trim(), c])
            );
            for (const key of missingKeys) {
                const branchOrderQty = branchQtyMap.get(key) || 0;
                if (branchOrderQty <= 0) continue;
                const cat = catalogByKey.get(key);
                const rolled = salesByItem.get(key);
                const rolledAds = Number(rolled?.ads) || 0;
                const qtySold =
                    rolledAds > 0
                        ? rolledAds * lookbackDays
                        : Number(rolled?.qty_sold) || Number(salesMap.get(key)?.qty_sold) || 0;
                const rec = buildMainRecommendation({
                    item: {
                        inventoryId: cat?.inventoryId || key,
                        description: cat?.description || "",
                        itemClass: cat?.itemClass || "",
                        totalOnHand: 0,
                        totalQtySold: qtySold,
                        salesScope: "network",
                    },
                    branchOrderQty,
                    comingPO: comingPoMap.get(key) || 0,
                    vendorMap,
                    leadTimeMap,
                    recId: recId++,
                    lookbackDays,
                    branchesNeeding: branchesNeedingByItem.get(key) || 0,
                });
                if (rec) recommendations.push(rec);
            }
        }
    } else {
        // Branch view: Coming PO = open POs destined for this branch only
        const [items, comingPoMap] = await Promise.all([
            MySqlService.getReplenishmentItems({
                branch,
                companyId: effectiveCompanyId,
                salesMap,
            }),
            MySqlService.getOpenPoQtyByItem({ warehouseId: branch }),
        ]);
        let recId = 2000;
        for (const item of items) {
            item.salesScope = salesScope;
            const key = (item.inventoryId || "").toUpperCase().trim();
            const rec = buildRecommendation(
                item,
                branch,
                vendorMap,
                leadTimeMap,
                recId++,
                lookbackDays,
                comingPoMap.get(key) || 0
            );
            rec.salesScope = item.salesScope || salesScope;
            recommendations.push(rec);
        }
    }

    const sorted = recommendations.sort((a, b) => {
        const pMap = { High: 3, Medium: 2, Low: 1 };
        if (pMap[b.priorityLevel] !== pMap[a.priorityLevel]) {
            return pMap[b.priorityLevel] - pMap[a.priorityLevel];
        }
        return b.suggestedQty - a.suggestedQty;
    });

    return {
        recommendations: sorted,
        brief: buildBranchBrief(sorted, branch),
        meta: {
            branch,
            generatedAt: new Date().toISOString(),
            itemCount: sorted.length,
            targetDaysOfCover: TARGET_DAYS_OF_COVER,
            stockSource: "mysql",
            salesSource: "mysql",
            salesMode,
            salesScope,
            salesLookbackDays: lookbackDays,
            isMainWarehouseView: isMainWarehouse,
            salesLogicVersion: REPLENISHMENT_SALES_LOGIC_VERSION,
        },
    };
}

export async function rebuildAllReplenishmentCache(companyId = "main") {
    const branchList = filterReplenishmentBranchList(
        await MySqlService.getReplenishmentBranches(companyId)
    );
    const branches = ["MAIN", ...branchList
        .map((b) => b.SiteID || b.branch_id || "")
        .filter((id) => id && String(id).trim().toUpperCase() !== "MAIN" && !isExcludedBranchAlias(id))];

    const uniqueBranches = [...new Set(branches)];
    let totalRows = 0;

    for (const branchId of uniqueBranches) {
        const payload = await computeReplenishmentForBranch(branchId, companyId);
        const cacheCompanyId = resolveCompanyIdForBranch(companyId, branchId);
        const count = await MySqlService.upsertReplenishmentCache(cacheCompanyId, branchId, payload.recommendations);
        totalRows += count;
    }

    return { branches: uniqueBranches.length, totalRows };
}

export { TARGET_DAYS_OF_COVER, SALES_LOOKBACK_DAYS };
