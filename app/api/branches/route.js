import { AcumaticaService } from "@/services/acumatica";
import { MySqlService } from "@/services/mysql";
import { NextResponse } from "next/server";
import { getSessionFromRequest, getActiveCompanyFromRequest } from "@/lib/session-store";
import { filterBranchList } from "@/lib/companies";

export async function GET(request) {
    try {
        const { searchParams } = new URL(request.url);
        const source = searchParams.get("source") || "mysql";
        const companyId = getActiveCompanyFromRequest(request) || "main";

        if (source === "mysql") {
            try {
                const branches = await MySqlService.getBranches(companyId);
                if (branches.length > 0) {
                    return NextResponse.json(filterBranchList(branches));
                }
                console.log("[Branches API] MySQL returned 0 branches, falling back to Acumatica...");
            } catch (mError) {
                console.error("[MySQL Branches Error]", mError.message);
                console.log("[Branches API] Falling back to Acumatica due to MySQL error.");
            }
        }

        const cookie = getSessionFromRequest(request);
        if (!cookie) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

        if (cookie === "__bypass__") {
            return NextResponse.json([
                { SiteID: "MAIN", Description: { value: "MAIN (Bypass Mode)" } }
            ]);
        }

        const branches = await AcumaticaService.getBranches(cookie);
        return NextResponse.json(filterBranchList(branches));
    } catch (err) {
        console.error("[BFF Branches Error]", err);
        if (err.message === "Unauthorized") return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
        return NextResponse.json({ message: "Failed to fetch branches" }, { status: 500 });
    }
}
