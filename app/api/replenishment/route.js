import { NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/session-store";
import { AcumaticaService } from "@/services/acumatica";
import { MySqlService } from "@/services/mysql";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
    const cookie = getSessionFromRequest(request);
    
    if (!cookie) {
        return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    try {
        let recs = [];
        if (cookie !== "__bypass__") {
            recs = await AcumaticaService.getReplenishmentRecommendations({ cookie });
        }

        // Advanced AI Enrichment using MySQL Sales Velocity & Lead Times
        try {
            const salesMap = await MySqlService.getPeriodicSalesSummary();
            const vendorMap = await MySqlService.getItemVendorMap();
            const leadTimeMap = await MySqlService.getVendorLeadTimes();

            recs = recs.map(r => {
                const itemId = r.itemId.toUpperCase().trim();
                const sales = salesMap.get(itemId) || { qty_sold: 0 };
                const vendorId = vendorMap.get(itemId);
                const leadTime = vendorId ? (leadTimeMap[vendorId]?.days || 0) : 0;
                
                const velocity = sales.qty_sold / 90; // Average per day over 90 days
                
                if (velocity > 0) {
                    const daysLeft = Math.floor(r.currentStock / velocity);
                    const isCritical = daysLeft < 7;
                    const isLongLeadDanger = leadTime > 0 && daysLeft <= leadTime;
                    
                    let aiMessage = `Sales velocity is ${velocity.toFixed(2)} units/day. ${daysLeft} days of stock remaining at current rate.`;
                    if (isCritical) aiMessage += " Stockout highly likely within a week.";
                    if (isLongLeadDanger) aiMessage += ` Warning: Lead time for vendor ${vendorId} is ${leadTime} days. Order now to prevent stockout!`;

                    return {
                        ...r,
                        aiInsights: {
                            ...r.aiInsights,
                            salesVelocity: velocity.toFixed(2),
                            daysRemaining: daysLeft,
                            leadTimeDays: leadTime,
                            vendorId: vendorId,
                            message: aiMessage,
                            formula: `(Stock: ${r.currentStock}) / (Avg Daily Sales: ${velocity.toFixed(2)}) = ${daysLeft} days left. [Lead Time: ${leadTime} days]`
                        },
                        priorityLevel: (isCritical || isLongLeadDanger) ? "High" : r.priorityLevel
                    };
                }
                return r;
            });
        } catch (mysqlErr) {
            console.warn("[Replenishment Enrichment] MySQL fallback failed", mysqlErr.message);
        }

        return NextResponse.json(recs);
    } catch (err) {
        console.error("[Replenishment API Error]", err);
        return NextResponse.json({ message: err.message }, { status: 500 });
    }
}
