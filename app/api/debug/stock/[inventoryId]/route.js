import { MySqlService } from "@/services/mysql";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(request, { params }) {
    try {
        const { inventoryId: rawId } = await params;
        const inventoryId = decodeURIComponent(rawId);

        const [item, branches] = await Promise.all([
            MySqlService.getStockItemDetail(inventoryId),
            MySqlService.getBranches(),
        ]);

        return NextResponse.json({
            inventoryId,
            mysql_item: item,
            available_branches: branches,
        });
    } catch (err) {
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
