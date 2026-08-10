import { NextResponse } from "next/server";
import { MySqlService } from "@/services/mysql";
import { requireAdmin } from "@/lib/app-users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function mapPresenceUser(row, online) {
    return {
        id: Number(row.id),
        username: row.username,
        fullName: row.full_name || "",
        role: row.role === "admin" ? "admin" : "user",
        activeCompanyId: row.active_company_id || "main",
        lastSeenAt: row.last_seen_at ? new Date(row.last_seen_at).toISOString() : null,
        online: Boolean(online),
    };
}

function isOnline(row, cutoffMs) {
    if (!row?.last_seen_at) return false;
    const t = new Date(row.last_seen_at).getTime();
    return Number.isFinite(t) && t >= cutoffMs;
}

export async function GET(request) {
    try {
        await requireAdmin(request);
        const { searchParams } = new URL(request.url);
        const raw = parseInt(searchParams.get("windowMinutes") || "3", 10);
        const windowMinutes = Math.min(15, Math.max(1, Number.isFinite(raw) ? raw : 3));

        const rows = await MySqlService.listUserPresence();
        const cutoffMs = Date.now() - windowMinutes * 60 * 1000;
        const online = [];
        const offline = [];
        for (const row of rows) {
            if (isOnline(row, cutoffMs)) online.push(mapPresenceUser(row, true));
            else offline.push(mapPresenceUser(row, false));
        }

        return NextResponse.json({
            windowMinutes,
            count: online.length,
            users: online,
            online,
            offline,
        });
    } catch (err) {
        const status = err.status || 500;
        return NextResponse.json(
            { message: err.message || "Failed to list online users" },
            { status }
        );
    }
}
