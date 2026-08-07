import { NextResponse } from "next/server";
import { MySqlService } from "@/services/mysql";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/stock-items/dimensions?ids=A,B,C
 * Batch-load packaging dimensions for PO line Total CBM, etc.
 */
export async function GET(req) {
    try {
        const { searchParams } = new URL(req.url);
        const raw = searchParams.get("ids") || "";
        const ids = raw
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
            .slice(0, 200);

        if (!ids.length) {
            return NextResponse.json({ dimensions: {} });
        }

        const dimensions = await MySqlService.getItemDimensionsBatch(ids);
        return NextResponse.json({ dimensions });
    } catch (err) {
        console.error("[Dimensions batch GET Error]", err);
        return NextResponse.json({ message: "Internal server error" }, { status: 500 });
    }
}
