import { NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/session-store";
import { MySqlService } from "@/services/mysql";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request, { params }) {
    const cookie = getSessionFromRequest(request);
    if (!cookie) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

    const { inventoryId: rawId } = await params;
    const inventoryId = decodeURIComponent(rawId);

    try {
        const dimensions = await MySqlService.getItemDimensions(inventoryId);
        return NextResponse.json({ dimensions });
    } catch (err) {
        console.error("[Dimensions GET]", err);
        return NextResponse.json({ message: err.message }, { status: 500 });
    }
}

export async function PUT(request, { params }) {
    const cookie = getSessionFromRequest(request);
    if (!cookie) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

    const { inventoryId: rawId } = await params;
    const inventoryId = decodeURIComponent(rawId);

    try {
        const body = await request.json();
        const saved = await MySqlService.upsertItemDimensions(inventoryId, {
            pcs_per_box: body.pcs_per_box,
            length_m: body.length_m,
            height_m: body.height_m,
            width_m: body.width_m,
            weight_kg: body.weight_kg,
            cbm: body.cbm,
        });
        return NextResponse.json({ dimensions: saved });
    } catch (err) {
        console.error("[Dimensions PUT]", err);
        return NextResponse.json({ message: err.message }, { status: 500 });
    }
}
