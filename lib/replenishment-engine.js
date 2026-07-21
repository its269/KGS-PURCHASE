import { filterReplenishmentBranchList, isExcludedBranchAlias, resolveCompanyIdForBranch, isEcomBranchAlias } from "@/lib/companies";
import { MySqlService } from "@/services/mysql";
import {
    buildReplenishmentInsight,
    buildBranchBrief,
    TARGET_DAYS_OF_COVER,
    SAFETY_BUFFER_DAYS,
} from "@/lib/replenishment-insights";
import { SALES_LOOKBACK_DAYS, averageDailySales } from "@/lib/sales-velocity";

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
        // Order / transfer qty after stock on hand + POs already coming to this branch
        suggestedQty = Math.max(0, targetStock - available);
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
    });

    return {
        recommendationId: `REC-${recId}`,
        itemId: item.inventoryId,
        description: item.description,
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
}) {
    const itemId = (item.inventoryId || "").toUpperCase().trim();
    const mainInventory = Number(item.totalOnHand) || 0;
    const qtySold = Number(item.totalQtySold) || 0;
    const ads = averageDailySales(qtySold, lookbackDays);
    const vendorId = vendorMap.get(itemId) || null;
    const leadTime = vendorId ? (leadTimeMap[vendorId]?.days || 0) : 0;
    const totalBranchReplenishment = Number(branchOrderQty) || 0;
    const comingPoQty = Number(comingPO) || 0;

    const availableAtMain = mainInventory + comingPoQty;
    const orderQty = Math.max(0, totalBranchReplenishment - availableAtMain);
    const daysRemaining = ads > 0 ? Math.floor(availableAtMain / ads) : null;
    const isCritical = orderQty > 0 && (
        availableAtMain < totalBranchReplenishment ||
        (ads > 0 && daysRemaining !== null && daysRemaining <= (leadTime + SAFETY_BUFFER_DAYS))
    );
    const priority = isCritical ? "High" : orderQty > 0 ? "Medium" : "Low";

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
        targetStock: totalBranchReplenishment,
        salesScope: item.salesScope || "network",
        mainWarehouseContext: {
            branchOrderQty: totalBranchReplenishment,
            comingPO: comingPoQty,
            totalBranchReplenishment,
        },
    });

    return {
        recommendationId: `REC-${recId}`,
        itemId: item.inventoryId,
        description: item.description,
        currentStock: mainInventory,
        mainInventory,
        branchOrderQty: totalBranchReplenishment,
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
    };
}

/**
 * Overlay live Coming PO for the selected destination warehouse onto recommendations.
 * Ensures MAIN Coming PO never includes other branches (and branch views stay branch-only),
 * even when MySQL replenishment_cache still has older all-warehouse totals.
 */
export async function applyLiveComingPo(recommendations, branch) {
    const dest = String(branch || "MAIN").trim().toUpperCase() || "MAIN";
    const isMain = dest === "MAIN";
    const comingPoMap = await MySqlService.getOpenPoQtyByItem({ warehouseId: dest });

    return (recommendations || []).map((rec) => {
        const key = (rec.itemId || "").toUpperCase().trim();
        const comingPoQty = comingPoMap.get(key) || 0;
        if (!isMain) {
            const currentStock = Number(rec.currentStock) || 0;
            const ads = Number(rec.aiInsights?.salesVelocity) || 0;
            const lookbackDays = Number(rec.lookbackDays) || SALES_LOOKBACK_DAYS;
            const targetStock = ads > 0 ? Math.ceil(ads * TARGET_DAYS_OF_COVER) : 0;
            const available = currentStock + comingPoQty;
            const suggestedQty = ads > 0 ? Math.max(0, targetStock - available) : Number(rec.suggestedQty) || 0;
            return {
                ...rec,
                comingPO: comingPoQty,
                suggestedQty,
            };
        }

        const mainInventory = Number(rec.mainInventory ?? rec.currentStock) || 0;
        const totalBranchReplenishment = Number(
            rec.totalBranchReplenishment ?? rec.branchOrderQty
        ) || 0;
        const availableAtMain = mainInventory + comingPoQty;
        const suggestedQty = Math.max(0, totalBranchReplenishment - availableAtMain);
        return {
            ...rec,
            comingPO: comingPoQty,
            suggestedQty,
            mainInventory,
            totalBranchReplenishment,
            branchOrderQty: rec.branchOrderQty ?? totalBranchReplenishment,
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
        rec.salesScope = salesScope;
        recommendations.push(rec);
    }
    return recommendations;
}

async function aggregateBranchOrderQty(companyId, vendorMap, leadTimeMap) {
    const branchList = filterReplenishmentBranchList(
        await MySqlService.getBranches(companyId)
    );
    const retailBranches = branchList
        .map((b) => b.SiteID || b.branch_id || "")
        .filter((id) => id && String(id).trim().toUpperCase() !== "MAIN" && !isExcludedBranchAlias(id));

    // Ultra-fast path: roll up suggested qty from existing branch caches in one SQL query
    const [qtyByItem, cachedBranches] = await Promise.all([
        MySqlService.getBranchOrderQtyFromCache(companyId),
        MySqlService.getCachedReplenishmentBranchIds(companyId),
    ]);

    const missing = retailBranches.filter((id) => {
        const key = String(id).trim();
        return key && !cachedBranches.has(key);
    });

    // Only compute branches that have no cache yet (avoids reloading every branch)
    if (missing.length > 0) {
        await Promise.all(
            missing.map(async (branchId) => {
                const effectiveCompanyId = resolveCompanyIdForBranch(companyId, branchId);
                const recs = await computeBranchRecommendations(branchId, companyId, vendorMap, leadTimeMap, 3000);
                await MySqlService.upsertReplenishmentCache(effectiveCompanyId, branchId, recs);
                for (const rec of recs) {
                    if (!rec || rec.suggestedQty <= 0) continue;
                    const key = (rec.itemId || "").toUpperCase().trim();
                    qtyByItem.set(key, (qtyByItem.get(key) || 0) + rec.suggestedQty);
                }
            })
        );
    }

    return { qtyByItem, retailBranches };
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
        const [{ qtyByItem: branchQtyMap }, comingPoMap, items] = await Promise.all([
            aggregateBranchOrderQty(companyId, vendorMap, leadTimeMap),
            MySqlService.getOpenPoQtyByItem({ warehouseId: "MAIN" }),
            MySqlService.getReplenishmentItems({ branch, companyId: effectiveCompanyId, salesMap }),
        ]);

        let recId = 2000;
        for (const item of items) {
            const key = (item.inventoryId || "").toUpperCase().trim();
            const branchOrderQty = branchQtyMap.get(key) || 0;
            const rec = buildMainRecommendation({
                item,
                branchOrderQty,
                comingPO: comingPoMap.get(key) || 0,
                vendorMap,
                leadTimeMap,
                recId: recId++,
                lookbackDays,
            });
            if (rec) recommendations.push(rec);
        }

        const missingKeys = [...branchQtyMap.keys()].filter(
            (key) => !recommendations.some((r) => (r.itemId || "").toUpperCase().trim() === key)
        );
        if (missingKeys.length > 0) {
            const catalogRows = await MySqlService.getCatalogItemsByIds(missingKeys, companyId);
            const catalogByKey = new Map(
                catalogRows.map((c) => [(c.inventoryId || "").toUpperCase().trim(), c])
            );
            for (const key of missingKeys) {
                const branchOrderQty = branchQtyMap.get(key) || 0;
                if (branchOrderQty <= 0) continue;
                const cat = catalogByKey.get(key);
                const rec = buildMainRecommendation({
                    item: {
                        inventoryId: cat?.inventoryId || key,
                        description: cat?.description || "",
                        totalOnHand: 0,
                        totalQtySold: salesMap.get(key)?.qty_sold || 0,
                        salesScope: "network",
                    },
                    branchOrderQty,
                    comingPO: comingPoMap.get(key) || 0,
                    vendorMap,
                    leadTimeMap,
                    recId: recId++,
                    lookbackDays,
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
            rec.salesScope = salesScope;
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
