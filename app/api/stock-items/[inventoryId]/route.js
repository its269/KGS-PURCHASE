import { MySqlService } from "@/services/mysql";
import { AcumaticaService } from "@/services/acumatica";
import { getSessionFromRequest } from "@/lib/session-store";
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

        // --- Try MySQL first ---
        console.log(`[Stock Item Detail API] Fetching from MySQL (db_purchase) for ${inventoryId}`);
        const mysqlDetail = await MySqlService.getStockItemDetail(inventoryId);
        
        // Fetch annotations for this inventory item
        const annotations = await MySqlService.getAnnotations("inventory");
        const itemAnnotations = annotations[inventoryId] || {};
        
        if (mysqlDetail && mysqlDetail.branches && mysqlDetail.branches.length > 0) {
            return NextResponse.json({ 
                ...mysqlDetail, 
                annotations: itemAnnotations,
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
        
        const branches = wds
            .map(wh => ({
                branchId: String(getF(wh, "WarehouseID") || getF(wh, "SiteID")).trim(),
                siteId: String(getF(wh, "WarehouseID") || getF(wh, "SiteID")).trim(),
                onHand: Number(getF(wh, "QtyOnHand") || 0),
                available: Number(getF(wh, "QtyAvailable") || 0),
                updatedAt: new Date().toISOString(),
            }))
            .filter(b => b.branchId);

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
            branches,
            annotations: itemAnnotations,
            source: "acumatica",
        };

        // Async upsert to MySQL so next time it's cached
        try {
            const levels = branches.map(b => ({
                inventory_id: inventoryId,
                branch_id: b.branchId,
                site_id: b.siteId,
                on_hand: b.onHand,
                available: b.available,
                description: result.description,
                item_class: result.itemClass,
                default_price: result.unitPrice,
                item_status: result.itemStatus,
                base_unit: result.baseUnit,
            }));
            await MySqlService.upsertInventoryLevels(levels);
        } catch (dbErr) {
            console.error("[Stock Item Detail API] Background upsert failed:", dbErr.message);
        }

        return NextResponse.json(result);

    } catch (err) {
        console.error("[Stock Item Detail API Error]", err);
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
