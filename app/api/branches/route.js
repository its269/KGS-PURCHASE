import { MySqlService } from "@/services/mysql";
import { NextResponse } from "next/server";
import { getActiveCompanyFromRequest } from "@/lib/session-store";
import { filterBranchList, filterReplenishmentBranchList } from "@/lib/companies";

export const dynamic = "force-dynamic";

const NO_STORE = { headers: { "Cache-Control": "no-store" } };

function applyModuleFilter(branches, forModule) {
    return forModule === "replenishment"
        ? filterReplenishmentBranchList(branches)
        : filterBranchList(branches);
}

/**
 * Branch pickers are MySQL-only (inventory sites + branches master).
 * Acumatica credentials / Branch entity are not used.
 */
export async function GET(request) {
    try {
        const { searchParams } = new URL(request.url);
        const forModule = searchParams.get("for") || "";
        const companyId = getActiveCompanyFromRequest(request) || "main";

        const branches = forModule === "replenishment"
            ? await MySqlService.getReplenishmentBranches(companyId)
            : await MySqlService.getBranches(companyId);

        return NextResponse.json(applyModuleFilter(branches, forModule), NO_STORE);
    } catch (err) {
        console.error("[BFF Branches Error]", err);
        return NextResponse.json({ message: "Failed to fetch branches" }, { status: 500 });
    }
}
