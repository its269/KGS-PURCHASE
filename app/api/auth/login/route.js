import { NextResponse } from "next/server";
import { authenticateAllCompanies } from "@/lib/company-auth";
import {
    setBypassSession,
    setLocalUserSession,
    SESSION_COOKIE_MAX_AGE_SEC,
    initMultiCompanySession,
} from "@/lib/session-store";
import { MySqlService } from "@/services/mysql";
import { getSessionCookieOptions } from "@/lib/base-path";
import { ensureAppUsersReady } from "@/lib/ensure-app-users";
import { sanitizeUser, verifyPassword } from "@/lib/app-users";
import { persistAppSession } from "@/lib/persist-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Optional: attach server system ERP credentials for sync/API calls.
 * This is NOT used for interactive user login.
 */
async function attachSystemErpSession(sessionId) {
    const sysUser = process.env.ACUMATICA_USERNAME || process.env.ACU_USERNAME;
    const sysPass = process.env.ACUMATICA_PASSWORD || process.env.ACU_PASSWORD;
    if (sysUser && sysPass) {
        try {
            const results = await authenticateAllCompanies(sessionId, {
                username: sysUser,
                password: sysPass,
                activeCompanyId: "main",
            });
            const mainResult = results.find((r) => r.companyId === "main");
            if (mainResult?.ok) return "system";
        } catch (err) {
            console.warn("[Login] System ERP attach failed for local user:", err.message);
        }
    }
    setBypassSession(sessionId);
    return "bypass";
}

export async function POST(request) {
    try {
        const { username, password } = await request.json();
        console.log("[Login] Attempting local login for user:", username);

        if (!username || !password) {
            return NextResponse.json({ message: "Username and password are required." }, { status: 400 });
        }

        try {
            await ensureAppUsersReady();
        } catch (seedErr) {
            console.warn("[Login] App users seed skipped:", seedErr.message);
        }

        let localRow;
        try {
            localRow = await MySqlService.getAppUserByUsername(username);
        } catch (lookupErr) {
            console.error("[Login] Local user lookup failed:", lookupErr.message);
            return NextResponse.json(
                { message: "Unable to verify credentials. Please try again later." },
                { status: 503 }
            );
        }

        if (!localRow) {
            return NextResponse.json({ message: "Invalid username or password." }, { status: 401 });
        }
        if (!(localRow.active === 1 || localRow.active === true)) {
            return NextResponse.json({ message: "This account is deactivated." }, { status: 401 });
        }
        if (!verifyPassword(password, localRow.password_hash)) {
            return NextResponse.json({ message: "Invalid username or password." }, { status: 401 });
        }

        const sessionId = crypto.randomUUID();
        initMultiCompanySession(sessionId, { activeCompanyId: "main" });
        const user = sanitizeUser(localRow);
        const erpMode = await attachSystemErpSession(sessionId);
        setLocalUserSession(sessionId, user);
        await persistAppSession(sessionId, user.id, "main");

        try {
            const moved = await MySqlService.cleanupMisclassifiedEcomBranches();
            if (moved > 0) console.log(`[Login] Moved ${moved} ECOMMERCE branch rows to ecommerce company`);
        } catch (migrateErr) {
            console.warn("[Login] Ecommerce data migration skipped:", migrateErr.message);
        }

        console.log(`[Login] Local user OK (${user.role}), ERP mode=${erpMode}, session=${sessionId}`);
        const response = NextResponse.json({
            success: true,
            sessionId,
            authType: "local",
            user,
        });
        response.cookies.set(
            "acu_session",
            sessionId,
            getSessionCookieOptions(request, SESSION_COOKIE_MAX_AGE_SEC)
        );
        return response;
    } catch (err) {
        console.error("[BFF Login Error]", err);
        return NextResponse.json({ message: err.message || "Login failed" }, { status: 401 });
    }
}
