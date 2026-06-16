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

        // Advanced AI Enrichment using MySQL Sales Velocity
        try {
            const salesMap = await MySqlService.getPeriodicSalesSummary();
            recs = recs.map(r => {
                const sales = salesMap.get(r.itemId.toUpperCase()) || { qty_sold: 0 };
                const velocity = sales.qty_sold / 90; // Average per day over 90 days
                
                if (velocity > 0) {
                    const daysLeft = Math.floor(r.currentStock / velocity);
                    const isCritical = daysLeft < 7;
                    
                    return {
                        ...r,
                        aiInsights: {
                            ...r.aiInsights,
                            salesVelocity: velocity.toFixed(2),
                            daysRemaining: daysLeft,
                            message: `Sales velocity is ${velocity.toFixed(2)} units/day. ${daysLeft} days of stock remaining at current rate. ${isCritical ? "Stockout highly likely within a week." : ""}`,
                            formula: `(Stock: ${r.currentStock}) / (Avg Daily Sales: ${velocity.toFixed(2)}) = ${daysLeft} days left`
                        },
                        priorityLevel: isCritical ? "High" : r.priorityLevel
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
