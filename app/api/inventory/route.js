import { AcumaticaService } from "@/services/acumatica";
import { MySqlService } from "@/services/mysql";
import { getSessionFromRequest } from "@/lib/session-store";

export const runtime = "nodejs";

/**
 * BFF API Route for Inventory
 * Handles request parsing and delegates to AcumaticaService or MySqlService.
 */
export async function GET(request) {
    try {
        const { searchParams } = new URL(request.url);

        const page = parseInt(searchParams.get("page") || "1");
        const pageSize = parseInt(searchParams.get("pageSize") || "10");
        const search = searchParams.get("search") || "";
        const branch = searchParams.get("branch") || "";
        const stats = searchParams.get("stats") === "true";
        const count = searchParams.get("count") === "true";
        const source = searchParams.get("source") || "mysql"; // Default to mysql for speed
        const filter = searchParams.get("filter") || "";

        let result;

        if (source === "mysql") {
            console.log("[BFF] Fetching from MySQL...");
            try {
                const inventory = await MySqlService.getInventory({ page, pageSize, search, branch, filter });

                // If MySQL is empty for this query, fall back to Acumatica for a live check
                if (inventory.data.length === 0) {
                    console.log("[BFF] MySQL returned 0 items for this query, falling back to Acumatica...");
                    throw new Error("EMPTY_MYSQL");
                }

                let globalStats = { totalStock: 0, totalValue: 0, lowStock: 0, totalLowStock: 0, outOfStock: 0 };
                if (stats) {
                    globalStats = await MySqlService.getGlobalStats(branch, search);
                }

                // Merge periodic sales summary (qty_sold, total_sales) per inventory item
                const salesMap = await MySqlService.getPeriodicSalesSummary({ branch, search });
                const enriched = inventory.data.map(item => {
                    const key = (item.InventoryID?.value || "").toUpperCase().trim();
                    const sales = salesMap.get(key) || { qty_sold: 0, total_sales: 0 };
                    return {
                        ...item,
                        QtySold: { value: sales.qty_sold },
                        TotalSales: { value: sales.total_sales },
                    };
                });

                result = {
                    ...inventory,
                    data: enriched,
                    globalStats,
                    source: "mysql"
                };
            } catch (mError) {
                console.error("[MySQL Inventory Error]", mError.message);
                
                const cookie = getSessionFromRequest(request);
                if (!cookie) return Response.json({ message: "Unauthorized" }, { status: 401 });

                // If we are in Bypass Mode, we CANNOT fall back to Acumatica (it will 401)
                if (cookie === "__bypass__") {
                    return Response.json({
                        data: [],
                        totalCount: 0,
                        hasMore: false,
                        globalStats: { totalStock: 0, totalValue: 0, lowStock: 0, totalLowStock: 0, outOfStock: 0 },
                        source: "mysql-bypass-empty",
                        message: "MySQL is empty and Acumatica is unreachable (Bypass Mode)."
                    });
                }

                console.log("[BFF] Falling back to Acumatica due to MySQL error/emptiness.");
                result = await AcumaticaService.getStockItems({
                    page,
                    pageSize,
                    search,
                    branch,
                    cookie,
                    includeStats: stats,
                    includeCount: count
                });
                result.source = "acumatica-fallback";
            }
        } else {
            console.log("[BFF] Fetching from Acumatica...");
            const cookie = getSessionFromRequest(request);
            if (!cookie) return Response.json({ message: "Unauthorized" }, { status: 401 });

            result = await AcumaticaService.getStockItems({
                page,
                pageSize,
                search,
                branch,
                cookie,
                includeStats: stats,
                includeCount: count
            });
            result.source = "acumatica-direct";
        }

        return Response.json({
            ...result,
            page,
            pageSize
        });

    } catch (err) {
        console.error("[BFF Inventory Error]", err);
        if (err.message === "Unauthorized") {
            return Response.json({ message: "Unauthorized" }, { status: 401 });
        }
        return Response.json({ message: "Internal server error", details: err.message }, { status: 500 });
    }
}
