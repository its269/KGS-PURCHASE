import { NextResponse } from "next/server";
import { getSessionFromRequest, getActiveCompanyFromRequest } from "@/lib/session-store";
import { getStockWarehouseIdsForBranch } from "@/lib/companies";
import { getSystemAcumaticaCredential } from "@/lib/acumatica-system-auth";
import { AcumaticaService, mapSummaryLocations } from "@/services/acumatica";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { headers: { "Cache-Control": "no-store" } };

/**
 * GET /api/inventory/locations?inventoryId=XXX
 * Location-level on-hand from Acumatica Inventory Summary (IN401000).
 */
export async function GET(request) {
    try {
        const cookie = getSessionFromRequest(request);
        if (!cookie) {
            return NextResponse.json({ message: "Unauthorized" }, { status: 401, ...NO_STORE });
        }

        const { searchParams } = new URL(request.url);
        const inventoryId = String(searchParams.get("inventoryId") || "").trim();
        const branch = String(searchParams.get("branch") || "").trim();
        if (!inventoryId) {
            return NextResponse.json({ message: "inventoryId is required." }, { status: 400, ...NO_STORE });
        }

        let credential = await getSystemAcumaticaCredential();
        if (!credential || credential === "__bypass__") {
            // Fall back to session cookie only if it is a real Acumatica ASP.NET_SessionId
            if (cookie && cookie !== "__bypass__" && cookie.length > 20 && !cookie.includes("-")) {
                credential = cookie;
            }
        }
        if (!credential || credential === "__bypass__") {
            return NextResponse.json(
                { message: "Acumatica credentials unavailable for location lookup.", locations: [] },
                { status: 503, ...NO_STORE }
            );
        }

        const results = await AcumaticaService.getInventorySummaryResults(inventoryId, credential);
        let locations = mapSummaryLocations(results);

        if (branch) {
            const allowed = new Set(
                getStockWarehouseIdsForBranch(branch).map((id) => String(id).trim().toUpperCase())
            );
            locations = locations.filter((loc) =>
                allowed.has(String(loc.warehouseId || "").trim().toUpperCase())
            );
        }

        const companyId = getActiveCompanyFromRequest(request) || "main";

        return NextResponse.json(
            {
                inventoryId,
                branch: branch || null,
                companyId,
                locations,
                source: "acumatica-summary",
            },
            NO_STORE
        );
    } catch (err) {
        console.error("[Inventory Locations]", err.message);
        return NextResponse.json(
            { message: err.message || "Failed to load locations", locations: [] },
            { status: 500, ...NO_STORE }
        );
    }
}
