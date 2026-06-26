import { MySqlService } from "@/services/mysql";
import { AcumaticaService, extractWarehouseLevels } from "@/services/acumatica";
import { getSessionFromRequest, getActiveCompanyFromRequest } from "@/lib/session-store";
import { isEcomBranchAlias, isExcludedBranchAlias } from "@/lib/companies";
import { NextResponse } from "next/server";
const ACU_BASE = `${process.env.ACUMATICA_BASE_URL}/entity/Default/20.200.001`;

function getF(obj, key) {
    if (!obj) return "";
    const k = Object.keys(obj).find(i => i.toLowerCase() === key.toLowerCase());
    if (!k) return "";
    const val = obj[k];
    if (val === null || val === undefined) return "";
    if (typeof val === "object") return val.value ?? "";
    return val;
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request, { params }) {
    try {
        const { inventoryId: rawId } = await params;
        const inventoryId = decodeURIComponent(rawId);
        const companyId = getActiveCompanyFromRequest(request) || "main";

        // --- Try MySQL first ---
        console.log(`[Stock Item Detail API] MySQL — ${inventoryId} (${companyId})`);
        const mysqlDetail = await MySqlService.getStockItemDetail(inventoryId, companyId);        
        // Fetch annotations for this inventory item
        const annotations = await MySqlService.getAnnotations("inventory");
        const itemAnnotations = annotations[inventoryId] || {};
        let dimensions = null;
        try {
            dimensions = await MySqlService.getItemDimensions(inventoryId);
        } catch (dimErr) {
            console.error("[Stock Item Detail API] Dimensions load skipped:", dimErr.message);
        }
        
        if (mysqlDetail) {
            if (mysqlDetail.branches) {
                mysqlDetail.branches = mysqlDetail.branches.filter((b) =>
                    !isExcludedBranchAlias(b.branchId) &&
                    (companyId === "ecommerce"
                        ? isEcomBranchAlias(b.branchId)
                        : !isEcomBranchAlias(b.branchId))
                );
                mysqlDetail.totalOnHand = mysqlDetail.branches.reduce((s, b) => s + b.onHand, 0);
                mysqlDetail.totalAvailable = mysqlDetail.branches.reduce((s, b) => s + b.available, 0);
            }
            return NextResponse.json({ 
                ...mysqlDetail, 
                annotations: itemAnnotations,
                dimensions,
                companyId,
                source: "mysql" 
            });
        }

        // --- Fallback: fetch live from Acumatica ---
        const cookie = getSessionFromRequest(request);
        if (!cookie) {
            return NextResponse.json({ 
                ...(mysqlDetail || {}),
                inventoryId,
                error: mysqlDetail ? null : "Item not found in local database and no active ERP session",
                source: mysqlDetail ? "mysql" : "error"
            }, { status: mysqlDetail ? 200 : 401 });
        }

        if (cookie === "__bypass__") {
            return NextResponse.json({ 
                ...(mysqlDetail || {
                    inventoryId,
                    description: "Item details unavailable in Bypass Mode (ERP limit reached)",
                    itemClass: "—",
                    unitPrice: 0,
                    itemStatus: "—",
                    baseUnit: "—",
                    totalOnHand: 0,
                    totalAvailable: 0,
                    branches: []
                }),
                source: mysqlDetail ? "mysql" : "bypass-error"
            });
        }

        console.log(`[Stock Item Detail API] Fallback: Live fetch from Acumatica for ${inventoryId}`);
        const url = `${ACU_BASE}/StockItem?$filter=InventoryID eq '${encodeURIComponent(inventoryId)}'&$expand=WarehouseDetails`;
        const res = await AcumaticaService.fetchWithRetry(url, cookie);
        const data = await res.json();
        const items = data.value || (Array.isArray(data) ? data : []);
        const item = items[0];

        if (!item) {
            return NextResponse.json({ error: "Item not found in Acumatica ERP" }, { status: 404 });
        }

        const rawWds = item.WarehouseDetails || [];
        const wds = Array.isArray(rawWds) ? rawWds : (rawWds.value || []);
        
        const levels = extractWarehouseLevels(item, {
            description: String(getF(item, "Description")).trim(),
            item_class: String(getF(item, "ItemClass")).trim(),
            default_price: Number(getF(item, "DefaultPrice") || getF(item, "ListPrice") || 0),
            item_status: String(getF(item, "ItemStatus")).trim(),
            base_unit: String(getF(item, "BaseUnit")).trim(),
        });

        const branches = levels
            .filter((l) => !isExcludedBranchAlias(l.branch_id))
            .filter((l) => !isEcomBranchAlias(l.branch_id) || companyId === "ecommerce")
            .map((l) => ({
            branchId: l.branch_id,
            siteId: l.site_id,
            onHand: l.on_hand,
            available: l.available,
            updatedAt: new Date().toISOString(),
        }));
        const totalOnHand = branches.reduce((s, b) => s + b.onHand, 0);
        const totalAvailable = branches.reduce((s, b) => s + b.available, 0);

        const result = {
            inventoryId,
            description: String(getF(item, "Description")).trim(),
            itemClass: String(getF(item, "ItemClass")).trim(),
            unitPrice: Number(getF(item, "DefaultPrice") || getF(item, "ListPrice") || 0),
            itemStatus: String(getF(item, "ItemStatus")).trim(),
            baseUnit: String(getF(item, "BaseUnit")).trim(),
            lastSync: new Date().toISOString(),
            totalOnHand,
            totalAvailable,
            companyId,
            branches,
            annotations: itemAnnotations,
            dimensions: await MySqlService.getItemDimensions(inventoryId),
            source: "acumatica",
        };

        // Async upsert to MySQL so next time it's cached
        try {
            await MySqlService.deleteInventoryLevelsForItems([inventoryId], companyId);
            await MySqlService.upsertInventoryLevels(levels, companyId);        } catch (dbErr) {
            console.error("[Stock Item Detail API] Background upsert failed:", dbErr.message);
        }

        return NextResponse.json(result);

    } catch (err) {
        console.error("[Stock Item Detail API Error]", err);
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
