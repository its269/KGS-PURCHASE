import { NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/session-store";
import { getSupabaseAdmin } from "@/lib/supabase";
import { MySqlService } from "@/services/mysql";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BATCH_SIZE = 1000;

/**
 * POST /api/sync/periodic-sales
 * Exports all rows from Supabase product_periodic_sales into MySQL db_purchase.
 * Auth-protected via Authorization header or acu_session cookie.
 */
export async function POST(request) {
    const supabaseAdmin = getSupabaseAdmin();
    if (!supabaseAdmin) {
        return NextResponse.json({ error: "Supabase admin client not initialized. Check environment variables." }, { status: 500 });
    }

    const cookie = getSessionFromRequest(request);
    if (!cookie) {
        return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    try {
        let exported = 0;
        let from = 0;
        let total = 0;
        let hasMore = true;

        while (hasMore) {
            const { data, error, count } = await supabaseAdmin
                .from("product_periodic_sales")
                .select("*", { count: from === 0 ? "exact" : "estimated" })
                .range(from, from + BATCH_SIZE - 1);

            if (error) {
                console.error("[Periodic Sales Export] Supabase error:", error);
                return NextResponse.json(
                    { message: "Supabase fetch failed", details: error.message },
                    { status: 500 }
                );
            }

            if (from === 0 && count !== null) {
                total = count;
            }

            if (!data || data.length === 0) {
                hasMore = false;
                break;
            }

            await MySqlService.upsertPeriodicSales(data);
            exported += data.length;
            from += BATCH_SIZE;

            if (data.length < BATCH_SIZE) {
                hasMore = false;
            }
        }

        return NextResponse.json({ exported, total });
    } catch (err) {
        console.error("[Periodic Sales Export Error]", err);
        return NextResponse.json(
            { message: "Export failed", details: err.message },
            { status: 500 }
        );
    }
}
