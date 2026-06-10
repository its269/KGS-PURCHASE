import { getSupabase } from "@/lib/supabase";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(request, { params }) {
    const supabase = getSupabase();
    if (!supabase) {
        return NextResponse.json({ error: "Supabase client not initialized. Check environment variables." }, { status: 500 });
    }

    const { inventoryId: rawId } = await params;
    const inventoryId = decodeURIComponent(rawId);

    const [pRes, lRes, countRes] = await Promise.all([
        supabase.from("products").select("*").eq("inventory_id", inventoryId),
        supabase.from("inventory_levels").select("*").eq("inventory_id", inventoryId),
        supabase.from("inventory_levels").select("inventory_id", { count: "exact", head: true }),
    ]);

    return NextResponse.json({
        inventoryId,
        products: { data: pRes.data, error: pRes.error },
        inventory_levels: { data: lRes.data, error: lRes.error },
        total_inventory_levels_rows: countRes.count,
    });
}
