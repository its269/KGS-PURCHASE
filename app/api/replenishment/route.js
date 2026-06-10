import { NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/session-store";
import { AcumaticaService } from "@/services/acumatica";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
    const cookie = getSessionFromRequest(request);
    
    if (!cookie) {
        return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    if (cookie === "__bypass__") {
        return NextResponse.json([]);
    }

    try {
        const result = await AcumaticaService.getReplenishmentRecommendations({ cookie });
        return NextResponse.json(result);
    } catch (err) {
        console.error("[Replenishment API Error]", err);
        return NextResponse.json({ message: err.message }, { status: 500 });
    }
}
