import { NextResponse } from "next/server";
import { getSessionIdFromRequest, getLocalUserSession } from "@/lib/session-store";
import { MySqlService } from "@/services/mysql";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MODULE = "tour_guide";
const FIELD = "prefs";

function refIdForUser(userId) {
    return `user:${userId}`;
}

function emptyPrefs() {
    return { skippedAll: false, modules: {} };
}

function parsePrefs(raw) {
    if (!raw) return emptyPrefs();
    try {
        const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
        return {
            skippedAll: Boolean(parsed?.skippedAll),
            modules: parsed?.modules && typeof parsed.modules === "object" ? parsed.modules : {},
        };
    } catch {
        return emptyPrefs();
    }
}

function requireLocalUser(req) {
    const sessionId = getSessionIdFromRequest(req);
    const userId = getLocalUserSession(sessionId)?.id;
    if (!userId) {
        return { error: NextResponse.json({ message: "Unauthorized" }, { status: 401 }) };
    }
    return { userId: Number(userId) };
}

/** GET — load this user's tour progress (shared across devices). */
export async function GET(req) {
    try {
        const auth = requireLocalUser(req);
        if (auth.error) return auth.error;

        const all = await MySqlService.getAnnotations(MODULE);
        const row = all?.[refIdForUser(auth.userId)];
        const prefs = parsePrefs(row?.[FIELD]);
        return NextResponse.json(prefs);
    } catch (err) {
        console.error("[Tour prefs GET]", err);
        return NextResponse.json({ message: "Internal server error" }, { status: 500 });
    }
}

/** PUT — save tour progress for this user. */
export async function PUT(req) {
    try {
        const auth = requireLocalUser(req);
        if (auth.error) return auth.error;

        const body = await req.json().catch(() => ({}));
        const prefs = {
            skippedAll: Boolean(body?.skippedAll),
            modules: body?.modules && typeof body.modules === "object" ? body.modules : {},
        };

        const ok = await MySqlService.upsertAnnotation(
            MODULE,
            refIdForUser(auth.userId),
            FIELD,
            JSON.stringify(prefs)
        );
        if (!ok) {
            return NextResponse.json({ message: "Failed to save tour preferences" }, { status: 500 });
        }
        return NextResponse.json(prefs);
    } catch (err) {
        console.error("[Tour prefs PUT]", err);
        return NextResponse.json({ message: "Internal server error" }, { status: 500 });
    }
}
