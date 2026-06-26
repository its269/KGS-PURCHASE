import { NextResponse } from "next/server";
import { authenticateAllCompanies } from "@/lib/company-auth";
import { setBypassSession } from "@/lib/session-store";
import { MySqlService } from "@/services/mysql";
import { getCookiePath } from "@/lib/base-path";

export async function POST(request) {
    try {
        const { username, password } = await request.json();
        console.log("[Login] Attempting login for user:", username);

        const sessionId = crypto.randomUUID();

        try {
            const results = await authenticateAllCompanies(sessionId, {
                username,
                password,
                activeCompanyId: "main",
            });

            const mainResult = results.find((r) => r.companyId === "main");
            if (!mainResult?.ok) {
                const errMsg = mainResult?.error || results.find((r) => r.error)?.error || "Login failed";
                throw new Error(errMsg);
            }

            const ecomResult = results.find((r) => r.companyId === "ecommerce");
            if (ecomResult?.ok) {
                console.log("[Login] Ecommerce company ready (virtual — ECOMMERCE branch)");
            }

            try {
                const moved = await MySqlService.cleanupMisclassifiedEcomBranches();
                if (moved > 0) console.log(`[Login] Moved ${moved} ECOMMERCE branch rows to ecommerce company`);
            } catch (migrateErr) {
                console.warn("[Login] Ecommerce data migration skipped:", migrateErr.message);
            }
        } catch (loginErr) {
            const isLimitError = loginErr.message?.includes("API Login Limit");
            const matchesEnv =
                username === process.env.ACU_USERNAME &&
                password === process.env.ACU_PASSWORD;

            if (isLimitError && matchesEnv) {
                console.log("[Login] API Limit reached — emergency bypass for MySQL-only mode");
                setBypassSession(sessionId);
            } else {
                throw loginErr;
            }
        }

        console.log("[Login] Session stored:", sessionId);
        const response = NextResponse.json({ success: true, sessionId });

        response.cookies.set("acu_session", sessionId, {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            sameSite: "lax",
            path: getCookiePath(),
            maxAge: 8 * 60 * 60, // 8 hours
        });

        return response;
    } catch (err) {
        console.error("[BFF Login Error]", err);
        return NextResponse.json({ message: err.message || "Login failed" }, { status: 401 });
    }
}
