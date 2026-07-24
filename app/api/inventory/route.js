import { AcumaticaService } from "@/services/acumatica";
import { MySqlService } from "@/services/mysql";
import { getSessionFromRequest, getActiveCompanyFromRequest } from "@/lib/session-store";

export const runtime = "nodejs";

async function enrichInventoryRows(rows, { branch, search }) {
    const [salesMap, vendorMap, leadTimeMap] = await Promise.all([
        MySqlService.getPeriodicSalesSummary({ branch, search }),
        MySqlService.getItemVendorMap(),
        MySqlService.getEffectiveVendorLeadTimes(),
    ]);

    return rows.map((item) => {
        const key = (item.InventoryID?.value || "").toUpperCase().trim();
        const sales = salesMap.get(key) || { qty_sold: 0, total_sales: 0 };
        const catalogVendor = item.VendorID?.value || item.SupplierID?.value || "";
        const poVendor = vendorMap.get(key) || "";
        const supplierId = String(catalogVendor || poVendor || "").trim();
        const rawLead = item.LeadTimeDays?.value;
        const itemLead = rawLead != null && rawLead !== "" ? Number(rawLead) : null;
        const vendorLead = supplierId ? (leadTimeMap[supplierId]?.days ?? null) : null;
        const leadTimeDays = Number.isFinite(itemLead) ? itemLead : vendorLead;

        return {
            ...item,
            Category: { value: item.ItemClass?.value || item.Category?.value || "" },
            SupplierID: { value: supplierId },
            LeadTimeDays: { value: leadTimeDays != null && Number.isFinite(leadTimeDays) ? leadTimeDays : null },
            SafetyStock: item.SafetyStock ?? { value: null },
            MOQ: item.MOQ ?? { value: null },
            QtySold: { value: sales.qty_sold },
            TotalSales: { value: sales.total_sales },
        };
    });
}

/** * BFF API Route for Inventory */
export async function GET(request) {
    try {
        const { searchParams } = new URL(request.url);

        const page = parseInt(searchParams.get("page") || "1");
        const pageSize = parseInt(searchParams.get("pageSize") || "10");
        const search = searchParams.get("search") || "";
        const branch = searchParams.get("branch") || "";
        const stats = searchParams.get("stats") === "true";
        const statsOnly = searchParams.get("statsOnly") === "true";
        const count = searchParams.get("count") === "true";
        const source = searchParams.get("source") || "mysql";
        const filter = searchParams.get("filter") || "";
        const enrich = searchParams.get("enrich") === "true";
        const companyId = getActiveCompanyFromRequest(request) || "main";

        if (source === "mysql" && statsOnly) {
            const globalStats = await MySqlService.getGlobalStats(branch, search, companyId);
            return Response.json({ globalStats, companyId });
        }

        let result;

        if (source === "mysql") {
            try {
                const inventoryPromise = MySqlService.getInventory({ page, pageSize, search, branch, filter, companyId });
                const statsPromise = stats
                    ? MySqlService.getGlobalStats(branch, search, companyId)
                    : Promise.resolve(null);

                const [inventory, globalStatsResult] = await Promise.all([inventoryPromise, statsPromise]);

                const layout = inventory.dataMode === "catalog"
                    ? "catalog"
                    : inventory.dataMode === "warehouse-missing"
                    ? "catalog-empty"
                    : "warehouse";
                const isCatalogOnly = layout === "catalog-empty";

                if (inventory.data.length === 0) {
                    throw new Error("EMPTY_MYSQL");
                }

                const cookie = getSessionFromRequest(request);

                if (isCatalogOnly && cookie && cookie !== "__bypass__") {
                    const live = await AcumaticaService.getStockItems({
                        page,
                        pageSize,
                        search,
                        branch,
                        cookie,
                        includeStats: stats,
                    });
                    const data = enrich ? await enrichInventoryRows(live.data, { branch, search }) : live.data;
                    return Response.json({
                        ...live,
                        data,
                        globalStats: live.globalStats || globalStatsResult || {
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

                result = {
                    ...inventory,
                    data: inventory.data,
                    globalStats: globalStatsResult || undefined,
                    dataMode: globalStatsResult?.dataMode || inventory.dataMode || layout,
                    source: layout === "warehouse" ? "mysql" : "mysql-catalog",
                    companyId,
                };
            } catch (mError) {
                console.error("[MySQL Inventory Error]", mError.message);

                const cookie = getSessionFromRequest(request);
                if (!cookie) return Response.json({ message: "Unauthorized" }, { status: 401 });

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

        if (result?.data && enrich) {
            result.data = await enrichInventoryRows(result.data, { branch, search });
        }

        if (stats && !result.globalStats) {
            result.globalStats = await MySqlService.getGlobalStats(branch, search, companyId);
        }

        return Response.json({
            ...result,
            page,
            pageSize,
        });
    } catch (err) {
        console.error("[BFF Inventory Error]", err);
        if (err.message === "Unauthorized") {
            return Response.json({ message: "Unauthorized" }, { status: 401 });
        }
        return Response.json({ message: "Internal server error", details: err.message }, { status: 500 });
    }
}
