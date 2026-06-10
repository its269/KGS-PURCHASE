import { MySqlService } from "@/services/mysql";
import { AcumaticaService } from "@/services/acumatica";
import { NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/session-store";

export async function GET(request) {
    const { searchParams } = new URL(request.url);
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
    const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get("pageSize") || "50", 10)));
    const search = searchParams.get("search") || "";

    try {
        const cookie = getSessionFromRequest(request);
        if (!cookie) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

        console.log(`[Stock Items API] Fetching from MySQL - Page: ${page}, Size: ${pageSize}, Search: "${search}"`);
        const result = await MySqlService.getStockItems({ page, pageSize, search });
        
        if (result.items.length === 0) {
            if (cookie === "__bypass__") {
                return NextResponse.json({ items: [], totalCount: 0, source: "mysql-bypass-empty" });
            }
            console.log("[Stock Items API] MySQL returned 0 items for this query, falling back to Acumatica...");
            throw new Error("EMPTY_MYSQL");
        }

        return NextResponse.json({ ...result, source: "mysql" });
    } catch (err) {
        console.error("[Stock Items API MySQL Error]", err.message);

        const cookie = getSessionFromRequest(request);
        if (cookie === "__bypass__") {
            return NextResponse.json({ items: [], totalCount: 0, source: "mysql-bypass-error", message: err.message });
        }

        console.log("[Stock Items API] Falling back to Acumatica...");

        try {
            const cookie = getSessionFromRequest(request);
            if (!cookie) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

            const acuResult = await AcumaticaService.getStockItems({
                page,
                pageSize,
                search,
                cookie
            });

            // Transform and aggregate Acumatica BFF format
            const itemMap = new Map();
            for (const item of acuResult.data) {
                const invId = item.InventoryID?.value;
                if (!invId) continue;

                if (!itemMap.has(invId)) {
                    itemMap.set(invId, {
                        inventoryId: invId,
                        description: item.Description?.value,
                        itemClass: item.ItemClass?.value,
                        itemStatus: item.ItemStatus?.value || "Active",
                        baseUnit: item.BaseUnit?.value || "PCS",
                        price: item.DefaultPrice?.value || 0,
                        totalOnHand: 0,
                        totalQtySold: 0,
                        totalSales: 0
                    });
                }
                const entry = itemMap.get(invId);
                entry.totalOnHand += (item.OnHand?.value || 0);
            }

            return NextResponse.json({
                items: Array.from(itemMap.values()),
                totalCount: acuResult.totalCount,
                source: "acumatica-fallback"
            });
        } catch (acuErr) {
            console.error("[Stock Items API Fallback Error]", acuErr);
            return NextResponse.json({ error: acuErr.message || "Failed to fetch stock items" }, { status: 500 });
        }
    }
}

