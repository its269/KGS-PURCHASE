import { NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/session-store";
import { MySqlService } from "@/services/mysql";
import {
    buildReplenishmentInsight,
    buildBranchBrief,
    TARGET_DAYS_OF_COVER,
    SAFETY_BUFFER_DAYS,
} from "@/lib/replenishment-insights";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function buildRecommendation(item, branch, vendorMap, leadTimeMap, recId) {
    const itemId = (item.inventoryId || "").toUpperCase().trim();
    const currentStock = Number(item.totalOnHand) || 0;
    const qtySold90 = Number(item.totalQtySold) || 0;
    const ads = qtySold90 / 90;
    const vendorId = vendorMap.get(itemId) || null;
    const leadTime = vendorId ? (leadTimeMap[vendorId]?.days || 0) : 0;

    if (ads > 0) {
        const daysRemaining = Math.floor(currentStock / ads);
        const targetStock = Math.ceil(ads * TARGET_DAYS_OF_COVER);
        const suggestedQty = Math.max(0, targetStock - currentStock);
        const isCritical = daysRemaining <= (leadTime + SAFETY_BUFFER_DAYS);
        const priority = isCritical ? "High" : daysRemaining < 30 ? "Medium" : "Low";

        if (suggestedQty <= 0 && !isCritical) return null;

        const aiInsights = buildReplenishmentInsight({
            itemId: item.inventoryId,
            description: item.description,
            currentStock,
            suggestedQty: suggestedQty || Math.ceil(ads * 14),
            priorityLevel: priority,
            branchId: branch,
            ads,
            daysRemaining,
            leadTimeDays: leadTime,
            vendorId,
            hasSalesHistory: true,
            qtySold90,
            targetStock,
        });

        return {
            recommendationId: `REC-${recId}`,
            itemId: item.inventoryId,
            description: item.description,
            currentStock,
            suggestedQty: suggestedQty || Math.ceil(ads * 14),
            priorityLevel: priority,
            branchId: branch,
            restockSource: aiInsights.restockSource,
            generatedDate: new Date().toISOString(),
            aiInsights,
            stockSource: item.stockSource || "mysql",
        };
    }

    if (currentStock < 5 && item.itemStatus === "Active") {
        const aiInsights = buildReplenishmentInsight({
            itemId: item.inventoryId,
            description: item.description,
            currentStock,
            suggestedQty: 10,
            priorityLevel: "Low",
            branchId: branch,
            hasSalesHistory: false,
            qtySold90: 0,
            targetStock: 0,
        });

        return {
            recommendationId: `REC-${recId}`,
            itemId: item.inventoryId,
            description: item.description,
            currentStock,
            suggestedQty: 10,
            priorityLevel: "Low",
            branchId: branch,
            restockSource: aiInsights.restockSource,
            generatedDate: new Date().toISOString(),
            aiInsights,
            stockSource: item.stockSource || "mysql",
        };
    }

    return null;
}

/**
 * Replenishment API — sales velocity analysis with plain-language AI insights.
 */
export async function GET(request) {
    const cookie = getSessionFromRequest(request);
    if (!cookie) {
        return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const branch = searchParams.get("branch") || "MAIN";

    try {
        const items = await MySqlService.getReplenishmentItems({ branch });
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
            },
        });
    } catch (err) {
        console.error("[Replenishment API Error]", err);
        return NextResponse.json({ message: err.message }, { status: 500 });
    }
}
