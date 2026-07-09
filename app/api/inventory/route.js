import { AcumaticaService } from "@/services/acumatica";
import { MySqlService } from "@/services/mysql";
import { getSessionFromRequest, getActiveCompanyFromRequest } from "@/lib/session-store";

export const runtime = "nodejs";

async function enrichInventoryRows(rows, { branch, search }) {
    const [salesMap, vendorMap, leadTimeMap] = await Promise.all([
        MySqlService.getPeriodicSalesSummary({ branch, search }),
        MySqlService.getItemVendorMap(),
        MySqlService.getVendorLeadTimes(),
    ]);

    return rows.map((item) => {
        const key = (item.InventoryID?.value || "").toUpperCase().trim();
        const sales = salesMap.get(key) || { qty_sold: 0, total_sales: 0 };
        const supplierId = vendorMap.get(key) || "";
        const leadTimeDays = supplierId ? (leadTimeMap[supplierId]?.days ?? null) : null;

        return {
            ...item,
            Category: { value: item.ItemClass?.value || item.Category?.value || "" },
            SupplierID: { value: supplierId },
            LeadTimeDays: { value: leadTimeDays },
            SafetyStock: item.SafetyStock ?? { value: null },
            MOQ: item.MOQ ?? { value: null },
            QtySold: { value: sales.qty_sold },
            TotalSales: { value: sales.total_sales },
        };
    });
}

/** * BFF API Route for Inventory
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
        const source = searchParams.get("source") || "mysql";
        const filter = searchParams.get("filter") || "";
        const companyId = getActiveCompanyFromRequest(request) || "main";

        let result;

        if (source === "mysql") {
            console.log(`[BFF] Fetching from MySQL (company: ${companyId})...`);
            try {
                const inventory = await MySqlService.getInventory({ page, pageSize, search, branch, filter, companyId });
                const layout = await MySqlService.resolveInventoryLayout(companyId);
                const isCatalogOnly = layout === "catalog-empty";

                if (inventory.data.length === 0) {
                    console.log("[BFF] MySQL returned 0 items for this query, falling back to Acumatica...");
                    throw new Error("EMPTY_MYSQL");
                }

                const cookie = getSessionFromRequest(request);

                if (isCatalogOnly && cookie && cookie !== "__bypass__") {
                    console.log(`[BFF] MySQL catalog has no branch stock — loading live stock from Acumatica`);
                    const live = await AcumaticaService.getStockItems({
                        page,
                        pageSize,
                        search,
                        branch,
                        cookie,
                        includeStats: stats,
                    });
                    const enriched = await enrichInventoryRows(live.data, { branch, search });
                    return Response.json({
                        ...live,
                        data: enriched,
                        globalStats: live.globalStats || {
                            totalStock: 0,
                            totalValue: 0,
                            lowStock: 0,
                            totalLowStock: 0,
                            outOfStock: 0,
                            deadStock: 0,
                            overstock: 0,
                            lastSync: await MySqlService.getLastInventorySyncTime(),
                        },
                        source: "acumatica-live",
                        companyId,
                        page,
                        pageSize,
                    });
                }

                let globalStats = {
                    totalStock: 0,
                    totalValue: 0,
                    lowStock: 0,
                    totalLowStock: 0,
                    outOfStock: 0,
                    deadStock: 0,
                    overstock: 0,
                    lastSync: null,
                    dataMode: layout,
                };
                if (stats) {
                    await MySqlService.sanitizeCatalogStockFields(companyId).catch(() => 0);
                    globalStats = await MySqlService.getGlobalStats(branch, search, companyId);
                }

                result = {
                    ...inventory,
                    data: inventory.data,
                    globalStats,
                    dataMode: globalStats.dataMode || inventory.dataMode || layout,
                    source: layout === "warehouse" ? "mysql" : "mysql-catalog",
                    companyId,
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

        if (result?.data) {
            result.data = await enrichInventoryRows(result.data, { branch, search });
        }

        if (stats && !result.globalStats) {
            result.globalStats = await MySqlService.getGlobalStats(branch, search, companyId);
        }

        return Response.json({
            ...result,
            page,
            pageSize,
        });    } catch (err) {
        console.error("[BFF Inventory Error]", err);
        if (err.message === "Unauthorized") {
            return Response.json({ message: "Unauthorized" }, { status: 401 });
        }
        return Response.json({ message: "Internal server error", details: err.message }, { status: 500 });
    }
}
