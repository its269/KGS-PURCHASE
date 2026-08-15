import { NextResponse } from "next/server";
import { MySqlService } from "@/services/mysql";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { headers: { "Cache-Control": "no-store" } };

/**
 * GET /api/health
 * Public lightweight check: app process + MySQL reachability.
 */
export async function GET() {
    const db = await MySqlService.pingDatabases(5000);
    if (!db.ok) {
        return NextResponse.json(
            {
                ok: false,
                app: true,
                database: false,
                reason: "server",
                message: "Unable to reach the database server.",
                ms: db.ms,
            },
            { status: 503, ...NO_STORE }
        );
    }

    return NextResponse.json(
        {
            ok: true,
            app: true,
            database: true,
            reason: null,
            ms: db.ms,
        },
        { status: 200, ...NO_STORE }
    );
}
