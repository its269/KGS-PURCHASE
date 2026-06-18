import { NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/session-store";
import { MySqlService } from "@/services/mysql";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * AI Replenishment API
 * Uses MySQL sales velocity (ADS) and lead times to predict stockouts and suggest order quantities.
 */
export async function GET(request) {
    const cookie = getSessionFromRequest(request);
    
    // We prioritize MySQL data, but still check for a session to ensure authorized access
    if (!cookie) {
        return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    try {
        console.log(">>> [AI Replenishment] Running dynamic sales velocity analysis...");

        // 1. Fetch data from MySQL (Last 90 days of sales + current stock levels)
        // We fetch a large batch (500 items) to cover the most active products
        const { items } = await MySqlService.getStockItems({ page: 1, pageSize: 500 });
        const vendorMap = await MySqlService.getItemVendorMap();
        const leadTimeMap = await MySqlService.getVendorLeadTimes();

        const TARGET_DAYS_OF_COVER = 60; // We want to stock enough for 2 months
        const SAFETY_BUFFER_DAYS = 7;
        
        const recommendations = [];
        let recId = 2000;

        for (const item of items) {
            const itemId = (item.inventoryId || "").toUpperCase().trim();
            const currentStock = Number(item.totalOnHand) || 0;
            const qtySold90 = Number(item.totalQtySold) || 0;
            const ads = qtySold90 / 90; // Average Daily Sales
            
            const vendorId = vendorMap.get(itemId);
            const leadTime = vendorId ? (leadTimeMap[vendorId]?.days || 0) : 0;

            // --- AI Logic ---
            
            // Case A: Item has sales history (Velocity-based)
            if (ads > 0) {
                const daysRemaining = Math.floor(currentStock / ads);
                const targetStock = Math.ceil(ads * TARGET_DAYS_OF_COVER);
                const suggestedQty = Math.max(0, targetStock - currentStock);
                
                // Priority: High if stock lasts less than lead time + safety buffer
                const isCritical = daysRemaining <= (leadTime + SAFETY_BUFFER_DAYS);
                const priority = isCritical ? "High" : daysRemaining < 30 ? "Medium" : "Low";

                if (suggestedQty > 0 || isCritical) {
                    recommendations.push({
                        recommendationId: `REC-${recId++}`,
                        itemId: item.inventoryId,
                        description: item.description,
                        currentStock: currentStock,
                        suggestedQty: suggestedQty,
                        priorityLevel: priority,
                        generatedDate: new Date().toISOString(),
                        aiInsights: {
                            salesVelocity: ads.toFixed(2),
                            daysRemaining: daysRemaining,
                            leadTimeDays: leadTime,
                            vendorId: vendorId,
                            formula: `(ADS: ${ads.toFixed(2)}) * (Target: ${TARGET_DAYS_OF_COVER} days) - (Stock: ${currentStock})`,
                            message: `Selling ~${ads.toFixed(2)} units/day. Current stock lasts ${daysRemaining} days. Suggested restock covers ${TARGET_DAYS_OF_COVER} days of sales.`,
                            stockoutRisk: isCritical ? "Critical (Order Now)" : daysRemaining < 30 ? "High" : "Moderate"
                        }
                    });
                }
            } 
            // Case B: No sales in 90 days, but stock is extremely low (Fixed-threshold fallback)
            else if (currentStock < 5 && item.itemStatus === "Active") {
                recommendations.push({
                    recommendationId: `REC-${recId++}`,
                    itemId: item.inventoryId,
                    description: item.description,
                    currentStock: currentStock,
                    suggestedQty: 10, // Default minimum restock for active but slow items
                    priorityLevel: "Low",
                    generatedDate: new Date().toISOString(),
                    aiInsights: {
                        salesVelocity: "0.00",
                        daysRemaining: "N/A",
                        message: "No sales recorded in last 90 days. Minimum restock suggested to maintain basic availability for active catalog item.",
                        formula: "Fixed minimum threshold (5 units)"
                    }
                });
            }
        }

        // Sort: High priority first, then by suggested quantity
        const sorted = recommendations.sort((a, b) => {
            const pMap = { "High": 3, "Medium": 2, "Low": 1 };
            if (pMap[b.priorityLevel] !== pMap[a.priorityLevel]) {
                return pMap[b.priorityLevel] - pMap[a.priorityLevel];
            }
            return b.suggestedQty - a.suggestedQty;
        });

        return NextResponse.json(sorted);
    } catch (err) {
        console.error("[Replenishment API Error]", err);
        return NextResponse.json({ message: err.message }, { status: 500 });
    }
}
