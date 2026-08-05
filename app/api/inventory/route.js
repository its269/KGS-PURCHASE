import { AcumaticaService } from "@/services/acumatica";
import { MySqlService } from "@/services/mysql";
import { getSessionFromRequest, getActiveCompanyFromRequest } from "@/lib/session-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { headers: { "Cache-Control": "no-store" } };

async function enrichInventoryRows(rows, { branch }) {
    const ids = rows
        .map((item) => item.InventoryID?.value || item.inventoryId || "")
        .filter(Boolean);

    const [salesMap, vendorMap, leadTimeMap] = await Promise.all([
        MySqlService.getPeriodicSalesSummaryForIds({ ids, branch }),
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
            return Response.json({ globalStats, companyId }, NO_STORE);
        }

        let result;

        if (source === "mysql") {
            try {
                const inventoryPromise = MySqlService.getInventory({ page, pageSize, search, branch, filter, companyId });
                const statsPromise = stats
                    ? MySqlService.getGlobalStats(branch, search, companyId)
                    : Promise.resolve(null);

                const [inventory, globalStatsResult] = await Promise.all([inventoryPromise, statsPromise]);

                const dataMode = globalStatsResult?.dataMode || inventory.dataMode || "warehouse";
                const fromMysqlCatalog =
                    dataMode === "catalog" || dataMode === "warehouse-missing";

                // Prefer MySQL even when warehouse levels are missing (catalog listing).
                // Do not jump to live ERP just because branch stock rows are absent.
                result = {
                    ...inventory,
                    data: inventory.data,
                    globalStats: globalStatsResult || undefined,
                    dataMode,
                    source: fromMysqlCatalog ? "mysql-catalog" : "mysql",
                    companyId,
                };
            } catch (mError) {
                console.error("[MySQL Inventory Error]", mError.message);

                // Keep Inventory on MySQL: only use ERP when the DB call itself failed
                // and the client explicitly asked for a non-mysql source path below.
                // For source=mysql, return an empty MySQL payload instead of FALLBACK.
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
                    }, NO_STORE);
                }

                return Response.json({
                    data: [],
                    totalCount: 0,
                    hasMore: false,
                    globalStats: await MySqlService.getGlobalStats(branch, search, companyId).catch(() => ({
                        totalStock: 0,
                        totalValue: 0,
                        lowStock: 0,
                        totalLowStock: 0,
                        outOfStock: 0,
                        deadStock: 0,
                        overstock: 0,
                    })),
                    source: "mysql",
                    dataMode: "catalog-empty",
                    companyId,
                    page,
                    pageSize,
                    message: "Unable to read inventory from MySQL. Check Sync Center or try Refresh.",
                    details: mError.message,
                }, NO_STORE);
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
            result.data = await enrichInventoryRows(result.data, { branch });
        }

        if (stats && !result.globalStats) {
            result.globalStats = await MySqlService.getGlobalStats(branch, search, companyId);
        }

        return Response.json({
            ...result,
            page,
            pageSize,
        }, NO_STORE);
    } catch (err) {
        console.error("[BFF Inventory Error]", err);
        if (err.message === "Unauthorized") {
            return Response.json({ message: "Unauthorized" }, { status: 401 });
        }
        return Response.json({ message: "Internal server error", details: err.message }, { status: 500 });
    }
}
