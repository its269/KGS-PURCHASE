import { AcumaticaService } from "@/services/acumatica";
import { MySqlService } from "@/services/mysql";
import { NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/session-store";

export async function GET(request) {
    try {
        const { searchParams } = new URL(request.url);
        const source = searchParams.get("source") || "mysql";

        if (source === "mysql") {
            try {
                const branches = await MySqlService.getBranches();
                if (branches.length > 0) {
                    return NextResponse.json(branches);
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
        return NextResponse.json(branches);
    } catch (err) {
        console.error("[BFF Branches Error]", err);
        if (err.message === "Unauthorized") return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
        return NextResponse.json({ message: "Failed to fetch branches" }, { status: 500 });
    }
}
