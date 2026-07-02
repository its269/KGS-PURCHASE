import { NextResponse } from "next/server";
import { getSessionFromRequest, getActiveCompanyFromRequest } from "@/lib/session-store";
import { isExcludedBranchAlias } from "@/lib/companies";
import { MySqlService } from "@/services/mysql";
import { AcumaticaService } from "@/services/acumatica";
import {
    buildReplenishmentInsight,
    buildBranchBrief,
    TARGET_DAYS_OF_COVER,
    SAFETY_BUFFER_DAYS,
} from "@/lib/replenishment-insights";
import { SALES_LOOKBACK_DAYS, averageDailySales } from "@/lib/sales-velocity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ACU_SALES_TIMEOUT_MS = 60000;

function mergeSalesMaps(baseMap, acuMap) {
    const merged = new Map(baseMap);
    if (!acuMap) return merged;
    for (const [key, acu] of acuMap) {
        const existing = merged.get(key);
        if (!existing || (acu.qty_sold ?? 0) > (existing.qty_sold ?? 0)) {
            merged.set(key, acu);
        }
    }
    return merged;
}

function countPositiveSales(map) {
    let count = 0;
    for (const v of map.values()) if ((v.qty_sold ?? 0) > 0) count++;
    return count;
}

async function fetchSalesMap({ cookie, branch, isMainWarehouse, companyId }) {
    const salesBranch = isMainWarehouse ? "" : branch;

    const mysqlResult = await MySqlService.getReplenishmentSalesSummaryExtended({
        branch: salesBranch,
        companyId,
    });

    const mysqlPositive = countPositiveSales(mysqlResult.map);
    const useMysqlOnly =
        mysqlResult.salesScope === "catalog-network" || mysqlPositive >= 20;

    let acuMap = null;
    if (!useMysqlOnly && cookie && cookie !== "__bypass__") {
        try {
            acuMap = await Promise.race([
                AcumaticaService.fetchBranchGrossSalesSummary({ cookie, branch: salesBranch }),
                new Promise((_, reject) =>
                    setTimeout(() => reject(new Error("Acumatica sales timeout")), ACU_SALES_TIMEOUT_MS)
                ),
            ]);
        } catch (err) {
            console.warn("[Replenishment API] Acumatica gross sales skipped:", err.message);
        }
    }

    const merged = mergeSalesMaps(mysqlResult.map, acuMap);
    const acuUsed = acuMap && acuMap.size > 0 && countPositiveSales(acuMap) > mysqlPositive;

    return {
        map: merged,
        source: acuUsed ? "acumatica" : "mysql",
        salesMode: acuUsed ? "gross" : mysqlResult.mode,
        salesScope:
            mysqlResult.salesScope || (isMainWarehouse ? "network" : "branch"),
        lookbackDays: mysqlResult.lookbackDays || SALES_LOOKBACK_DAYS,
    };
}

function buildRecommendation(item, branch, vendorMap, leadTimeMap, recId) {
    const itemId = (item.inventoryId || "").toUpperCase().trim();
    const currentStock = Number(item.totalOnHand) || 0;
    const qtySold90 = Number(item.totalQtySold) || 0;
    const ads = averageDailySales(qtySold90, SALES_LOOKBACK_DAYS);
    const vendorId = vendorMap.get(itemId) || null;
    const leadTime = vendorId ? (leadTimeMap[vendorId]?.days || 0) : 0;

    if (ads <= 0) return null;

    const daysRemaining = Math.floor(currentStock / ads);
    const targetStock = Math.ceil(ads * TARGET_DAYS_OF_COVER);
    const suggestedQty = Math.max(0, targetStock - currentStock);
    const isCritical = daysRemaining <= (leadTime + SAFETY_BUFFER_DAYS);
    const priority = isCritical ? "High" : daysRemaining < 30 ? "Medium" : "Low";

    const needsRestock = suggestedQty > 0 || isCritical || currentStock === 0;
    if (!needsRestock && daysRemaining >= TARGET_DAYS_OF_COVER) return null;

    const orderQty = suggestedQty > 0 ? suggestedQty : Math.max(1, Math.ceil(ads * 14));

    const aiInsights = buildReplenishmentInsight({
        itemId: item.inventoryId,
        description: item.description,
        currentStock,
        suggestedQty: orderQty,
        priorityLevel: priority,
        branchId: branch,
        ads,
        daysRemaining,
        leadTimeDays: leadTime,
        vendorId,
        hasSalesHistory: true,
        qtySold90,
        targetStock,
        salesScope: item.salesScope,
    });

    return {
        recommendationId: `REC-${recId}`,
        itemId: item.inventoryId,
        description: item.description,
        currentStock,
        suggestedQty: orderQty,
        priorityLevel: priority,
        branchId: branch,
        restockSource: aiInsights.restockSource,
        generatedDate: new Date().toISOString(),
        aiInsights,
        stockSource: item.stockSource || "mysql",
    };
}

/** Replenishment API — branch + catalog-network sales velocity with Acumatica fallback. */
export async function GET(request) {
    const cookie = getSessionFromRequest(request);
    if (!cookie) {
        return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const branch = searchParams.get("branch") || "MAIN";
    const companyId = getActiveCompanyFromRequest(request) || "main";

    if (isExcludedBranchAlias(branch)) {
        return NextResponse.json({
            recommendations: [],
            brief: { headline: "Branch not available", detail: "This location is excluded from replenishment planning." },
            meta: { branch, targetDaysOfCover: TARGET_DAYS_OF_COVER, excluded: true },
        });
    }

    try {
        const isMainWarehouse = String(branch).trim().toUpperCase() === "MAIN";
        const { map: salesMap, source: salesSource, salesMode, salesScope, lookbackDays } =
            await fetchSalesMap({ cookie, branch, isMainWarehouse, companyId });

        const items = await MySqlService.getReplenishmentItems({
            branch,
            companyId,
            salesMap,
        });

        const vendorMap = await MySqlService.getItemVendorMap();
        const leadTimeMap = await MySqlService.getVendorLeadTimes();

        const recommendations = [];
        let recId = 2000;

        for (const item of items) {
            const rec = buildRecommendation(item, branch, vendorMap, leadTimeMap, recId++);
            if (rec) recommendations.push(rec);
        }

        const sorted = recommendations.sort((a, b) => {
            const pMap = { High: 3, Medium: 2, Low: 1 };
            if (pMap[b.priorityLevel] !== pMap[a.priorityLevel]) {
                return pMap[b.priorityLevel] - pMap[a.priorityLevel];
            }
            return b.suggestedQty - a.suggestedQty;
        });

        const brief = buildBranchBrief(sorted, branch);

        return NextResponse.json({
            recommendations: sorted,
            brief,
            meta: {
                branch,
                generatedAt: new Date().toISOString(),
                itemCount: sorted.length,
                targetDaysOfCover: TARGET_DAYS_OF_COVER,
                stockSource: "mysql",
                salesSource,
                salesMode,
                salesScope,
                salesLookbackDays: lookbackDays,
            },
        });
    } catch (err) {
        console.error("[Replenishment API Error]", err);
        return NextResponse.json({ message: err.message }, { status: 500 });
    }
}
