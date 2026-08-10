import { NextResponse } from "next/server";
import { MySqlService } from "@/services/mysql";
import { requireAdmin, sanitizeUser } from "@/lib/app-users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function mapLog(row) {
    return {
        id: Number(row.id),
        action: row.action || "",
        module: row.module || "",
        refId: row.ref_id || "",
        fieldKey: row.field_key || "",
        detail: row.detail || "",
        createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    };
}

/** GET — admin: activity / input logs for one user */
export async function GET(request, { params }) {
    try {
        await requireAdmin(request);
        const id = Number((await params).id);
        if (!Number.isFinite(id) || id < 1) {
            return NextResponse.json({ message: "Invalid user id" }, { status: 400 });
        }

        const userRow = await MySqlService.getAppUserById(id);
        if (!userRow) {
            return NextResponse.json({ message: "User not found" }, { status: 404 });
        }

        const { searchParams } = new URL(request.url);
        const limit = parseInt(searchParams.get("limit") || "100", 10);
        const rows = await MySqlService.listAppUserActionLogs(id, { limit });
        let logs = rows.map(mapLog);

        // If nothing logged yet (feature is new), still surface current session presence
        if (logs.length === 0) {
            const session = await MySqlService.getLatestAppSessionForUser(id);
            if (session?.last_seen_at) {
                logs = [
                    {
                        id: 0,
                        action: "session_active",
                        module: "auth",
                        refId: "",
                        fieldKey: "",
                        detail: "Signed in / active session (no input changes recorded yet)",
                        createdAt: new Date(session.last_seen_at).toISOString(),
                    },
                ];
            }
        }

        return NextResponse.json({
            user: sanitizeUser(userRow),
            count: logs.length,
            logs,
        });
    } catch (err) {
        const status = err.status || 500;
        return NextResponse.json(
            { message: err.message || "Failed to load activity" },
            { status }
        );
    }
}
