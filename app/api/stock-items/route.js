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

            // Transform Acumatica BFF format to StockItems Masterlist format
            const transformedItems = acuResult.data.map(item => ({
                inventoryId: item.InventoryID?.value,
                description: item.Description?.value,
                itemClass: item.ItemClass?.value,
                itemStatus: "Active", // Default if not in BFF
                baseUnit: "PCS",      // Default if not in BFF
                price: item.DefaultPrice?.value || 0,
                totalQtySold: 0,      // Not available in direct Acumatica fetch
                totalSales: 0         // Not available in direct Acumatica fetch
            }));

            // Deduplicate by inventoryId (BFF might return multiple rows per item if there are multiple warehouses)
            const uniqueItems = [];
            const seen = new Set();
            for (const item of transformedItems) {
                if (!seen.has(item.inventoryId)) {
                    seen.add(item.inventoryId);
                    uniqueItems.push(item);
                }
            }

            return NextResponse.json({
                items: uniqueItems,
                totalCount: acuResult.totalCount,
                source: "acumatica-fallback"
            });
        } catch (acuErr) {
            console.error("[Stock Items API Fallback Error]", acuErr);
            return NextResponse.json({ error: acuErr.message || "Failed to fetch stock items" }, { status: 500 });
        }
    }
}

