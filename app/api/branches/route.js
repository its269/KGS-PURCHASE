import { AcumaticaService } from "@/services/acumatica";
import { MySqlService } from "@/services/mysql";
import { NextResponse } from "next/server";
import { getSessionFromRequest, getActiveCompanyFromRequest } from "@/lib/session-store";
import { filterBranchList, filterReplenishmentBranchList } from "@/lib/companies";

export const dynamic = "force-dynamic";

const NO_STORE = { headers: { "Cache-Control": "no-store" } };

function applyModuleFilter(branches, forModule) {
    return forModule === "replenishment"
        ? filterReplenishmentBranchList(branches)
        : filterBranchList(branches);
}

function toMasterRows(branches) {
    return (branches || [])
        .map((b) => {
            const id = String(b.SiteID || b.BranchID || b.branch_id || "").trim();
            if (!id) return null;
            const name =
                (typeof b.Description === "object" ? b.Description?.value : b.Description) ||
                b.branch_name ||
                id;
            return {
                branch_id: id,
                branch_name: String(name).trim() || id,
                active: true,
            };
        })
        .filter(Boolean);
}

export async function GET(request) {
    try {
        const { searchParams } = new URL(request.url);
        const source = searchParams.get("source") || "auto";
        const forModule = searchParams.get("for") || "";
        const companyId = getActiveCompanyFromRequest(request) || "main";
        const cookie = getSessionFromRequest(request);

        // Prefer live Acumatica Branch entity (not Warehouse) when authenticated
        if (cookie && cookie !== "__bypass__" && source !== "mysql") {
            try {
                const branches = await AcumaticaService.getBranches(cookie);
                if (branches.length > 0) {
                    MySqlService.replaceMasterBranches(toMasterRows(branches)).catch((err) => {
                        console.warn("[Branches API] replaceMasterBranches:", err.message);
                    });
                    return NextResponse.json(applyModuleFilter(branches, forModule), NO_STORE);
                }
            } catch (err) {
                console.warn("[Branches API] Acumatica Branch failed, trying MySQL:", err.message);
            }
        }

        if (source === "mysql" || source === "auto" || !cookie) {
            try {
                const branches = forModule === "replenishment"
                    ? await MySqlService.getReplenishmentBranches(companyId)
                    : await MySqlService.getBranches(companyId);
                if (branches.length > 0) {
                    return NextResponse.json(applyModuleFilter(branches, forModule), NO_STORE);
                }
                console.log("[Branches API] MySQL returned 0 branches, falling back to Acumatica...");
            } catch (mError) {
                console.error("[MySQL Branches Error]", mError.message);
                console.log("[Branches API] Falling back to Acumatica due to MySQL error.");
            }
        }

        if (!cookie) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

        if (cookie === "__bypass__") {
            return NextResponse.json([
                { SiteID: "MAIN", Description: { value: "MAIN (Bypass Mode)" } }
            ], NO_STORE);
        }

        const branches = await AcumaticaService.getBranches(cookie);
        if (branches.length > 0) {
            MySqlService.replaceMasterBranches(toMasterRows(branches)).catch((err) => {
                console.warn("[Branches API] replaceMasterBranches:", err.message);
            });
        }
        return NextResponse.json(applyModuleFilter(branches, forModule), NO_STORE);
    } catch (err) {
        console.error("[BFF Branches Error]", err);
        if (err.message === "Unauthorized") return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
        return NextResponse.json({ message: "Failed to fetch branches" }, { status: 500 });
    }
}
